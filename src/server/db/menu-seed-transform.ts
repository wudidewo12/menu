import "server-only";

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { imageSizeFromFile } from "image-size/fromFile";

import { DishStatus, MenuStatus } from "../../generated/prisma/enums";
import {
  assert,
  assertNonEmptyString,
  assertPositiveInteger,
  DEFAULT_MENU_SLUG,
  mapDifficulty,
  parsePrepMinutes,
  parseServings,
  parseSourceMenu,
  resolvePublicFile,
  SLUG_PATTERN,
} from "./menu-seed-parsers";
import type { MenuImportPlan } from "./menu-seed-types";

export async function createMenuSeedImportPlan(options?: {
  projectRoot?: string;
  seedPath?: string;
  menuSlug?: string;
}): Promise<MenuImportPlan> {
  const projectRoot = path.resolve(options?.projectRoot ?? process.cwd());
  const seedPath = path.resolve(
    projectRoot,
    options?.seedPath ?? path.join("data", "menu-seed.json"),
  );
  const menuSlug = options?.menuSlug ?? DEFAULT_MENU_SLUG;

  assert(SLUG_PATTERN.test(menuSlug), "menu slug must use lowercase letters, numbers, and hyphens");

  const source = parseSourceMenu(JSON.parse(await readFile(seedPath, "utf8")) as unknown);
  const sourceUpdatedAt = new Date(source.updatedAt);
  const dishIds = new Set<number>();
  const dishSlugs = new Set<string>();
  const dishSortOrders = new Set<number>();
  const imageStorageKeys = new Set<string>();
  const sectionSlugs = new Set<string>();
  const sectionSortOrders = new Set<number>();

  const dishes = source.dishes.map((dish) => {
    assertPositiveInteger(dish.id, "dish.id");
    assert(!dishIds.has(dish.id), `dish id ${dish.id} is duplicated`);
    dishIds.add(dish.id);

    assertNonEmptyString(dish.slug, `dish ${dish.id} slug`);
    assert(SLUG_PATTERN.test(dish.slug), `dish ${dish.id} slug has an invalid format`);
    assert(!dishSlugs.has(dish.slug), `dish slug "${dish.slug}" is duplicated`);
    dishSlugs.add(dish.slug);

    assertNonEmptyString(dish.name, `dish ${dish.id} name`);
    assertNonEmptyString(dish.description, `dish ${dish.id} description`);
    assertNonEmptyString(dish.prepTime, `dish ${dish.id} prepTime`);
    assertNonEmptyString(dish.category, `dish ${dish.id} category`);
    assertNonEmptyString(dish.accent, `dish ${dish.id} accent`);
    assertNonEmptyString(dish.difficulty, `dish ${dish.id} difficulty`);
    assertNonEmptyString(dish.servings, `dish ${dish.id} servings`);
    assertNonEmptyString(dish.date, `dish ${dish.id} date`);
    assert(typeof dish.recommended === "boolean", `dish ${dish.id} recommended must be boolean`);
    assert(typeof dish.visible === "boolean", `dish ${dish.id} visible must be boolean`);
    assertPositiveInteger(dish.sortOrder, `dish ${dish.id} sortOrder`);
    assert(!dishSortOrders.has(dish.sortOrder), `dish sortOrder ${dish.sortOrder} is duplicated`);
    dishSortOrders.add(dish.sortOrder);
    assert(
      Array.isArray(dish.ingredients) &&
        dish.ingredients.length > 0 &&
        dish.ingredients.every((item) => typeof item === "string" && item.trim().length > 0),
      `dish ${dish.id} ingredients must contain non-empty strings`,
    );

    const servings = parseServings(dish.servings, dish.id);

    return {
      id: dish.id,
      slug: dish.slug,
      name: dish.name,
      description: dish.description,
      prepMinutes: parsePrepMinutes(dish.prepTime, dish.id),
      category: dish.category,
      accent: dish.accent || null,
      difficulty: mapDifficulty(dish.difficulty, dish.id),
      servingsMin: servings.minimum,
      servingsMax: servings.maximum,
      ingredients: [...dish.ingredients],
      status: DishStatus.ACTIVE,
      version: 1,
    };
  });

  const menuDishes = source.dishes.map((dish) => ({
    menuSlug,
    dishId: dish.id,
    recommended: dish.recommended,
    visible: dish.visible,
    sortOrder: dish.sortOrder,
  }));

  const menuSections = source.settings.sections.map((section) => {
    assertNonEmptyString(section.id, "section.id");
    assert(SLUG_PATTERN.test(section.id), `section "${section.id}" has an invalid slug`);
    assert(!sectionSlugs.has(section.id), `section slug "${section.id}" is duplicated`);
    sectionSlugs.add(section.id);
    assertNonEmptyString(section.label, `section ${section.id} label`);
    assertNonEmptyString(section.title, `section ${section.id} title`);
    assert(typeof section.note === "string", `section ${section.id} note must be a string`);
    assertPositiveInteger(section.sortOrder, `section ${section.id} sortOrder`);
    assert(
      !sectionSortOrders.has(section.sortOrder),
      `section sortOrder ${section.sortOrder} is duplicated`,
    );
    sectionSortOrders.add(section.sortOrder);
    assert(Array.isArray(section.dishIds), `section ${section.id} must use explicit dishIds`);

    return {
      menuSlug,
      sourceId: section.id,
      slug: section.id,
      label: section.label,
      title: section.title,
      note: section.note || null,
      visible: true,
      sortOrder: section.sortOrder,
    };
  });

  const sectionDishes = source.settings.sections.flatMap((section) => {
    assert(Array.isArray(section.dishIds), `section ${section.id} must use explicit dishIds`);
    const sectionDishIds = new Set<number>();

    return section.dishIds.map((dishId, index) => {
      assertPositiveInteger(dishId, `section ${section.id} dish id`);
      assert(dishIds.has(dishId), `section ${section.id} references missing dish ${dishId}`);
      assert(!sectionDishIds.has(dishId), `section ${section.id} repeats dish ${dishId}`);
      sectionDishIds.add(dishId);

      return {
        sectionSlug: section.id,
        dishId,
        sortOrder: index + 1,
      };
    });
  });

  const dishImages = (
    await Promise.all(
      source.dishes.map(async (dish) => {
        assertNonEmptyString(dish.image, `dish ${dish.id} image`);
        assert(
          Array.isArray(dish.images) && dish.images.length > 0,
          `dish ${dish.id} images must not be empty`,
        );
        assert(dish.image === dish.images[0], `dish ${dish.id} primary image must be images[0]`);

        return Promise.all(
          dish.images.map(async (imagePath, index) => {
            assertNonEmptyString(imagePath, `dish ${dish.id} image ${index + 1}`);
            assert(
              imagePath.startsWith("/images/"),
              `dish ${dish.id} image ${index + 1} must be inside /images`,
            );

            const storageKey = imagePath.replace(/^\/+/, "");
            assert(
              !imageStorageKeys.has(storageKey),
              `image storage key "${storageKey}" is duplicated`,
            );
            imageStorageKeys.add(storageKey);

            const filePath = resolvePublicFile(projectRoot, storageKey);
            const [fileStats, dimensions] = await Promise.all([
              stat(filePath),
              imageSizeFromFile(filePath),
            ]);

            assert(dimensions.type === "webp", `image "${storageKey}" must be WebP`);
            assertPositiveInteger(dimensions.width, `image "${storageKey}" width`);
            assertPositiveInteger(dimensions.height, `image "${storageKey}" height`);
            assertPositiveInteger(fileStats.size, `image "${storageKey}" byteSize`);

            return {
              dishId: dish.id,
              storageKey,
              altText: dish.name,
              mimeType: "image/webp" as const,
              width: dimensions.width,
              height: dimensions.height,
              byteSize: fileStats.size,
              sortOrder: index + 1,
            };
          }),
        );
      }),
    )
  ).flat();

  return {
    menu: {
      slug: menuSlug,
      title: source.settings.title,
      subtitle: source.settings.subtitle || null,
      status: MenuStatus.PUBLISHED,
      version: source.version,
      publishedAt: sourceUpdatedAt,
    },
    dishes,
    menuDishes,
    menuSections,
    sectionDishes,
    dishImages,
    source: {
      path: seedPath,
      updatedAt: sourceUpdatedAt,
      dateLabels: [...new Set(source.dishes.map((dish) => dish.date))].sort(),
      ignoredFields: [
        "dish.date（属于当前菜单，不属于可复用菜品）",
        "dish.image（仅用于校验 images[0]，数据库以 DishImage 为准）",
        "section.category（显式 dishIds 是分区成员唯一来源）",
        "section.recommendedOnly（显式 dishIds 是分区成员唯一来源）",
      ],
    },
  };
}
