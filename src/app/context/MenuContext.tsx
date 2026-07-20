'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dishes as fallbackDishes } from '../data/dishes.mjs';
import type { MenuDish } from '../../types/dish';
import type { Menu, MenuSection, MenuSettings } from '../../types/menu';

const fallbackSections: MenuSection[] = [
  { id: 'recommend', label: '推荐', title: '今晚推荐', note: '掌勺的拿手菜，先点不踩雷', category: null, recommendedOnly: true, dishIds: null, sortOrder: 1 },
  { id: 'cold', label: '凉菜', title: '凉菜', note: '开场先垫一口', category: '凉菜', recommendedOnly: false, dishIds: null, sortOrder: 2 },
  { id: 'seafood', label: '海鲜', title: '海鲜河鲜', note: '鲜味担当', category: '海鲜', recommendedOnly: false, dishIds: null, sortOrder: 3 },
  { id: 'meat', label: '肉菜', title: '肉菜', note: '硬菜撑场面', category: '肉菜', recommendedOnly: false, dishIds: null, sortOrder: 4 },
  { id: 'veggie', label: '素菜', title: '素菜时蔬', note: '解腻清口', category: '素菜', recommendedOnly: false, dishIds: null, sortOrder: 5 },
  { id: 'staple', label: '主食', title: '主食', note: '压轴管饱', category: '主食', recommendedOnly: false, dishIds: null, sortOrder: 6 },
  { id: 'soup', label: '汤甜', title: '汤羹甜品', note: '收尾暖胃', category: '汤甜', recommendedOnly: false, dishIds: null, sortOrder: 7 },
];

const fallbackMenu: Menu = {
  version: 1,
  updatedAt: '',
  settings: {
    title: '灶台菜单',
    subtitle: `今晚想吃什么，自己点 · 共 ${fallbackDishes.length} 道家常菜`,
    sections: fallbackSections,
  },
  dishes: fallbackDishes.map((dish, index) => ({
    ...dish,
    visible: true,
    sortOrder: index + 1,
  })),
};

interface MenuContextValue {
  menu: Menu;
  settings: MenuSettings;
  dishes: MenuDish[];
  sections: MenuSection[];
  loading: boolean;
  error: string | null;
  refreshMenu: () => Promise<Menu>;
}

interface MenuProviderProps {
  children: ReactNode;
}

type UnknownRecord = Record<string, unknown>;

const MenuContext = createContext<MenuContextValue | null>(null);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanDishIds(ids: unknown): number[] {
  const seen = new Set<number>();
  return (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => {
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function normalizeMenu(input: unknown): Menu {
  const menu = isRecord(input) ? input : {};
  const rawDishes: unknown[] = Array.isArray(menu.dishes) ? menu.dishes : fallbackMenu.dishes;
  const rawSettings: UnknownRecord = isRecord(menu.settings) ? menu.settings : { ...fallbackMenu.settings };
  const rawSections = Array.isArray(rawSettings.sections) ? rawSettings.sections : fallbackSections;

  return {
    version: Number(menu.version) || 1,
    updatedAt: String(menu.updatedAt || ''),
    settings: {
      title: String(rawSettings.title || '灶台菜单'),
      subtitle: String(rawSettings.subtitle || ''),
      sections: rawSections
        .filter((section): section is UnknownRecord => isRecord(section) && Boolean(section.id) && Boolean(section.label))
        .map((section, index): MenuSection => ({
          id: String(section.id),
          label: String(section.label),
          title: String(section.title || section.label),
          note: String(section.note || ''),
          category: section.category ? String(section.category) : null,
          recommendedOnly: Boolean(section.recommendedOnly),
          dishIds: Array.isArray(section.dishIds) ? cleanDishIds(section.dishIds) : null,
          sortOrder: Number(section.sortOrder) || index + 1,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    },
    dishes: rawDishes
      .filter((dish): dish is UnknownRecord => (
        isRecord(dish)
        && Number.isFinite(Number(dish.id))
        && Boolean(dish.name)
        && dish.visible !== false
      ))
      .map((dish, index): MenuDish => {
        const image = dish.image || '/images/dishes/default-dish.png';
        return {
          id: Number(dish.id),
          name: String(dish.name),
          slug: String(dish.slug || `dish-${dish.id}`),
          description: String(dish.description || ''),
          date: String(dish.date || '今晚菜单'),
          prepTime: String(dish.prepTime || '30分钟'),
          category: String(dish.category || '肉菜'),
          accent: String(dish.accent || ''),
          difficulty: String(dish.difficulty || '简单'),
          recommended: Boolean(dish.recommended),
          servings: String(dish.servings || '2-3人份'),
          image: String(image),
          images: Array.isArray(dish.images) && dish.images.length ? dish.images.map(String) : [String(image)],
          ingredients: Array.isArray(dish.ingredients) ? dish.ingredients.map(String) : [],
          visible: true,
          sortOrder: Number(dish.sortOrder) || index + 1,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id),
  };
}

export function MenuProvider({ children }: MenuProviderProps) {
  const [menu, setMenu] = useState<Menu>(() => normalizeMenu(fallbackMenu));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMenu = useCallback(async (): Promise<Menu> => {
    try {
      const response = await fetch('/api/menu', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu API ${response.status}`);
      const nextMenu = normalizeMenu(await response.json());
      setMenu(nextMenu);
      setError(null);
      return nextMenu;
    } catch (nextError: unknown) {
      setError(nextError instanceof Error ? nextError.message : '读取菜单失败');
      return normalizeMenu(fallbackMenu);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshMenu();
    const timer = window.setInterval(refreshMenu, 10_000);
    return () => window.clearInterval(timer);
  }, [refreshMenu]);

  const value = useMemo(() => ({
    menu,
    settings: menu.settings,
    dishes: menu.dishes,
    sections: menu.settings.sections,
    loading,
    error,
    refreshMenu,
  }), [error, loading, menu, refreshMenu]);

  return (
    <MenuContext.Provider value={value}>
      {children}
    </MenuContext.Provider>
  );
}

export function useMenu() {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error('useMenu must be used within a MenuProvider');
  }
  return context;
}
