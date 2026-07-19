'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useCart } from '../context/CartContext';
import { useMenu } from '../context/MenuContext';
import DishDetailClient from '../dish/[id]/DishDetailClient';

function currentDishId() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id'));
  return Number.isFinite(id) ? id : null;
}

export default function DishDetailRuntimePage() {
  const { dishes, loading } = useMenu();
  const { hrefWithSession } = useCart();
  const [dishId, setDishId] = useState(null);

  useEffect(() => {
    setDishId(currentDishId());
  }, []);

  const dish = useMemo(() => dishes.find((item) => item.id === dishId), [dishId, dishes]);

  if (loading && !dish) {
    return (
      <main className="menu-page">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="paper-panel rounded-lg p-8 text-center">
            <h1 className="display-type text-4xl font-semibold">正在读菜单</h1>
          </div>
        </div>
      </main>
    );
  }

  if (!dish) {
    return (
      <main className="menu-page">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="paper-panel rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-[var(--lacquer)]">404</p>
            <h1 className="display-type mt-2 text-4xl font-semibold">菜品未找到</h1>
            <p className="mt-3 text-sm text-[#6b5846]">这道菜不在当前菜单里。</p>
            <Link href={hrefWithSession('/')} className="cart-empty-action mt-6">
              返回菜单
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <DishDetailClient dish={dish} />;
}
