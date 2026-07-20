'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCart } from '../../context/CartContext';
import { useMenu } from '../../context/MenuContext';
import { fallbackDishImage } from '../../data/dishes.mjs';

function ArrowLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function CartIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.4 5.2A1.5 1.5 0 007 20h10a1.5 1.5 0 001.4-1.8L17 13M9 17h.01M15 17h.01" />
    </svg>
  );
}

function CheckIcon({ className = 'h-5 w-5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[15px] w-[15px]">
      <path
        d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function minutesOf(dish) {
  return Number.parseInt(dish.prepTime, 10) || 30;
}

function DishImage({ src, alt, priority = false, className = 'object-cover', sizes }) {
  const [imageSrc, setImageSrc] = useState(src || fallbackDishImage);

  return (
    <Image
      src={imageSrc}
      alt={alt}
      fill
      priority={priority}
      sizes={sizes}
      className={className}
      onError={() => setImageSrc(fallbackDishImage)}
    />
  );
}

export default function DishDetailClient({ dish }) {
  const { dishes } = useMenu();
  const { addToCart, removeFromCart, isInCart, getTotalItems, hrefWithSession } = useCart();
  const router = useRouter();

  const selected = isInCart(dish.id);
  const totalItems = getTotalItems();
  const heroImage = dish.image || fallbackDishImage;
  const quick = minutesOf(dish) <= 20;

  const difficultyTone = {
    简单: 'detail-stat-jade',
    中等: 'detail-stat-brass',
    困难: 'detail-stat-lacquer',
  }[dish.difficulty] || '';

  const related = dishes
    .filter((item) => item.category === dish.category && item.id !== dish.id)
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    })
    .slice(0, 6);

  return (
    <main className="menu-page">
      <div className="detail-shell">
        <nav className="detail-topbar">
          <button type="button" onClick={() => router.back()} className="detail-back">
            <ArrowLeftIcon />
            返回菜单
          </button>

          <Link href={hrefWithSession('/cart/')} className="detail-cart" aria-label="查看已选菜品" title="查看已选菜品">
            <CartIcon />
            {totalItems > 0 ? <span className="detail-cart-badge">{totalItems}</span> : null}
          </Link>
        </nav>

        <section className="detail-hero">
          <div className="detail-media">
            <DishImage
              src={heroImage}
              alt={dish.name}
              priority
              sizes="(min-width: 920px) 52vw, 100vw"
            />
            <div className="detail-media-badges">
              {dish.recommended ? <span className="detail-badge detail-badge-rec">推荐</span> : null}
              {quick ? <span className="detail-badge detail-badge-quick">快手</span> : null}
            </div>
            <span className="detail-media-cat">{dish.category}</span>
          </div>

          <div className="ink-panel detail-panel">
            <p className="detail-accent">{dish.accent}</p>
            <h1 className="display-type detail-title">{dish.name}</h1>
            <p className="detail-desc">{dish.description}</p>

            <div className="detail-stats">
              <div className="detail-stat">
                <span className="detail-stat-num">{dish.prepTime}</span>
                <span className="detail-stat-label">出锅时长</span>
              </div>
              <div className="detail-stat">
                <span className="detail-stat-num">{dish.servings}</span>
                <span className="detail-stat-label">建议份量</span>
              </div>
              <div className="detail-stat">
                <span className={`detail-stat-num ${difficultyTone}`}>{dish.difficulty}</span>
                <span className="detail-stat-label">下厨难度</span>
              </div>
            </div>

            <div className="detail-actions">
              {selected ? (
                <>
                  <button
                    type="button"
                    onClick={() => removeFromCart(dish.id)}
                    className="detail-toggle"
                  >
                    <CheckIcon className="h-5 w-5" />
                    已加入 · 点此取消
                  </button>
                  <Link href={hrefWithSession('/cart/')} className="detail-go-cart">
                    去看已选菜单 →
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => addToCart(dish)}
                  className="detail-add lacquer-button"
                >
                  <CartIcon />
                  加入今晚菜单
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="paper-panel detail-card">
          <header className="detail-card-head">
            <h2 className="display-type">备料清单</h2>
            <span>共 {dish.ingredients.length} 样</span>
          </header>
          <div className="detail-ingredients">
            {dish.ingredients.map((ingredient) => (
              <span key={ingredient} className="detail-ingredient">
                {ingredient}
              </span>
            ))}
          </div>
        </section>

        {related.length ? (
          <section className="detail-related">
            <header className="detail-card-head detail-related-head">
              <h2 className="display-type">换着点</h2>
              <span>同是{dish.category} · {related.length} 道</span>
            </header>
            <div className="detail-related-grid">
              {related.map((item) => (
                <Link key={item.id} href={hrefWithSession(`/dish-detail/?id=${item.id}`)} className="detail-related-card">
                  <span className="detail-related-media">
                    <DishImage
                      src={item.image}
                      alt={item.name}
                      sizes="(max-width: 760px) 45vw, 200px"
                    />
                    {item.recommended ? <span className="detail-related-mark">推荐</span> : null}
                  </span>
                  <span className="detail-related-copy">
                    <strong>{item.name}</strong>
                    <em>
                      <ClockIcon />
                      {item.prepTime}
                    </em>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
