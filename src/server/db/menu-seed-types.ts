import type {
  DishDifficulty,
  DishStatus,
  MenuStatus,
} from "../../generated/prisma/enums";

export interface MenuImportPlan {
  menu: {
    slug: string;
    title: string;
    subtitle: string | null;
    status: MenuStatus;
    version: number;
    publishedAt: Date;
  };
  dishes: Array<{
    id: number;
    slug: string;
    name: string;
    description: string;
    prepMinutes: number;
    category: string;
    accent: string | null;
    difficulty: DishDifficulty;
    servingsMin: number;
    servingsMax: number;
    ingredients: string[];
    status: DishStatus;
    version: number;
  }>;
  menuDishes: Array<{
    menuSlug: string;
    dishId: number;
    recommended: boolean;
    visible: boolean;
    sortOrder: number;
  }>;
  menuSections: Array<{
    menuSlug: string;
    sourceId: string;
    slug: string;
    label: string;
    title: string;
    note: string | null;
    visible: boolean;
    sortOrder: number;
  }>;
  sectionDishes: Array<{
    sectionSlug: string;
    dishId: number;
    sortOrder: number;
  }>;
  dishImages: Array<{
    dishId: number;
    storageKey: string;
    altText: string;
    mimeType: "image/webp";
    width: number;
    height: number;
    byteSize: number;
    sortOrder: number;
  }>;
  source: {
    path: string;
    updatedAt: Date;
    dateLabels: string[];
    ignoredFields: string[];
  };
}
