import "server-only";

import { Prisma } from "../../generated/prisma/client";
import {
  DishDifficulty,
  DishStatus,
} from "../../generated/prisma/enums";
import type { Menu, MenuSection } from "../../types/menu";
import type { MenuDish } from "../../types/dish";
import {
  DEFAULT_MENU_READ_SLUG,
  readMenuFromDatabaseWithClient,
} from "./menu-read";
import {
  createMenuWritePlan,
  MenuVersionConflictError,
  type MenuWritePlan,
} from "./menu-write-plan";
import { prisma } from "./prisma";

const DIFFICULTY_VALUES: Record<string, DishDifficulty> = {
  简单: DishDifficulty.EASY,
  中等: DishDifficulty.MEDIUM,
  困难: DishDifficulty.HARD,
};

export class DatabaseMenuNotFoundError extends Error {
  readonly code = "MENU_NOT_FOUND";

  constructor(menuSlug: string) {
    super(`Database menu "${menuSlug}" was not found`);
    this.name = "DatabaseMenuNotFoundError";
  }
}

export class DatabaseMenuWriteVerificationError extends Error {
  readonly code = "MENU_WRITE_VERIFICATION_FAILED";

  constructor() {
    super("Database menu did not match the validated write plan");
    this.name = "DatabaseMenuWriteVerificationError";
  }
}

export class DatabaseDishIdConflictError extends Error {
  readonly code = "DISH_ID_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "DatabaseDishIdConflictError";
  }
}

export interface DatabaseMenuWriteResult {
  menu: Menu;
  plan: MenuWritePlan;
}

export interface DatabaseMenuWriteOptions {
  menuSlug?: string;
  /**
   * Test-only hook used to prove that all business writes roll back before
   * the non-transactional PostgreSQL sequence is synchronized. Production API
   * code must not set it.
   */
  beforeCommit?: (result: DatabaseMenuWriteResult) => void | Promise<void>;
}

function parsePrepMinutes(prepTime: string) {
  return Number(/^(\d+)分钟$/.exec(prepTime)?.[1]);
}

function parseServings(servings: string) {
  const match = /^(\d+)(?:-(\d+))?人份$/.exec(servings);

  return {
    servingsMin: Number(match?.[1]),
    servingsMax: Number(match?.[2] ?? match?.[1]),
  };
}

function dishCreateData(dish: MenuDish): Prisma.DishUncheckedCreateInput {
  const servings = parseServings(dish.servings);

  return {
    id: dish.id,
    slug: dish.slug,
    name: dish.name,
    description: dish.description,
    prepMinutes: parsePrepMinutes(dish.prepTime),
    category: dish.category,
    accent: dish.accent || null,
    difficulty: DIFFICULTY_VALUES[dish.difficulty],
    ...servings,
    ingredients: dish.ingredients,
  };
}

function dishUpdateData(
  dish: MenuDish,
  fields: MenuWritePlan["changes"]["dishes"]["updated"][number]["fields"],
): Prisma.DishUpdateInput {
  const data: Prisma.DishUpdateInput = {
    version: {
      increment: 1,
    },
  };

  for (const field of fields) {
    switch (field) {
      case "name":
        data.name = dish.name;
        break;
      case "description":
        data.description = dish.description;
        break;
      case "prepTime":
        data.prepMinutes = parsePrepMinutes(dish.prepTime);
        break;
      case "category":
        data.category = dish.category;
        break;
      case "accent":
        data.accent = dish.accent || null;
        break;
      case "difficulty":
        data.difficulty = DIFFICULTY_VALUES[dish.difficulty];
        break;
      case "servings": {
        const servings = parseServings(dish.servings);
        data.servingsMin = servings.servingsMin;
        data.servingsMax = servings.servingsMax;
        break;
      }
      case "ingredients":
        data.ingredients = dish.ingredients;
        break;
    }
  }

  return data;
}

function menuDishUpdateData(
  dish: MenuDish,
  fields: MenuWritePlan["changes"]["menuDishes"]["updated"][number]["fields"],
): Prisma.MenuDishUpdateInput {
  const data: Prisma.MenuDishUpdateInput = {};

  for (const field of fields) {
    switch (field) {
      case "recommended":
        data.recommended = dish.recommended;
        break;
      case "visible":
        data.visible = dish.visible;
        break;
      case "sortOrder":
        data.sortOrder = dish.sortOrder;
        break;
    }
  }

  return data;
}

function sectionUpdateData(
  section: MenuSection,
  fields: MenuWritePlan["changes"]["sections"]["updated"][number]["fields"],
): Prisma.MenuSectionUpdateInput {
  const data: Prisma.MenuSectionUpdateInput = {};

  for (const field of fields) {
    switch (field) {
      case "label":
        data.label = section.label;
        break;
      case "title":
        data.title = section.title;
        break;
      case "note":
        data.note = section.note || null;
        break;
      case "sortOrder":
        data.sortOrder = section.sortOrder;
        break;
    }
  }

  return data;
}

function persistedMenuShape(menu: Menu) {
  return {
    version: menu.version,
    settings: {
      title: menu.settings.title,
      subtitle: menu.settings.subtitle,
      sections: menu.settings.sections.map((section) => ({
        id: section.id,
        label: section.label,
        title: section.title,
        note: section.note,
        dishIds: section.dishIds,
        sortOrder: section.sortOrder,
      })),
    },
    dishes: menu.dishes,
  };
}

function hasSamePersistedMenu(left: Menu, right: Menu) {
  return (
    JSON.stringify(persistedMenuShape(left)) ===
    JSON.stringify(persistedMenuShape(right))
  );
}

async function syncExistingSectionDishes(
  transaction: Prisma.TransactionClient,
  sectionId: string,
  currentSection: MenuSection,
  desiredSection: MenuSection,
) {
  const currentDishIds = currentSection.dishIds ?? [];
  const desiredDishIds = desiredSection.dishIds ?? [];
  const currentOrder = new Map(
    currentDishIds.map((dishId, index) => [dishId, index + 1]),
  );
  const desiredMembers = new Set(desiredDishIds);
  const removedDishIds = currentDishIds.filter(
    (dishId) => !desiredMembers.has(dishId),
  );

  if (removedDishIds.length > 0) {
    await transaction.sectionDish.deleteMany({
      where: {
        sectionId,
        dishId: {
          in: removedDishIds,
        },
      },
    });
  }

  for (const [index, dishId] of desiredDishIds.entries()) {
    const sortOrder = index + 1;
    const existingSortOrder = currentOrder.get(dishId);

    if (existingSortOrder === undefined) {
      await transaction.sectionDish.create({
        data: {
          sectionId,
          dishId,
          sortOrder,
        },
      });
    } else if (existingSortOrder !== sortOrder) {
      await transaction.sectionDish.update({
        where: {
          sectionId_dishId: {
            sectionId,
            dishId,
          },
        },
        data: {
          sortOrder,
        },
      });
    }
  }
}

async function archiveUnreferencedDishes(
  transaction: Prisma.TransactionClient,
  dishIds: number[],
) {
  for (const dishId of dishIds) {
    const [menuReferences, sectionReferences] = await Promise.all([
      transaction.menuDish.count({
        where: {
          dishId,
        },
      }),
      transaction.sectionDish.count({
        where: {
          dishId,
        },
      }),
    ]);

    if (menuReferences === 0 && sectionReferences === 0) {
      await transaction.dish.update({
        where: {
          id: dishId,
        },
        data: {
          status: DishStatus.ARCHIVED,
          version: {
            increment: 1,
          },
        },
      });
    }
  }
}

async function assertAddedDishIdsAreAvailable(
  transaction: Prisma.TransactionClient,
  addedDishIds: number[],
) {
  if (addedDishIds.length === 0) {
    return;
  }

  const [existingDishes, maximumDishId] = await Promise.all([
    transaction.dish.findMany({
      where: {
        id: {
          in: addedDishIds,
        },
      },
      select: {
        id: true,
      },
    }),
    transaction.dish.aggregate({
      _max: {
        id: true,
      },
    }),
  ]);

  if (existingDishes.length > 0) {
    throw new DatabaseDishIdConflictError(
      `Dish ids already exist: ${existingDishes.map((dish) => dish.id).join(", ")}`,
    );
  }

  const currentMaximum = maximumDishId._max.id ?? 0;
  const sortedAddedIds = [...addedDishIds].sort(
    (left, right) => left - right,
  );

  for (const [index, dishId] of sortedAddedIds.entries()) {
    const expectedDishId = currentMaximum + index + 1;
    if (dishId !== expectedDishId) {
      throw new DatabaseDishIdConflictError(
        `New dish id must be ${expectedDishId}, received ${dishId}`,
      );
    }
  }
}

async function synchronizeDishIdSequence(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$queryRaw<Array<{ value: bigint }>>`
    SELECT setval(
      pg_get_serial_sequence('"Dish"', 'id'),
      (SELECT MAX(id) FROM "Dish"),
      true
    ) AS "value"
  `;
}

async function applyPlan(
  transaction: Prisma.TransactionClient,
  menuId: string,
  currentMenu: Menu,
  plan: MenuWritePlan,
) {
  const desiredMenu = plan.normalizedMenu;
  const desiredDishesById = new Map(
    desiredMenu.dishes.map((dish) => [dish.id, dish]),
  );
  const currentSectionsById = new Map(
    currentMenu.settings.sections.map((section) => [section.id, section]),
  );
  const desiredSectionsById = new Map(
    desiredMenu.settings.sections.map((section) => [section.id, section]),
  );

  const claimedMenu = await transaction.menu.updateMany({
    where: {
      id: menuId,
      version: plan.expectedVersion,
    },
    data: {
      title: desiredMenu.settings.title,
      subtitle: desiredMenu.settings.subtitle || null,
      version: plan.nextVersion,
    },
  });

  if (claimedMenu.count !== 1) {
    throw new MenuVersionConflictError(
      plan.expectedVersion,
      null,
    );
  }

  for (const dishId of plan.changes.dishes.addedIds) {
    const dish = desiredDishesById.get(dishId);
    if (!dish) {
      throw new DatabaseMenuWriteVerificationError();
    }

    await transaction.dish.create({
      data: dishCreateData(dish),
    });
    await transaction.menuDish.create({
      data: {
        menuId,
        dishId,
        recommended: dish.recommended,
        visible: dish.visible,
        sortOrder: dish.sortOrder,
      },
    });
  }

  for (const change of plan.changes.dishes.updated) {
    const dish = desiredDishesById.get(change.id);
    if (!dish) {
      throw new DatabaseMenuWriteVerificationError();
    }

    await transaction.dish.update({
      where: {
        id: change.id,
      },
      data: dishUpdateData(dish, change.fields),
    });
  }

  for (const change of plan.changes.menuDishes.updated) {
    const dish = desiredDishesById.get(change.id);
    if (!dish) {
      throw new DatabaseMenuWriteVerificationError();
    }

    await transaction.menuDish.update({
      where: {
        menuId_dishId: {
          menuId,
          dishId: change.id,
        },
      },
      data: menuDishUpdateData(dish, change.fields),
    });
  }

  const sectionDatabaseIds = new Map(
    (
      await transaction.menuSection.findMany({
        where: {
          menuId,
        },
        select: {
          id: true,
          slug: true,
        },
      })
    ).map((section) => [section.slug, section.id]),
  );

  for (const sectionSlug of plan.changes.sections.addedIds) {
    const section = desiredSectionsById.get(sectionSlug);
    if (!section) {
      throw new DatabaseMenuWriteVerificationError();
    }

    const createdSection = await transaction.menuSection.create({
      data: {
        menuId,
        slug: section.id,
        label: section.label,
        title: section.title,
        note: section.note || null,
        sortOrder: section.sortOrder,
      },
      select: {
        id: true,
      },
    });
    sectionDatabaseIds.set(section.id, createdSection.id);

    const dishIds = section.dishIds ?? [];
    if (dishIds.length > 0) {
      await transaction.sectionDish.createMany({
        data: dishIds.map((dishId, index) => ({
          sectionId: createdSection.id,
          dishId,
          sortOrder: index + 1,
        })),
      });
    }
  }

  for (const change of plan.changes.sections.updated) {
    const section = desiredSectionsById.get(change.id);
    const sectionId = sectionDatabaseIds.get(change.id);
    if (!section || !sectionId) {
      throw new DatabaseMenuWriteVerificationError();
    }

    await transaction.menuSection.update({
      where: {
        id: sectionId,
      },
      data: sectionUpdateData(section, change.fields),
    });
  }

  for (const change of plan.changes.sectionDishes) {
    const sectionId = sectionDatabaseIds.get(change.sectionId);
    const currentSection = currentSectionsById.get(change.sectionId);
    const desiredSection = desiredSectionsById.get(change.sectionId);
    if (!sectionId || !currentSection || !desiredSection) {
      throw new DatabaseMenuWriteVerificationError();
    }

    await syncExistingSectionDishes(
      transaction,
      sectionId,
      currentSection,
      desiredSection,
    );
  }

  if (plan.changes.sections.removedIds.length > 0) {
    await transaction.menuSection.deleteMany({
      where: {
        menuId,
        slug: {
          in: plan.changes.sections.removedIds,
        },
      },
    });
  }

  if (plan.changes.dishes.removedIds.length > 0) {
    await transaction.menuDish.deleteMany({
      where: {
        menuId,
        dishId: {
          in: plan.changes.dishes.removedIds,
        },
      },
    });
    await archiveUnreferencedDishes(
      transaction,
      plan.changes.dishes.removedIds,
    );
  }

}

export async function writeMenuToDatabase(
  desiredInput: unknown,
  options: DatabaseMenuWriteOptions = {},
): Promise<DatabaseMenuWriteResult> {
  const menuSlug = options.menuSlug ?? DEFAULT_MENU_READ_SLUG;

  return prisma.$transaction(
    async (transaction) => {
      const menuRecord = await transaction.menu.findUnique({
        where: {
          slug: menuSlug,
        },
        select: {
          id: true,
        },
      });
      if (!menuRecord) {
        throw new DatabaseMenuNotFoundError(menuSlug);
      }

      const currentMenu = await readMenuFromDatabaseWithClient(
        transaction,
        menuSlug,
      );
      if (!currentMenu) {
        throw new DatabaseMenuNotFoundError(menuSlug);
      }

      const plan = createMenuWritePlan(currentMenu, desiredInput);
      if (!plan.hasChanges) {
        return {
          menu: currentMenu,
          plan,
        };
      }

      await assertAddedDishIdsAreAvailable(
        transaction,
        plan.changes.dishes.addedIds,
      );
      await applyPlan(transaction, menuRecord.id, currentMenu, plan);

      const savedMenu = await readMenuFromDatabaseWithClient(
        transaction,
        menuSlug,
      );
      if (
        !savedMenu ||
        !hasSamePersistedMenu(savedMenu, plan.normalizedMenu)
      ) {
        throw new DatabaseMenuWriteVerificationError();
      }

      const result = {
        menu: savedMenu,
        plan,
      };
      await options.beforeCommit?.(result);

      if (plan.changes.dishes.addedIds.length > 0) {
        await synchronizeDishIdSequence(transaction);
      }

      return result;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 30_000,
    },
  );
}
