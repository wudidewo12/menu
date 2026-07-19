export interface DishBase {
  id: number;
  name: string;
  slug: string;
  description: string;
  prepTime: string;
  category: string;
  accent: string;
  difficulty: string;
  servings: string;
  ingredients: string[];
}

export interface DishInput extends DishBase {
  recommended?: boolean;
}

export interface Dish extends DishBase {
  recommended: boolean;
  date: string;
  image: string;
  images: string[];
}

export interface MenuDish extends Dish {
  visible: boolean;
  sortOrder: number;
}
