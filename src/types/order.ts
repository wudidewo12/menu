import type { Dish } from './dish';

export interface OrderItem {
  id: number;
  quantity: number;
}

export interface Order {
  sessionId: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface CartItem extends Dish {
  quantity: number;
}
