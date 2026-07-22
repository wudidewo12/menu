import type { MenuDish } from '@/types/dish';
import type { MenuSection } from '@/types/menu';

const fallbackDishImage = '/images/dishes/default-dish.png';

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
