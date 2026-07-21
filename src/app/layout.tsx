import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MenuProvider } from "./context/MenuContext";
import { CartProvider } from "./context/CartContext";

export const metadata: Metadata = {
  title: "灶台菜单 · 家宴点菜",
  description: "今晚的家宴菜单，凉菜热菜汤甜主食都在这，自己点。",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="zh-CN">
      <body>
        <MenuProvider>
          <CartProvider>
            {children}
          </CartProvider>
        </MenuProvider>
      </body>
    </html>
  );
}
