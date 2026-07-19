'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useMenu } from './MenuContext';

const CartContext = createContext();
const CART_STORAGE_KEY = 'menu.selectedDishes.v1';

function getBrowserSessionId() {
  if (typeof window === 'undefined') return 'today';
  const params = new URLSearchParams(window.location.search);
  const rawSession = params.get('session') || 'today';
  return /^[a-zA-Z0-9_-]{1,64}$/.test(rawSession) ? rawSession : 'today';
}

function orderItemsFromCart(items) {
  return items.map((item) => ({
    id: item.id,
    quantity: Math.max(1, Number(item.quantity) || 1),
  }));
}

function hydrateCart(orderItems, dishesById) {
  return orderItems
    .filter((item) => item && Number.isFinite(Number(item.id)))
    .map((item) => {
      const currentDish = dishesById.get(Number(item.id));
      if (!currentDish) return null;
      return {
        ...currentDish,
        quantity: Math.max(1, Number(item.quantity) || 1),
      };
    })
    .filter(Boolean);
}

function readLocalCart(dishesById) {
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

export function CartProvider({ children }) {
  const { dishes } = useMenu();
  const dishesById = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);
  const [sessionId, setSessionId] = useState('today');
  const [cartItems, setCartItems] = useState([]);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const savingRef = useRef(false);

  useEffect(() => {
    setSessionId(getBrowserSessionId());
  }, []);

  const applyOrder = useCallback((order) => {
    const nextCart = hydrateCart(Array.isArray(order?.items) ? order.items : [], dishesById);
    setCartItems(nextCart);
    return nextCart;
  }, [dishesById]);

  const loadOrder = useCallback(async ({ silent = false } = {}) => {
    if (savingRef.current) return;

    try {
      const response = await fetch(`/api/order/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Order API ${response.status}`);
      const order = await response.json();
      applyOrder(order);
      setSyncError(null);
    } catch (error) {
      setSyncError(error.message);
      if (!silent) {
        setCartItems(readLocalCart(dishesById));
      }
    } finally {
      setCartLoaded(true);
    }
  }, [applyOrder, dishesById, sessionId]);

  const saveOrder = useCallback(async (nextItems) => {
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
    } catch (error) {
      setSyncError(error.message);
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

  const addToCart = useCallback((dish) => {
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === dish.id);
      const nextItems = existingItem ? prevItems : [...prevItems, { ...dish, quantity: 1 }];
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const removeFromCart = useCallback((dishId) => {
    setCartItems((prevItems) => {
      const nextItems = prevItems.filter((item) => item.id !== dishId);
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const updateQuantity = useCallback((dishId, quantity) => {
    setCartItems((prevItems) => {
      const nextItems = quantity <= 0
        ? prevItems.filter((item) => item.id !== dishId)
        : prevItems.map((item) => item.id === dishId ? { ...item, quantity } : item);
      saveOrder(nextItems);
      return nextItems;
    });
  }, [saveOrder]);

  const getTotalItems = useCallback(() => {
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  }, [cartItems]);

  const clearCart = useCallback(() => {
    setCartItems([]);
    saveOrder([]);
  }, [saveOrder]);

  const isInCart = useCallback((dishId) => {
    return cartItems.some((item) => item.id === dishId);
  }, [cartItems]);

  const hrefWithSession = useCallback((href) => {
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
