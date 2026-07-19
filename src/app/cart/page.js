'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '../context/CartContext';
import { fallbackDishImage } from '../data/dishes';

function ArrowLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.4 5.2A1.5 1.5 0 007 20h10a1.5 1.5 0 001.4-1.8L17 13M9 17h.01M15 17h.01" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.9 12.1A2 2 0 0116.1 21H7.9a2 2 0 01-2-1.9L5 7m5 4v6m4-6v6M4 7h16m-5 0V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3" />
    </svg>
  );
}

function CartImage({ item }) {
  const [src, setSrc] = useState(item.image || fallbackDishImage);

  return (
    <Image
      src={src}
      alt={item.name}
      fill
      sizes="96px"
      className="object-cover"
      onError={() => setSrc(fallbackDishImage)}
    />
  );
}

const categoryOrder = ['凉菜', '海鲜', '肉菜', '素菜', '主食', '汤甜'];

export default function CartPage() {
  const { cartItems, removeFromCart, clearCart, hrefWithSession } = useCart();
  const count = cartItems.length;

  const categorySummary = useMemo(() => {
    const counts = new Map();
    cartItems.forEach((item) => {
      counts.set(item.category, (counts.get(item.category) || 0) + 1);
    });
    return [...counts.entries()].sort(
      (a, b) => categoryOrder.indexOf(a[0]) - categoryOrder.indexOf(b[0])
    );
  }, [cartItems]);

  const missingHint = useMemo(() => {
    if (!cartItems.length) return null;
    const picked = new Set(cartItems.map((item) => item.category));
    if (!picked.has('素菜') && !picked.has('凉菜')) return '这一桌偏荤，配一两道素菜时蔬会更解腻。';
    if (!picked.has('肉菜') && !picked.has('海鲜')) return '还差道硬菜撑场面，看看肉菜或海鲜？';
    if (!picked.has('汤甜')) return '可以再加一道汤羹甜品收尾。';
    return null;
  }, [cartItems]);

  if (count === 0) {
    return (
      <main className="menu-page">
        <div className="cart-shell">
          <nav className="cart-topbar">
            <Link href={hrefWithSession('/')} className="detail-back">
              <ArrowLeftIcon />
              返回菜单
            </Link>
          </nav>

          <section className="paper-panel cart-empty">
            <div className="cart-empty-icon">
              <CartIcon />
            </div>
            <h1 className="display-type">还没点菜</h1>
            <p>这桌现在还是空的，回菜单挑几道今晚想吃的。</p>
            <Link href={hrefWithSession('/')} className="cart-empty-action">
              看菜单
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="menu-page">
      <div className="cart-shell">
        <nav className="cart-topbar">
          <Link href={hrefWithSession('/')} className="detail-back">
            <ArrowLeftIcon />
            返回菜单
          </Link>

          <button type="button" onClick={clearCart} className="cart-clear">
            <TrashIcon />
            清空
          </button>
        </nav>

        <header className="ink-panel cart-header">
          <div className="cart-header-copy">
            <p className="detail-accent">今晚家宴</p>
            <h1 className="display-type cart-title">已选菜单</h1>
            <p className="cart-subtitle">确认一下今晚要做的菜，缺哪类再回去补。</p>
          </div>
          <div className="cart-header-stat">
            <span className="cart-stat-num">{count}</span>
            <span className="cart-stat-label">道菜</span>
          </div>
        </header>

        <section className="cart-layout">
          <div className="cart-list">
            {cartItems.map((item) => (
              <article key={item.id} className="paper-panel cart-item">
                <Link href={hrefWithSession(`/dish-detail/?id=${item.id}`)} className="cart-item-media" aria-label={`查看${item.name}详情`}>
                  <CartImage item={item} />
                  {item.recommended ? <span className="cart-item-mark">推荐</span> : null}
                </Link>

                <div className="cart-item-copy">
                  <div className="cart-item-titleline">
                    <Link href={hrefWithSession(`/dish-detail/?id=${item.id}`)} className="cart-item-title">
                      {item.name}
                    </Link>
                    <span className="cart-item-cat">{item.category}</span>
                  </div>
                  <p className="cart-item-desc">{item.description}</p>
                  <p className="cart-item-meta">
                    {item.prepTime} · {item.difficulty} · {item.servings}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => removeFromCart(item.id)}
                  className="cart-item-remove"
                  aria-label={`移除${item.name}`}
                  title="移除"
                >
                  <TrashIcon />
                </button>
              </article>
            ))}
          </div>

          <aside className="paper-panel cart-summary">
            <h2 className="display-type">本单合计</h2>

            <div className="cart-summary-rows">
              {categorySummary.map(([category, c]) => (
                <div key={category} className="cart-summary-row">
                  <span>{category}</span>
                  <span>{c} 道</span>
                </div>
              ))}
            </div>

            <div className="cart-summary-total">
              <span>合计</span>
              <span>{count} 道菜</span>
            </div>

            {missingHint ? <p className="cart-hint">{missingHint}</p> : null}

            <Link href={hrefWithSession('/')} className="cart-continue">
              继续加菜
            </Link>
          </aside>
        </section>
      </div>
    </main>
  );
}
