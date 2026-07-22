'use client';

import Image from 'next/image';
import Link from 'next/link';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '../context/CartContext';
import { useMenu } from '../context/MenuContext';
import type { MenuDish } from '../../types/dish';
import type { MenuSection } from '../../types/menu';
import type { CartItem } from '../../types/order';

type AddDish = (dish: MenuDish) => void;
type RemoveDish = (dishId: number) => void;
type HrefWithSession = (href: string) => string;

interface MenuSectionWithDishes extends MenuSection {
  dishes: MenuDish[];
}

interface CartIconProps {
  className?: string;
}

interface ToggleButtonProps {
  dish: MenuDish;
  selected: boolean;
  onAdd: AddDish;
  onRemove: RemoveDish;
  size?: string;
}

interface DishRowProps {
  dish: MenuDish;
  selected: boolean;
  priority: boolean;
  onAdd: AddDish;
  onRemove: RemoveDish;
  hrefWithSession: HrefWithSession;
}

interface OrderRailProps {
  cartItems: CartItem[];
  totalItems: number;
  onRemove: RemoveDish;
  hrefWithSession: HrefWithSession;
}

function minutesOf(dish: MenuDish): number {
  return Number.parseInt(dish.prepTime, 10) || 30;
}

function isQuick(dish: MenuDish): boolean {
  return minutesOf(dish) <= 20;
}

function dishText(dish: MenuDish): string {
  return [
    dish.name,
    dish.slug,
    dish.category,
    dish.accent,
    dish.description,
    ...(dish.ingredients || []),
  ]
    .join(' ')
    .toLowerCase();
}

function compareDishes(a: MenuDish, b: MenuDish): number {
  if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
  if (Number(a.sortOrder) !== Number(b.sortOrder)) return Number(a.sortOrder) - Number(b.sortOrder);
  if (minutesOf(a) !== minutesOf(b)) return minutesOf(b) - minutesOf(a);
  return a.name.localeCompare(b.name, 'zh-Hans-CN');
}

function buildSectionedDishes(
  sections: MenuSection[],
  dishes: MenuDish[]
): MenuSectionWithDishes[] {
  const dishesById = new Map(dishes.map((dish) => [dish.id, dish]));

  return sections.map((section) => {
    if (Array.isArray(section.dishIds)) {
      return {
        ...section,
        dishes: section.dishIds
          .map((dishId) => dishesById.get(Number(dishId)))
          .filter((dish): dish is MenuDish => dish !== undefined),
      };
    }

    return {
      ...section,
      dishes: dishes
        .filter((dish) => {
          if (section.recommendedOnly) return dish.recommended;
          if (section.category) return dish.category === section.category;
          return true;
        })
        .sort(compareDishes),
    };
  });
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
      <path
        d="m21 21-4.35-4.35m1.35-5.65a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CartIcon({ className = 'h-5 w-5' }: CartIconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path
        d="M6.5 6.5h13l-1.6 7.2H8.2L6.5 3H3m6 15.5h.01M17 18.5h.01"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[14px] w-[14px]">
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

function ToggleButton({ dish, selected, onAdd, onRemove, size = 'md' }: ToggleButtonProps) {
  if (selected) {
    return (
      <button
        type="button"
        onClick={() => onRemove(dish.id)}
        className={`add-button add-button-on add-button-${size}`}
        aria-label={`取消${dish.name}`}
        aria-pressed="true"
      >
        <CheckIcon />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onAdd(dish)}
      className={`add-button add-button-${size}`}
      aria-label={`点一份${dish.name}`}
      aria-pressed="false"
    >
      <PlusIcon />
    </button>
  );
}

function DishRow({ dish, selected, priority, onAdd, onRemove, hrefWithSession }: DishRowProps) {
  return (
    <article className={`dish-row ${selected ? 'dish-row-selected' : ''}`}>
      <Link
        href={hrefWithSession(`/dish-detail/?id=${dish.id}`)}
        className="dish-row-link"
        aria-label={`查看${dish.name}详情`}
      />

      <div className="dish-row-media">
        <Image
          src={dish.image}
          alt={dish.name}
          fill
          className="object-cover"
          sizes="(max-width: 760px) 124px, 148px"
          priority={priority}
        />
        {dish.recommended ? <span className="dish-row-mark">推荐</span> : null}
      </div>

      <div className="dish-row-copy">
        <div className="dish-row-titleline">
          <span className="dish-row-title">{dish.name}</span>
          <span className="dish-row-accent">{dish.accent}</span>
          {isQuick(dish) ? <span className="dish-row-quick">快手</span> : null}
        </div>
        <p className="dish-row-desc">{dish.description}</p>
        <div className="dish-row-meta">
          <span className="dish-row-time">
            <ClockIcon />
            {dish.prepTime}
          </span>
          <span>{dish.difficulty}</span>
          <span>{dish.servings}</span>
        </div>
      </div>

      <div className="dish-row-action">
        <ToggleButton
          dish={dish}
          selected={selected}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </div>
    </article>
  );
}

const MemoDishRow = memo(DishRow);

function OrderRail({ cartItems, totalItems, onRemove, hrefWithSession }: OrderRailProps) {
  return (
    <aside className="order-rail">
      <header className="rail-head">
        <h2>已选菜单</h2>
        <span className="rail-badge">{totalItems} 道</span>
      </header>

      <div className="rail-list">
        {cartItems.length ? (
          cartItems.map((item) => (
            <div key={item.id} className="rail-item">
              <div className="rail-item-copy">
                <strong>{item.name}</strong>
                <em>{item.category}</em>
              </div>
              <button
                type="button"
                className="rail-remove"
                onClick={() => onRemove(item.id)}
                aria-label={`移除${item.name}`}
                title="移除"
              >
                <MinusIcon />
              </button>
            </div>
          ))
        ) : (
          <div className="rail-empty">
            <CartIcon className="h-6 w-6" />
            <p>还没点菜，从左边挑几道</p>
          </div>
        )}
      </div>

      {cartItems.length ? (
        <Link href={hrefWithSession('/cart/')} className="rail-action">
          查看已选 · {totalItems} 道
        </Link>
      ) : null}
    </aside>
  );
}

export default function DishList() {
  const { settings, dishes, sections } = useMenu();
  const { addToCart, removeFromCart, cartItems, getTotalItems, hrefWithSession } = useCart();
  const [query, setQuery] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string>('recommend');
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const scrollLockRef = useRef<number>(0);

  const totalItems = getTotalItems();
  const sectionedDishes = useMemo(() => buildSectionedDishes(sections, dishes), [dishes, sections]);

  const selectedIds = useMemo<Set<number>>(
    () => new Set(cartItems.map((item) => item.id)),
    [cartItems]
  );

  const searching = query.trim().length > 0;

  const searchResults = useMemo<MenuDish[]>(() => {
    if (!searching) return [];
    const cleanQuery = query.trim().toLowerCase();
    return dishes.filter((dish) => dishText(dish).includes(cleanQuery)).sort(compareDishes);
  }, [dishes, query, searching]);

  useEffect(() => {
    if (!sectionedDishes.length) return;
    if (!sectionedDishes.some((section) => section.id === activeSection)) {
      setActiveSection(sectionedDishes[0].id);
    }
  }, [activeSection, sectionedDishes]);

  useEffect(() => {
    if (searching) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < scrollLockRef.current) return;

        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length) {
          const sectionId = (visible[0].target as HTMLElement).dataset.section;
          if (sectionId) setActiveSection(sectionId);
        }
      },
      { rootMargin: '-128px 0px -55% 0px' }
    );

    sectionRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [searching, sectionedDishes]);

  const jumpToSection = useCallback((sectionId: string): void => {
    setQuery('');
    setActiveSection(sectionId);
    scrollLockRef.current = Date.now() + 700;

    requestAnimationFrame(() => {
      sectionRefs.current.get(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleAdd = useCallback((dish: MenuDish): void => addToCart(dish), [addToCart]);
  const handleRemove = useCallback((dishId: number): void => removeFromCart(dishId), [removeFromCart]);

  let imageIndex = 0;

  return (
    <div className="menu-shell">
      <header className="site-header">
        <div className="site-header-copy">
          <p className="site-kicker">私房家宴</p>
          <h1 className="display-type">{settings.title}</h1>
          <p className="site-tagline">{settings.subtitle || `今晚想吃什么，自己点 · 共 ${dishes.length} 道家常菜`}</p>
        </div>
        <Link href={hrefWithSession('/cart/')} className="header-cart" aria-label={`查看已选菜单，共 ${totalItems} 道`}>
          <CartIcon className="h-5 w-5" />
          {totalItems > 0 ? <span className="header-cart-badge">{totalItems}</span> : null}
        </Link>
      </header>

      <div className="menu-nav">
        <label className="menu-search">
          <SearchIcon />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜菜名、口味或食材"
            aria-label="搜索菜品或食材"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
              ×
            </button>
          ) : null}
        </label>

        <nav className="nav-chips" aria-label="菜品分类">
          {sectionedDishes.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => jumpToSection(section.id)}
              className={
                !searching && activeSection === section.id ? 'nav-chip nav-chip-on' : 'nav-chip'
              }
              aria-current={!searching && activeSection === section.id ? 'true' : undefined}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="menu-layout">
        <div className="dish-sections">
          {searching ? (
            <section className="dish-section">
              <header className="section-head">
                <h2>搜索结果</h2>
                <span>{searchResults.length ? `${searchResults.length} 道` : ''}</span>
              </header>
              {searchResults.length ? (
                <div className="section-list">
                  {searchResults.map((dish) => (
                    <MemoDishRow
                      key={dish.id}
                      dish={dish}
                      selected={selectedIds.has(dish.id)}
                      priority={false}
                      onAdd={handleAdd}
                      onRemove={handleRemove}
                      hrefWithSession={hrefWithSession}
                    />
                  ))}
                </div>
              ) : (
                <div className="section-empty">
                  没有找到「{query.trim()}」，换个关键词试试
                </div>
              )}
            </section>
          ) : (
            sectionedDishes.map((section) => (
              <section
                key={section.id}
                className="dish-section"
                data-section={section.id}
                ref={(node) => {
                  if (node) sectionRefs.current.set(section.id, node);
                  else sectionRefs.current.delete(section.id);
                }}
              >
                <header className="section-head">
                  <h2>{section.title}</h2>
                  <span>
                    {section.note} · {section.dishes.length} 道
                  </span>
                </header>
                <div className="section-list">
                  {section.dishes.map((dish) => (
                    <MemoDishRow
                      key={`${section.id}-${dish.id}`}
                      dish={dish}
                      selected={selectedIds.has(dish.id)}
                      priority={imageIndex++ < 4}
                      onAdd={handleAdd}
                      onRemove={handleRemove}
                      hrefWithSession={hrefWithSession}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <OrderRail
          cartItems={cartItems}
          totalItems={totalItems}
          onRemove={handleRemove}
          hrefWithSession={hrefWithSession}
        />
      </div>

      <div className="mobile-bar">
        <div className="mobile-bar-info">
          <div className="mobile-bar-cart">
            <CartIcon className="h-5 w-5" />
            {totalItems > 0 ? <span className="mobile-bar-badge">{totalItems}</span> : null}
          </div>
          <span>{totalItems > 0 ? `已选 ${totalItems} 道` : '还没点菜'}</span>
        </div>
        <Link
          href={hrefWithSession('/cart/')}
          className={`mobile-bar-action ${totalItems === 0 ? 'mobile-bar-action-idle' : ''}`}
        >
          查看已选
        </Link>
      </div>
    </div>
  );
}
