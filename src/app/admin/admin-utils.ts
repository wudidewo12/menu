import type { MenuDish } from '@/types/dish';
import type { MenuSection } from '@/types/menu';

const fallbackDishImage = '/images/dishes/default-dish.png';
type MenuSectionSource = Pick<MenuSection, 'recommendedOnly' | 'category'>;
export type MoveDirection = -1 | 1;

interface DishRemovalResult {
  dishes: MenuDish[];
  sections: MenuSection[];
}

function moveSortedItem<T extends { sortOrder: number }>(
  items: T[],
  isTarget: (item: T) => boolean,
  direction: MoveDirection,
): T[] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const index = sorted.findIndex(isTarget);
  const targetIndex = index + direction;

  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return items;

  [sorted[index], sorted[targetIndex]] = [sorted[targetIndex], sorted[index]];

  return sorted.map((item, nextIndex) => ({
    ...item,
    sortOrder: nextIndex + 1,
  }));
}

export function blankSection(index: number): MenuSection {
  return {
    id: `section-${Date.now()}`,
    label: '新分类',
    title: '新分类',
    note: '',
    category: '肉菜',
    recommendedOnly: false,
    dishIds: [],
    sortOrder: index + 1,
  };
}

export function blankDish(id: number, sortOrder: number): MenuDish {
  return {
    id,
    name: '新菜',
    slug: `dish-${id}`,
    description: '',
    date: '今晚菜单',
    prepTime: '30分钟',
    category: '肉菜',
    accent: '',
    difficulty: '简单',
    recommended: false,
    servings: '2-3人份',
    image: fallbackDishImage,
    images: [fallbackDishImage],
    ingredients: [],
    visible: true,
    sortOrder,
  };
}

export function splitIngredients(value: string): string[] {
  return value
    .split(/\n|,|，/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeDishForSave(dish: MenuDish): MenuDish {
  const image = dish.image || fallbackDishImage;

  return {
    ...dish,
    id: Number(dish.id),
    sortOrder: Number(dish.sortOrder) || 999,
    recommended: Boolean(dish.recommended),
    visible: dish.visible !== false,
    image,
    images: Array.isArray(dish.images) && dish.images.length ? dish.images : [image],
    ingredients: Array.isArray(dish.ingredients) ? dish.ingredients : [],
  };
}

export function fieldValue(value: string | null | undefined): string {
  return value ?? '';
}

export function cleanDishIds(ids: unknown): number[] {
  const seen = new Set<number>();

  return (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => {
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export function sectionSourceLabel(section: MenuSection): string {
  return section.recommendedOnly ? '推荐菜' : section.category || '未设置来源';
}

export function automaticDishesForSection(
  section: MenuSectionSource,
  dishes: MenuDish[],
): MenuDish[] {
  return [...dishes]
    .filter((dish) => {
      if (dish.visible === false) return false;
      if (section.recommendedOnly) return Boolean(dish.recommended);
      return dish.category === section.category;
    })
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || Number(a.id) - Number(b.id));
}

export function dishesForSection(section: MenuSection, dishes: MenuDish[]): MenuDish[] {
  if (Array.isArray(section.dishIds)) {
    const byId = new Map(
      dishes
        .filter((dish) => dish.visible !== false)
        .map((dish) => [dish.id, dish]),
    );

    return cleanDishIds(section.dishIds)
      .map((dishId) => byId.get(dishId))
      .filter((dish): dish is MenuDish => Boolean(dish));
  }

  return automaticDishesForSection(section, dishes);
}

export function defaultDishIdsForSource(value: string, dishes: MenuDish[]): number[] {
  const sectionSource: MenuSectionSource = {
    recommendedOnly: value === '__recommended__',
    category: value === '__recommended__' ? null : value,
  };

  return automaticDishesForSection(sectionSource, dishes).map((dish) => dish.id);
}

export function allVisibleDishIds(dishes: MenuDish[]): number[] {
  return [...dishes]
    .filter((dish) => dish.visible !== false)
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || Number(a.id) - Number(b.id))
    .map((dish) => dish.id);
}

export function moveDishByDirection(
  dishes: MenuDish[],
  id: number,
  direction: MoveDirection,
): MenuDish[] {
  return moveSortedItem(dishes, (dish) => dish.id === id, direction);
}

export function moveSectionByDirection(
  sections: MenuSection[],
  id: string,
  direction: MoveDirection,
): MenuSection[] {
  return moveSortedItem(sections, (section) => section.id === id, direction);
}

export function removeDishFromMenu(
  dishes: MenuDish[],
  sections: MenuSection[],
  id: number,
): DishRemovalResult {
  return {
    dishes: dishes
      .filter((dish) => dish.id !== id)
      .map((dish, index) => ({ ...dish, sortOrder: index + 1 })),
    sections: sections.map((section) => ({
      ...section,
      dishIds: Array.isArray(section.dishIds)
        ? cleanDishIds(section.dishIds).filter((dishId) => dishId !== id)
        : section.dishIds,
    })),
  };
}

export function removeSectionById(sections: MenuSection[], id: string): MenuSection[] {
  return sections.filter((section) => section.id !== id);
}

export function reorderDishIds(
  dishIds: number[],
  sourceDishId: number,
  targetDishId: number,
): number[] | null {
  const nextDishIds = [...dishIds];
  const sourceIndex = nextDishIds.indexOf(sourceDishId);
  const targetIndex = nextDishIds.indexOf(targetDishId);

  if (sourceIndex < 0 || targetIndex < 0 || sourceDishId === targetDishId) return null;

  const [movedDishId] = nextDishIds.splice(sourceIndex, 1);
  nextDishIds.splice(targetIndex, 0, movedDishId);

  return nextDishIds;
}
