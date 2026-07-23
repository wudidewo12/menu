import "server-only";

import type { Prisma } from "../../generated/prisma/client";
import { DishDifficulty } from "../../generated/prisma/enums";
import type { Menu, MenuSection } from "../../types/menu";
import { prisma } from "./prisma";

export const DEFAULT_MENU_READ_SLUG = "family-dinner";

const LEGACY_MENU_DATE_LABEL = "今晚菜单";
const DEFAULT_DISH_IMAGE = "/images/dishes/default-dish.png";
const DIFFICULTY_LABELS: Record<DishDifficulty, string> = {
  [DishDifficulty.EASY]: "简单",
  [DishDifficulty.MEDIUM]: "中等",
  [DishDifficulty.HARD]: "困难",
};

function hasSameMembers(left: number[], right: number[]) {
  if (left.length !== right.length) {
    return false;
  }

  const rightMembers = new Set(right);
  return left.every((dishId) => rightMembers.has(dishId));
}

function toPublicImageUrl(storageKey: string) {
  return `/${storageKey.replace(/^\/+/, "")}`;
}

function formatServings(minimum: number, maximum: number) {
  return minimum === maximum ? `${minimum}人份` : `${minimum}-${maximum}人份`;
}

export async function readMenuFromDatabaseWithClient(
  client: Prisma.TransactionClient,
  menuSlug = DEFAULT_MENU_READ_SLUG,
): Promise<Menu | null> {
  const menu = await client.menu.findUnique({
    where: {
      slug: menuSlug,
    },
    include: {
      menuDishes: {
        orderBy: {
          sortOrder: "asc",
        },
        include: {
          dish: {
            include: {
              images: {
                orderBy: {
                  sortOrder: "asc",
                },
              },
            },
          },
        },
      },
      sections: {
        orderBy: {
          sortOrder: "asc",
        },
        include: {
          sectionDishes: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
      },
    },
  });

  if (!menu) {
    return null;
  }

  const recommendedDishIds = menu.menuDishes
    .filter((menuDish) => menuDish.recommended)
    .map((menuDish) => menuDish.dishId);
  const dishIdsByCategory = new Map<string, number[]>();

  for (const menuDish of menu.menuDishes) {
    const categoryDishIds = dishIdsByCategory.get(menuDish.dish.category) ?? [];
    categoryDishIds.push(menuDish.dishId);
    dishIdsByCategory.set(menuDish.dish.category, categoryDishIds);
  }

  const sections: MenuSection[] = menu.sections.map((section) => {
    const dishIds = section.sectionDishes.map((sectionDish) => sectionDish.dishId);
    const recommendedOnly =
      recommendedDishIds.length > 0 && hasSameMembers(dishIds, recommendedDishIds);
    let category: string | null = null;

    if (!recommendedOnly) {
      for (const [categoryName, categoryDishIds] of dishIdsByCategory) {
        if (hasSameMembers(dishIds, categoryDishIds)) {
          category = categoryName;
          break;
        }
      }
    }

    return {
      id: section.slug,
      label: section.label,
      title: section.title,
      note: section.note ?? "",
      category,
      recommendedOnly,
      dishIds,
      sortOrder: section.sortOrder,
    };
  });

  return {
    version: menu.version,
    updatedAt: menu.updatedAt.toISOString(),
    settings: {
      title: menu.title,
      subtitle: menu.subtitle ?? "",
      sections,
    },
    dishes: menu.menuDishes.map((menuDish) => {
      const dish = menuDish.dish;
      const imageUrls = dish.images.map((image) => toPublicImageUrl(image.storageKey));
      const primaryImage = imageUrls[0] ?? DEFAULT_DISH_IMAGE;

      return {
        id: dish.id,
        name: dish.name,
        slug: dish.slug,
        description: dish.description,
        date: LEGACY_MENU_DATE_LABEL,
        prepTime: `${dish.prepMinutes}分钟`,
        category: dish.category,
        accent: dish.accent ?? "",
        difficulty: DIFFICULTY_LABELS[dish.difficulty],
        recommended: menuDish.recommended,
        servings: formatServings(dish.servingsMin, dish.servingsMax),
        image: primaryImage,
        images: imageUrls.length > 0 ? imageUrls : [primaryImage],
        ingredients: dish.ingredients,
        visible: menuDish.visible,
        sortOrder: menuDish.sortOrder,
      };
    }),
  };
}

export async function readMenuFromDatabase(
  menuSlug = DEFAULT_MENU_READ_SLUG,
): Promise<Menu | null> {
  return readMenuFromDatabaseWithClient(prisma, menuSlug);
}
