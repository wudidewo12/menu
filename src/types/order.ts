import type { MenuDish } from './dish';

export interface OrderItem {
  id: number;
  quantity: number;
}

export interface Order {
  sessionId: string;
  updatedAt: string;
  items: OrderItem[];
}

export interface CartItem extends MenuDish {
  quantity: number;
}
