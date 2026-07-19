'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { dishes as fallbackDishes } from '../data/dishes';

const fallbackSections = [
  { id: 'recommend', label: '推荐', title: '今晚推荐', note: '掌勺的拿手菜，先点不踩雷', category: null, recommendedOnly: true, sortOrder: 1 },
  { id: 'cold', label: '凉菜', title: '凉菜', note: '开场先垫一口', category: '凉菜', recommendedOnly: false, sortOrder: 2 },
  { id: 'seafood', label: '海鲜', title: '海鲜河鲜', note: '鲜味担当', category: '海鲜', recommendedOnly: false, sortOrder: 3 },
  { id: 'meat', label: '肉菜', title: '肉菜', note: '硬菜撑场面', category: '肉菜', recommendedOnly: false, sortOrder: 4 },
  { id: 'veggie', label: '素菜', title: '素菜时蔬', note: '解腻清口', category: '素菜', recommendedOnly: false, sortOrder: 5 },
  { id: 'staple', label: '主食', title: '主食', note: '压轴管饱', category: '主食', recommendedOnly: false, sortOrder: 6 },
  { id: 'soup', label: '汤甜', title: '汤羹甜品', note: '收尾暖胃', category: '汤甜', recommendedOnly: false, sortOrder: 7 },
];

const fallbackMenu = {
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

const MenuContext = createContext(null);

function cleanDishIds(ids) {
  const seen = new Set();
  return (Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((id) => {
      if (!Number.isFinite(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

function normalizeMenu(menu) {
  const rawDishes = Array.isArray(menu?.dishes) ? menu.dishes : fallbackMenu.dishes;
  const rawSettings = menu?.settings && typeof menu.settings === 'object' ? menu.settings : fallbackMenu.settings;
  const rawSections = Array.isArray(rawSettings.sections) ? rawSettings.sections : fallbackSections;

  return {
    version: Number(menu?.version) || 1,
    updatedAt: menu?.updatedAt || '',
    settings: {
      title: rawSettings.title || '灶台菜单',
      subtitle: rawSettings.subtitle || '',
      sections: rawSections
        .filter((section) => section && section.id && section.label)
        .map((section, index) => ({
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
      .filter((dish) => dish && Number.isFinite(Number(dish.id)) && dish.name && dish.visible !== false)
      .map((dish, index) => {
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

export function MenuProvider({ children }) {
  const [menu, setMenu] = useState(() => normalizeMenu(fallbackMenu));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refreshMenu = useCallback(async () => {
    try {
      const response = await fetch('/api/menu', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Menu API ${response.status}`);
      const nextMenu = normalizeMenu(await response.json());
      setMenu(nextMenu);
      setError(null);
      return nextMenu;
    } catch (nextError) {
      setError(nextError.message);
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
