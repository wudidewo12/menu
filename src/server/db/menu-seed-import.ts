import "server-only";

import { Prisma } from "../../generated/prisma/client";
import { prisma } from "./prisma";
import type { MenuImportPlan } from "./menu-seed-types";

const EXPECTED_IMPORT_COUNTS = {
  Menu: 1,
  Dish: 55,
  MenuDish: 55,
  MenuSection: 7,
  SectionDish: 64,
  DishImage: 55,
} as const;

export type MenuImportCounts = Record<keyof typeof EXPECTED_IMPORT_COUNTS, number>;

export interface MenuImportResult {
  menuId: string;
  menuSlug: string;
  counts: MenuImportCounts;
  dishSequenceValue: number;
}

async function countBusinessRecords(
  transaction: Prisma.TransactionClient,
): Promise<MenuImportCounts> {
  const [menus, dishes, menuDishes, menuSections, sectionDishes, dishImages] =
    await Promise.all([
      transaction.menu.count(),
      transaction.dish.count(),
      transaction.menuDish.count(),
      transaction.menuSection.count(),
      transaction.sectionDish.count(),
      transaction.dishImage.count(),
    ]);

  return {
    Menu: menus,
    Dish: dishes,
    MenuDish: menuDishes,
    MenuSection: menuSections,
    SectionDish: sectionDishes,
    DishImage: dishImages,
  };
}

function assertEmptyDatabase(counts: MenuImportCounts) {
  const nonEmptyModels = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([model, count]) => `${model}=${count}`);

  if (nonEmptyModels.length > 0) {
    throw new Error(
      `Menu import refused because business tables are not empty: ${nonEmptyModels.join(", ")}`,
    );
  }
}

function assertExpectedCounts(counts: MenuImportCounts) {
  for (const [model, expected] of Object.entries(EXPECTED_IMPORT_COUNTS)) {
    const actual = counts[model as keyof MenuImportCounts];

    if (actual !== expected) {
      throw new Error(
        `Menu import count mismatch for ${model}: expected ${expected}, received ${actual}`,
      );
    }
  }
}

function assertPlanCounts(plan: MenuImportPlan) {
  assertExpectedCounts({
    Menu: 1,
    Dish: plan.dishes.length,
    MenuDish: plan.menuDishes.length,
    MenuSection: plan.menuSections.length,
    SectionDish: plan.sectionDishes.length,
    DishImage: plan.dishImages.length,
  });

  const dishIds = plan.dishes.map((dish) => dish.id).sort((left, right) => left - right);

  if (!dishIds.every((dishId, index) => dishId === index + 1)) {
    throw new Error("Menu import requires Dish ids to remain sequential from 1 through 55");
  }
}

export async function importMenuSeed(plan: MenuImportPlan): Promise<MenuImportResult> {
  assertPlanCounts(plan);

  return prisma.$transaction(
    async (transaction) => {
      assertEmptyDatabase(await countBusinessRecords(transaction));

      const menu = await transaction.menu.create({
        data: plan.menu,
        select: {
          id: true,
          slug: true,
        },
      });

      await transaction.dish.createMany({
        data: plan.dishes,
      });

      await transaction.menuDish.createMany({
        data: plan.menuDishes.map(({ menuSlug, ...menuDish }) => {
          if (menuSlug !== menu.slug) {
            throw new Error(
              `MenuDish for dish ${menuDish.dishId} references unexpected menu "${menuSlug}"`,
            );
          }

          return {
            menuId: menu.id,
            ...menuDish,
          };
        }),
      });

      const sectionIds = new Map<string, string>();

      for (const { menuSlug, sourceId, ...section } of plan.menuSections) {
        if (menuSlug !== menu.slug) {
          throw new Error(
            `MenuSection "${section.slug}" references unexpected menu "${menuSlug}"`,
          );
        }

        const createdSection = await transaction.menuSection.create({
          data: {
            menuId: menu.id,
            ...section,
          },
          select: {
            id: true,
          },
        });

        sectionIds.set(sourceId, createdSection.id);
      }

      await transaction.sectionDish.createMany({
        data: plan.sectionDishes.map(({ sectionSlug, ...sectionDish }) => {
          const sectionId = sectionIds.get(sectionSlug);

          if (!sectionId) {
            throw new Error(
              `SectionDish for dish ${sectionDish.dishId} references missing section "${sectionSlug}"`,
            );
          }

          return {
            sectionId,
            ...sectionDish,
          };
        }),
      });

      await transaction.dishImage.createMany({
        data: plan.dishImages,
      });

      const counts = await countBusinessRecords(transaction);
      assertExpectedCounts(counts);

      const sequenceRows = await transaction.$queryRaw<Array<{ value: bigint }>>`
        SELECT setval(
          pg_get_serial_sequence('"Dish"', 'id'),
          (SELECT MAX(id) FROM "Dish"),
          true
        ) AS "value"
      `;
      const dishSequenceValue = Number(sequenceRows[0]?.value);

      if (dishSequenceValue !== plan.dishes.length) {
        throw new Error(
          `Dish id sequence must end at ${plan.dishes.length}, received ${dishSequenceValue}`,
        );
      }

      return {
        menuId: menu.id,
        menuSlug: menu.slug,
        counts,
        dishSequenceValue,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}
