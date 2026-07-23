import path from "node:path";

import { createMenuSeedImportPlan } from "../src/server/db/menu-seed-transform.ts";

const plan = await createMenuSeedImportPlan();
const counts = {
  Menu: 1,
  Dish: plan.dishes.length,
  MenuDish: plan.menuDishes.length,
  MenuSection: plan.menuSections.length,
  SectionDish: plan.sectionDishes.length,
  DishImage: plan.dishImages.length,
};
const expectedCounts = {
  Menu: 1,
  Dish: 55,
  MenuDish: 55,
  MenuSection: 7,
  SectionDish: 64,
  DishImage: 55,
};

for (const [recordType, expected] of Object.entries(expectedCounts)) {
  const actual = counts[recordType as keyof typeof counts];

  if (actual !== expected) {
    throw new Error(`${recordType} preview count must be ${expected}, received ${actual}`);
  }
}

const prepMinutes = plan.dishes.map((dish) => dish.prepMinutes);
const servingsMinimums = plan.dishes.map((dish) => dish.servingsMin);
const servingsMaximums = plan.dishes.map((dish) => dish.servingsMax);
const dishIds = plan.dishes.map((dish) => dish.id).sort((left, right) => left - right);
const difficultyCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
const imageDimensions = [
  ...new Set(plan.dishImages.map((image) => `${image.width}x${image.height}`)),
].sort();
const totalImageBytes = plan.dishImages.reduce((total, image) => total + image.byteSize, 0);
const recommendedDishes = plan.menuDishes.filter((dish) => dish.recommended).length;
const visibleDishes = plan.menuDishes.filter((dish) => dish.visible).length;
const sectionCounts = plan.menuSections.map((section) => ({
  slug: section.slug,
  dishes: plan.sectionDishes.filter((dish) => dish.sectionSlug === section.slug).length,
}));

for (const dish of plan.dishes) {
  difficultyCounts[dish.difficulty] += 1;
}

if (!dishIds.every((dishId, index) => dishId === index + 1)) {
  throw new Error("Dish ids must remain sequential from 1 through 55 for the first import");
}

if (recommendedDishes !== 9 || visibleDishes !== 55) {
  throw new Error("MenuDish recommendation or visibility counts do not match the source menu");
}

console.log(`source: ${path.relative(process.cwd(), plan.source.path)}`);
console.log(`source updatedAt: ${plan.source.updatedAt.toISOString()}`);
console.log(`menu slug: ${plan.menu.slug}`);
console.log(`menu status: ${plan.menu.status}`);
console.log("record counts:");

for (const [recordType, count] of Object.entries(counts)) {
  console.log(`  ${recordType}: ${count}`);
}

console.log(
  `prep minutes: ${Math.min(...prepMinutes)}-${Math.max(...prepMinutes)}`,
);
console.log(
  `servings: ${Math.min(...servingsMinimums)}-${Math.max(...servingsMaximums)}`,
);
console.log(
  `difficulty: EASY=${difficultyCounts.EASY}, MEDIUM=${difficultyCounts.MEDIUM}, HARD=${difficultyCounts.HARD}`,
);
console.log(`dish ids: ${dishIds[0]}-${dishIds.at(-1)} sequential`);
console.log(`menu dish flags: recommended=${recommendedDishes}, visible=${visibleDishes}`);
console.log(
  `section sizes: ${sectionCounts.map((section) => `${section.slug}=${section.dishes}`).join(", ")}`,
);
console.log(`image dimensions: ${imageDimensions.join(", ")}`);
console.log(`image bytes: ${totalImageBytes}`);
console.log(`source date labels: ${plan.source.dateLabels.join(", ")}`);
console.log(`intentionally unmapped fields: ${plan.source.ignoredFields.length}`);
console.log("database writes: 0");
