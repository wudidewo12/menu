'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMenu } from './MenuContext';
import type { Dish, MenuDish } from '../../types/dish';
import type { CartItem, OrderItem } from '../../types/order';

const CART_STORAGE_KEY = 'menu.selectedDishes.v1';

interface CartContextValue {
  cartItems: CartItem[];
  cartLoaded: boolean;
  syncError: string | null;
  sessionId: string;
  addToCart: (dish: Dish) => void;
  removeFromCart: (dishId: number) => void;
  updateQuantity: (dishId: number, quantity: number) => void;
  getTotalItems: () => number;
  clearCart: () => void;
  isInCart: (dishId: number) => boolean;
  hrefWithSession: (href: string) => string;
}

interface CartProviderProps {
  children: ReactNode;
}

interface LoadOrderOptions {
  silent?: boolean;
}

type UnknownRecord = Record<string, unknown>;

const CartContext = createContext<CartContextValue | null>(null);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getBrowserSessionId(): string {
  if (typeof window === 'undefined') return 'today';
  const params = new URLSearchParams(window.location.search);
  const rawSession = params.get('session') || 'today';
  return /^[a-zA-Z0-9_-]{1,64}$/.test(rawSession) ? rawSession : 'today';
}

function orderItemsFromCart(items: CartItem[]): OrderItem[] {
  return items.map((item) => ({
    id: item.id,
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));
}

function hydrateCart(orderItems: unknown, dishesById: ReadonlyMap<number, MenuDish>): CartItem[] {
  return (Array.isArray(orderItems) ? orderItems : [])
    .filter((item): item is UnknownRecord => isRecord(item) && Number.isFinite(Number(item.id)))
    .map((item): CartItem | null => {
      const currentDish = dishesById.get(Number(item.id));
      if (!currentDish) return null;
      return {
        ...currentDish,
        quantity: Math.max(1, Number(item.quantity) || 1),
      };
    })
    .filter((item): item is CartItem => item !== null);
}

function readLocalCart(dishesById: ReadonlyMap<number, MenuDish>): CartItem[] {
  try {
    const savedCart = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!savedCart) return [];
    const parsedCart = JSON.parse(savedCart);
    if (!Array.isArray(parsedCart)) return [];
    return hydrateCart(parsedCart, dishesById);
  } catch {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    return [];
  }
}

export function CartProvider({ children }: CartProviderProps) {
  const { dishes } = useMenu();
  const dishesById = useMemo(() => new Map<number, MenuDish>(dishes.map((dish) => [dish.id, dish])), [dishes]);
  const [sessionId, setSessionId] = useState('today');
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const savingRef = useRef<boolean>(false);

  useEffect(() => {
    setSessionId(getBrowserSessionId());
  }, []);

  const applyOrder = useCallback((order: unknown): CartItem[] => {
    const nextCart = hydrateCart(isRecord(order) ? order.items : [], dishesById);
    setCartItems(nextCart);
    return nextCart;
  }, [dishesById]);

  const loadOrder = useCallback(async ({ silent = false }: LoadOrderOptions = {}): Promise<void> => {
    if (savingRef.current) return;

    try {
      const response = await fetch(`/api/order/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Order API ${response.status}`);
      const order = await response.json();
      applyOrder(order);
      setSyncError(null);
    } catch (error: unknown) {
      setSyncError(error instanceof Error ? error.message : '读取订单失败');
      if (!silent) {
        setCartItems(readLocalCart(dishesById));
      }
    } finally {
      setCartLoaded(true);
    }
  }, [applyOrder, dishesById, sessionId]);

  const saveOrder = useCallback(async (nextItems: CartItem[]): Promise<void> => {
    const payload = { items: orderItemsFromCart(nextItems) };

    try {
      savingRef.current = true;
      const response = await fetch(`/api/order/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Order API ${response.status}`);
      const savedOrder = await response.json();
      applyOrder(savedOrder);
      setSyncError(null);
    } catch (error: unknown) {
      setSyncError(error instanceof Error ? error.message : '保存订单失败');
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(payload.items));
    } finally {
      savingRef.current = false;
      setCartLoaded(true);
    }
  }, [applyOrder, sessionId]);

  useEffect(() => {
    loadOrder();
    const timer = window.setInterval(() => loadOrder({ silent: true }), 1_000);
    return () => window.clearInterval(timer);
  }, [loadOrder]);

  useEffect(() => {
    setCartItems((prevItems) => hydrateCart(orderItemsFromCart(prevItems), dishesById));
  }, [dishesById]);

  const addToCart = useCallback((dish: Dish): void => {
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === dish.id);
      const nextItems = existingItem ? prevItems : [...prevItems, { ...dish, quantity: 1 }];
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const removeFromCart = useCallback((dishId: number): void => {
    setCartItems((prevItems) => {
      const nextItems = prevItems.filter((item) => item.id !== dishId);
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const updateQuantity = useCallback((dishId: number, quantity: number): void => {
    setCartItems((prevItems) => {
      const nextItems = quantity <= 0
        ? prevItems.filter((item) => item.id !== dishId)
        : prevItems.map((item) => item.id === dishId ? { ...item, quantity } : item);
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const getTotalItems = useCallback((): number => {
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  }, [cartItems]);

  const clearCart = useCallback((): void => {
    setCartItems([]);
    saveOrder([]);
  }, [saveOrder]);

  const isInCart = useCallback((dishId: number): boolean => {
    return cartItems.some((item) => item.id === dishId);
  }, [cartItems]);

  const hrefWithSession = useCallback((href: string): string => {
    if (sessionId === 'today') return href;
    const separator = href.includes('?') ? '&' : '?';
    return `${href}${separator}session=${encodeURIComponent(sessionId)}`;
  }, [sessionId]);

  const value = useMemo(() => ({
    cartItems,
    cartLoaded,
    syncError,
    sessionId,
    addToCart,
    removeFromCart,
    updateQuantity,
    getTotalItems,
    clearCart,
    isInCart,
    hrefWithSession,
  }), [
    cartItems,
    cartLoaded,
    syncError,
    sessionId,
    addToCart,
    removeFromCart,
    updateQuantity,
    getTotalItems,
    clearCart,
    isInCart,
    hrefWithSession,
  ]);

  return (
    <CartContext.Provider value={value}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
