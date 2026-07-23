import assert from "node:assert/strict";

import type { Menu } from "../src/types/menu.ts";

export interface MenuWriteScenario {
  desiredMenu: Menu;
  editedDishId: number;
  removedDishId: number;
  addedDishId: number;
  removedSectionId: string;
  addedSectionId: string;
}

export function createMenuWriteScenario(
  currentMenu: Menu,
  marker: string,
): MenuWriteScenario {
  const desiredMenu = structuredClone(currentMenu);
  const editedDish = desiredMenu.dishes[0];
  const secondDish = desiredMenu.dishes[1];

  assert.ok(editedDish);
  assert.ok(secondDish);

  desiredMenu.settings.title += marker;
  editedDish.description += marker;
  editedDish.recommended = !editedDish.recommended;

  const firstDishOrder = editedDish.sortOrder;
  editedDish.sortOrder = secondDish.sortOrder;
  secondDish.sortOrder = firstDishOrder;

  desiredMenu.settings.sections[0].title += marker;
  const sectionWithMultipleDishes = desiredMenu.settings.sections.find(
    (section) => (section.dishIds?.length ?? 0) >= 2,
  );
  assert.ok(sectionWithMultipleDishes?.dishIds);
  [
    sectionWithMultipleDishes.dishIds[0],
    sectionWithMultipleDishes.dishIds[1],
  ] = [
    sectionWithMultipleDishes.dishIds[1],
    sectionWithMultipleDishes.dishIds[0],
  ];

  const removedDish = desiredMenu.dishes.at(-1);
  assert.ok(removedDish);
  desiredMenu.dishes = desiredMenu.dishes.filter(
    (dish) => dish.id !== removedDish.id,
  );
  desiredMenu.settings.sections = desiredMenu.settings.sections.map(
    (section) => ({
      ...section,
      dishIds:
        section.dishIds?.filter((dishId) => dishId !== removedDish.id) ??
        null,
    }),
  );

  const addedDishId =
    Math.max(...currentMenu.dishes.map((dish) => dish.id)) + 1;
  desiredMenu.dishes.push({
    id: addedDishId,
    name: `事务测试新菜${marker}`,
    slug: `dish-${addedDishId}`,
    description: "",
    date: "今晚菜单",
    prepTime: "30分钟",
    category: "肉菜",
    accent: "",
    difficulty: "简单",
    recommended: false,
    servings: "2-3人份",
    image: "/images/dishes/default-dish.png",
    images: ["/images/dishes/default-dish.png"],
    ingredients: [],
    visible: true,
    sortOrder:
      Math.max(...desiredMenu.dishes.map((dish) => dish.sortOrder)) + 1,
  });

  const removedSection = desiredMenu.settings.sections.at(-1);
  assert.ok(removedSection);
  desiredMenu.settings.sections = desiredMenu.settings.sections.filter(
    (section) => section.id !== removedSection.id,
  );

  const addedSectionId = "database-write-test-section";
  desiredMenu.settings.sections.push({
    id: addedSectionId,
    label: "事务测试",
    title: `事务测试${marker}`,
    note: "",
    category: null,
    recommendedOnly: false,
    dishIds: [editedDish.id, addedDishId],
    sortOrder:
      Math.max(
        ...desiredMenu.settings.sections.map(
          (section) => section.sortOrder,
        ),
      ) + 1,
  });

  return {
    desiredMenu,
    editedDishId: editedDish.id,
    removedDishId: removedDish.id,
    addedDishId,
    removedSectionId: removedSection.id,
    addedSectionId,
  };
}
