import { dishes, dishesById } from '../../data/dishes';
import DishDetailClient from './DishDetailClient';

export async function generateStaticParams() {
  return dishes.map((dish) => ({
    id: String(dish.id),
  }));
}

export default async function DishDetail({ params }) {
  const { id } = await params;
  const dish = dishesById[id];

  if (!dish) {
    return (
      <main className="menu-page">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="paper-panel rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-[var(--lacquer)]">404</p>
            <h1 className="display-type mt-2 text-4xl font-semibold">菜品未找到</h1>
            <p className="mt-3 text-sm text-[#6b5846]">这道菜不在今晚菜单里。</p>
          </div>
        </div>
      </main>
    );
  }

  return <DishDetailClient dish={dish} />;
}
