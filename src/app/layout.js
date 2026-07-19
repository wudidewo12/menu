import "./globals.css";
import { MenuProvider } from "./context/MenuContext";
import { CartProvider } from "./context/CartContext";

export const metadata = {
  title: "灶台菜单 · 家宴点菜",
  description: "今晚的家宴菜单，凉菜热菜汤甜主食都在这，自己点。",
};

export default function RootLayout({ children }) {
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
