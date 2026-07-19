import type { MenuDish } from './dish';

export interface MenuSection {
  id: string;
  label: string;
  title: string;
  note: string;
  category: string | null;
  recommendedOnly: boolean;
  dishIds: number[] | null;
  sortOrder: number;
}

export interface MenuSettings {
  title: string;
  subtitle: string;
  sections: MenuSection[];
}

export interface Menu {
  version: number;
  updatedAt: string;
  settings: MenuSettings;
  dishes: MenuDish[];
}
