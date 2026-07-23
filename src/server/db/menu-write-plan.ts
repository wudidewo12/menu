import type { Menu, MenuSection } from "../../types/menu";
import type { MenuDish } from "../../types/dish";

const DEFAULT_DISH_IMAGE = "/images/dishes/default-dish.png";
const SUPPORTED_DIFFICULTIES = new Set(["简单", "中等", "困难"]);
const DISH_FIELDS = [
  "name",
  "description",
  "prepTime",
  "category",
  "accent",
  "difficulty",
  "servings",
  "ingredients",
] as const;
const MENU_DISH_FIELDS = ["recommended", "visible", "sortOrder"] as const;
const SECTION_FIELDS = ["label", "title", "note", "sortOrder"] as const;

type DishField = (typeof DISH_FIELDS)[number];
type MenuDishField = (typeof MENU_DISH_FIELDS)[number];
type SectionField = (typeof SECTION_FIELDS)[number];

export class MenuWriteValidationError extends Error {
  readonly code = "MENU_WRITE_VALIDATION_FAILED";

  constructor(readonly issues: string[]) {
    super(`Menu write validation failed:\n- ${issues.join("\n- ")}`);
    this.name = "MenuWriteValidationError";
  }
}

export interface ChangedDish {
  id: number;
  fields: DishField[];
}

export interface ChangedMenuDish {
  id: number;
  fields: MenuDishField[];
}

export interface ChangedSection {
  id: string;
  fields: SectionField[];
}

export interface ChangedSectionDishes {
  sectionId: string;
  addedDishIds: number[];
  removedDishIds: number[];
  reordered: boolean;
}

export interface MenuWritePlan {
  expectedVersion: number;
  nextVersion: number;
  hasChanges: boolean;
  normalizedMenu: Menu;
  changes: {
    menuFields: Array<"title" | "subtitle">;
    dishes: {
      addedIds: number[];
      removedIds: number[];
      updated: ChangedDish[];
    };
    menuDishes: {
      updated: ChangedMenuDish[];
    };
    sections: {
      addedIds: string[];
      removedIds: string[];
      updated: ChangedSection[];
    };
    sectionDishes: ChangedSectionDishes[];
  };
  summary: {
    menuFields: number;
    dishesAdded: number;
    dishesRemoved: number;
    dishesUpdated: number;
    menuDishesUpdated: number;
    sectionsAdded: number;
    sectionsRemoved: number;
    sectionsUpdated: number;
    sectionMembershipsChanged: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  path: string,
  issues: string[],
  allowEmpty = false,
) {
  if (typeof value !== "string") {
    issues.push(`${path} 必须是字符串`);
    return "";
  }

  const result = value.trim();
  if (!allowEmpty && result.length === 0) {
    issues.push(`${path} 不能为空`);
  }

  return result;
}

function requiredBoolean(value: unknown, path: string, issues: string[]) {
  if (typeof value !== "boolean") {
    issues.push(`${path} 必须是 true 或 false`);
    return false;
  }

  return value;
}

function positiveInteger(value: unknown, path: string, issues: string[]) {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    issues.push(`${path} 必须是大于 0 的整数`);
    return 0;
  }

  return Number(value);
}

function stringArray(value: unknown, path: string, issues: string[]) {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是字符串数组`);
    return [];
  }

  return value.map((item, index) =>
    requiredString(item, `${path}[${index}]`, issues),
  );
}

function numberArray(value: unknown, path: string, issues: string[]) {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是菜品 ID 数组或 null`);
    return [];
  }

  return value.map((item, index) =>
    positiveInteger(item, `${path}[${index}]`, issues),
  );
}

function reportDuplicates<T>(
  values: T[],
  label: string,
  issues: string[],
) {
  const seen = new Set<T>();
  const duplicates = new Set<T>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }

  if (duplicates.size > 0) {
    issues.push(`${label} 不能重复：${[...duplicates].join(", ")}`);
  }
}

function parsePrepTime(value: string, path: string, issues: string[]) {
  const match = /^(\d+)分钟$/.exec(value);
  if (!match || Number(match[1]) <= 0) {
    issues.push(`${path} 必须使用“30分钟”这样的格式`);
  }
}

function parseServings(value: string, path: string, issues: string[]) {
  const match = /^(\d+)(?:-(\d+))?人份$/.exec(value);
  if (!match) {
    issues.push(`${path} 必须使用“2人份”或“2-3人份”这样的格式`);
    return;
  }

  const minimum = Number(match[1]);
  const maximum = Number(match[2] ?? match[1]);
  if (minimum <= 0 || maximum < minimum) {
    issues.push(`${path} 的人数范围无效`);
  }
}

function normalizeDish(
  value: unknown,
  index: number,
  issues: string[],
): MenuDish {
  const path = `dishes[${index}]`;
  const input = isRecord(value) ? value : {};

  if (!isRecord(value)) {
    issues.push(`${path} 必须是一条菜品数据`);
  }

  const id = positiveInteger(input.id, `${path}.id`, issues);
  const name = requiredString(input.name, `${path}.name`, issues);
  const slug = requiredString(input.slug, `${path}.slug`, issues);
  const description = requiredString(
    input.description,
    `${path}.description`,
    issues,
    true,
  );
  const date = requiredString(input.date, `${path}.date`, issues);
  const prepTime = requiredString(input.prepTime, `${path}.prepTime`, issues);
  const category = requiredString(input.category, `${path}.category`, issues);
  const accent = requiredString(input.accent, `${path}.accent`, issues, true);
  const difficulty = requiredString(
    input.difficulty,
    `${path}.difficulty`,
    issues,
  );
  const recommended = requiredBoolean(
    input.recommended,
    `${path}.recommended`,
    issues,
  );
  const servings = requiredString(input.servings, `${path}.servings`, issues);
  const image = requiredString(input.image, `${path}.image`, issues);
  const images = stringArray(input.images, `${path}.images`, issues);
  const ingredients = stringArray(
    input.ingredients,
    `${path}.ingredients`,
    issues,
  );
  const visible = requiredBoolean(input.visible, `${path}.visible`, issues);
  const sortOrder = positiveInteger(
    input.sortOrder,
    `${path}.sortOrder`,
    issues,
  );

  parsePrepTime(prepTime, `${path}.prepTime`, issues);
  parseServings(servings, `${path}.servings`, issues);

  if (!SUPPORTED_DIFFICULTIES.has(difficulty)) {
    issues.push(`${path}.difficulty 只能是“简单”“中等”或“困难”`);
  }
  if (images.length === 0) {
    issues.push(`${path}.images 至少要有一张图片`);
  } else if (images[0] !== image) {
    issues.push(`${path}.image 必须和 images[0] 相同`);
  }

  return {
    id,
    name,
    slug,
    description,
    date,
    prepTime,
    category,
    accent,
    difficulty,
    recommended,
    servings,
    image,
    images,
    ingredients,
    visible,
    sortOrder,
  };
}

function normalizeSection(
  value: unknown,
  index: number,
  issues: string[],
): MenuSection {
  const path = `settings.sections[${index}]`;
  const input = isRecord(value) ? value : {};

  if (!isRecord(value)) {
    issues.push(`${path} 必须是一条分区数据`);
  }

  const category =
    input.category === null
      ? null
      : requiredString(input.category, `${path}.category`, issues);
  const dishIds =
    input.dishIds === null
      ? null
      : numberArray(input.dishIds, `${path}.dishIds`, issues);

  if (dishIds) {
    reportDuplicates(dishIds, `${path}.dishIds`, issues);
  }

  return {
    id: requiredString(input.id, `${path}.id`, issues),
    label: requiredString(input.label, `${path}.label`, issues),
    title: requiredString(input.title, `${path}.title`, issues),
    note: requiredString(input.note, `${path}.note`, issues, true),
    category,
    recommendedOnly: requiredBoolean(
      input.recommendedOnly,
      `${path}.recommendedOnly`,
      issues,
    ),
    dishIds,
    sortOrder: positiveInteger(
      input.sortOrder,
      `${path}.sortOrder`,
      issues,
    ),
  };
}

function materializeSectionDishIds(
  sections: MenuSection[],
  dishes: MenuDish[],
  issues: string[],
) {
  const dishesById = new Map(dishes.map((dish) => [dish.id, dish]));

  return sections.map((section, index) => {
    const path = `settings.sections[${index}].dishIds`;
    let dishIds: number[];

    if (section.dishIds === null) {
      dishIds = dishes
        .filter((dish) => {
          if (!dish.visible) {
            return false;
          }
          if (section.recommendedOnly) {
            return dish.recommended;
          }
          return dish.category === section.category;
        })
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder || left.id - right.id,
        )
        .map((dish) => dish.id);
    } else {
      dishIds = section.dishIds.filter((dishId) => {
        const dish = dishesById.get(dishId);
        if (!dish) {
          issues.push(`${path} 引用了不存在的菜品 ID：${dishId}`);
          return false;
        }
        return dish.visible;
      });
    }

    return {
      ...section,
      dishIds,
    };
  });
}

function normalizeMenu(value: unknown, issues: string[]): Menu {
  const input = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    issues.push("菜单必须是一个对象");
  }

  const settingsInput = isRecord(input.settings) ? input.settings : {};
  if (!isRecord(input.settings)) {
    issues.push("settings 必须是一个对象");
  }

  const dishInputs = Array.isArray(input.dishes) ? input.dishes : [];
  const sectionInputs = Array.isArray(settingsInput.sections)
    ? settingsInput.sections
    : [];

  if (!Array.isArray(input.dishes)) {
    issues.push("dishes 必须是数组");
  }
  if (!Array.isArray(settingsInput.sections)) {
    issues.push("settings.sections 必须是数组");
  }

  const dishes = dishInputs.map((dish, index) =>
    normalizeDish(dish, index, issues),
  );
  const sections = sectionInputs.map((section, index) =>
    normalizeSection(section, index, issues),
  );

  reportDuplicates(
    dishes.map((dish) => dish.id),
    "菜品 ID",
    issues,
  );
  reportDuplicates(
    dishes.map((dish) => dish.slug),
    "菜品 slug",
    issues,
  );
  reportDuplicates(
    dishes.map((dish) => dish.sortOrder),
    "菜品 sortOrder",
    issues,
  );
  reportDuplicates(
    sections.map((section) => section.id),
    "分区 ID",
    issues,
  );
  reportDuplicates(
    sections.map((section) => section.sortOrder),
    "分区 sortOrder",
    issues,
  );

  return {
    version: positiveInteger(input.version, "version", issues),
    updatedAt: requiredString(input.updatedAt, "updatedAt", issues),
    settings: {
      title: requiredString(settingsInput.title, "settings.title", issues),
      subtitle: requiredString(
        settingsInput.subtitle,
        "settings.subtitle",
        issues,
        true,
      ),
      sections: materializeSectionDishIds(sections, dishes, issues),
    },
    dishes,
  };
}

function sameValue(left: unknown, right: unknown) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function changedFields<T extends object, K extends keyof T>(
  current: T,
  desired: T,
  fields: readonly K[],
) {
  return fields.filter(
    (field) => !sameValue(current[field], desired[field]),
  );
}

function changedSectionDishes(
  current: MenuSection,
  desired: MenuSection,
): ChangedSectionDishes | null {
  const currentIds = current.dishIds ?? [];
  const desiredIds = desired.dishIds ?? [];
  const currentMembers = new Set(currentIds);
  const desiredMembers = new Set(desiredIds);
  const addedDishIds = desiredIds.filter((id) => !currentMembers.has(id));
  const removedDishIds = currentIds.filter((id) => !desiredMembers.has(id));
  const reordered =
    addedDishIds.length === 0 &&
    removedDishIds.length === 0 &&
    !sameValue(currentIds, desiredIds);

  if (
    addedDishIds.length === 0 &&
    removedDishIds.length === 0 &&
    !reordered
  ) {
    return null;
  }

  return {
    sectionId: desired.id,
    addedDishIds,
    removedDishIds,
    reordered,
  };
}

export function createMenuWritePlan(
  currentInput: unknown,
  desiredInput: unknown,
): MenuWritePlan {
  const currentIssues: string[] = [];
  const desiredIssues: string[] = [];
  const current = normalizeMenu(currentInput, currentIssues);
  const desired = normalizeMenu(desiredInput, desiredIssues);

  if (currentIssues.length > 0) {
    throw new MenuWriteValidationError(
      currentIssues.map((issue) => `当前数据库菜单：${issue}`),
    );
  }

  if (desired.version !== current.version) {
    desiredIssues.push(
      `version 已过期：提交的是 ${desired.version}，数据库当前是 ${current.version}`,
    );
  }

  const currentDishesById = new Map(
    current.dishes.map((dish) => [dish.id, dish]),
  );
  const desiredDishesById = new Map(
    desired.dishes.map((dish) => [dish.id, dish]),
  );

  for (const desiredDish of desired.dishes) {
    const currentDish = currentDishesById.get(desiredDish.id);
    if (!currentDish) {
      if (
        desiredDish.image !== DEFAULT_DISH_IMAGE ||
        !sameValue(desiredDish.images, [DEFAULT_DISH_IMAGE])
      ) {
        desiredIssues.push(
          `新菜品 ${desiredDish.id} 只能先使用默认图片，真实图片必须通过上传接口添加`,
        );
      }
      continue;
    }

    if (desiredDish.slug !== currentDish.slug) {
      desiredIssues.push(
        `菜品 ${desiredDish.id} 的 slug 不能通过菜单保存接口修改`,
      );
    }
    if (desiredDish.date !== currentDish.date) {
      desiredIssues.push(
        `菜品 ${desiredDish.id} 的 date 不能通过菜单保存接口修改`,
      );
    }
    if (
      desiredDish.image !== currentDish.image ||
      !sameValue(desiredDish.images, currentDish.images)
    ) {
      desiredIssues.push(
        `菜品 ${desiredDish.id} 的图片不能通过菜单保存接口修改，请使用图片上传接口`,
      );
    }
  }

  if (desiredIssues.length > 0) {
    throw new MenuWriteValidationError(desiredIssues);
  }

  const menuFields: Array<"title" | "subtitle"> = [];
  if (current.settings.title !== desired.settings.title) {
    menuFields.push("title");
  }
  if (current.settings.subtitle !== desired.settings.subtitle) {
    menuFields.push("subtitle");
  }

  const addedDishIds = desired.dishes
    .filter((dish) => !currentDishesById.has(dish.id))
    .map((dish) => dish.id);
  const removedDishIds = current.dishes
    .filter((dish) => !desiredDishesById.has(dish.id))
    .map((dish) => dish.id);
  const updatedDishes: ChangedDish[] = [];
  const updatedMenuDishes: ChangedMenuDish[] = [];

  for (const desiredDish of desired.dishes) {
    const currentDish = currentDishesById.get(desiredDish.id);
    if (!currentDish) {
      continue;
    }

    const dishFields = changedFields(
      currentDish,
      desiredDish,
      DISH_FIELDS,
    );
    const menuDishFields = changedFields(
      currentDish,
      desiredDish,
      MENU_DISH_FIELDS,
    );

    if (dishFields.length > 0) {
      updatedDishes.push({
        id: desiredDish.id,
        fields: dishFields,
      });
    }
    if (menuDishFields.length > 0) {
      updatedMenuDishes.push({
        id: desiredDish.id,
        fields: menuDishFields,
      });
    }
  }

  const currentSectionsById = new Map(
    current.settings.sections.map((section) => [section.id, section]),
  );
  const desiredSectionsById = new Map(
    desired.settings.sections.map((section) => [section.id, section]),
  );
  const addedSectionIds = desired.settings.sections
    .filter((section) => !currentSectionsById.has(section.id))
    .map((section) => section.id);
  const removedSectionIds = current.settings.sections
    .filter((section) => !desiredSectionsById.has(section.id))
    .map((section) => section.id);
  const updatedSections: ChangedSection[] = [];
  const sectionDishes: ChangedSectionDishes[] = [];

  for (const desiredSection of desired.settings.sections) {
    const currentSection = currentSectionsById.get(desiredSection.id);
    if (!currentSection) {
      continue;
    }

    const fields = changedFields(
      currentSection,
      desiredSection,
      SECTION_FIELDS,
    );
    const membershipChange = changedSectionDishes(
      currentSection,
      desiredSection,
    );

    if (fields.length > 0) {
      updatedSections.push({
        id: desiredSection.id,
        fields,
      });
    }
    if (membershipChange) {
      sectionDishes.push(membershipChange);
    }
  }

  const summary = {
    menuFields: menuFields.length,
    dishesAdded: addedDishIds.length,
    dishesRemoved: removedDishIds.length,
    dishesUpdated: updatedDishes.length,
    menuDishesUpdated: updatedMenuDishes.length,
    sectionsAdded: addedSectionIds.length,
    sectionsRemoved: removedSectionIds.length,
    sectionsUpdated: updatedSections.length,
    sectionMembershipsChanged: sectionDishes.length,
  };
  const hasChanges = Object.values(summary).some((count) => count > 0);

  return {
    expectedVersion: current.version,
    nextVersion: hasChanges ? current.version + 1 : current.version,
    hasChanges,
    normalizedMenu: {
      ...desired,
      version: hasChanges ? current.version + 1 : current.version,
      updatedAt: current.updatedAt,
    },
    changes: {
      menuFields,
      dishes: {
        addedIds: addedDishIds,
        removedIds: removedDishIds,
        updated: updatedDishes,
      },
      menuDishes: {
        updated: updatedMenuDishes,
      },
      sections: {
        addedIds: addedSectionIds,
        removedIds: removedSectionIds,
        updated: updatedSections,
      },
      sectionDishes,
    },
    summary,
  };
}
