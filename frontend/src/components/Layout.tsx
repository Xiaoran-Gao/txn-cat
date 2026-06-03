import { NavLink } from "react-router-dom";
import type { ReactNode } from "react";

const navItems = [
  { to: "/transactions", label: "交易记录", icon: "📋" },
  { to: "/query", label: "智能问答", icon: "💬" },
  { to: "/categories", label: "分类管理", icon: "📂" },
  { to: "/settings", label: "设置", icon: "⚙️" },
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">TxnCatAI</div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? "active" : ""}
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-content">{children}</main>
    </div>
  );
}
