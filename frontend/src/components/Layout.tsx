import { NavLink } from "react-router-dom";
import { useState, type ReactNode } from "react";
import {
  ChevronsLeft,
  CreditCard,
  FolderTree,
  LayoutDashboard,
  MessageSquareText,
  ReceiptText,
  Settings,
  UploadCloud,
} from "lucide-react";

const navItems = [
  {
    title: "Home",
    className: "home-group",
    items: [
      { to: "/", label: "首页", icon: UploadCloud },
    ],
  },
  {
    title: "Workspace",
    items: [
      { to: "/dashboard", label: "消费看板", icon: LayoutDashboard },
      { to: "/credit-cards", label: "信用卡管理", icon: CreditCard },
      { to: "/query", label: "智能问答", icon: MessageSquareText },
    ],
  },
  {
    title: "Data",
    items: [
      { to: "/transactions", label: "交易记录", icon: ReceiptText },
      { to: "/categories", label: "分类管理", icon: FolderTree },
      { to: "/settings", label: "设置", icon: Settings },
    ],
  },
];

export default function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`app-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="brand-mark" src="/favicon.svg" alt="TxnCatAI" />
          <div className="brand-copy">
            <strong>TxnCat<span>AI</span></strong>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((group) => (
            <div className={`sidebar-nav-group ${group.className || ""}`} key={group.title}>
              <span className="nav-group-label">{group.title}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => isActive ? "active" : ""}
                  title={item.label}
                >
                  <item.icon size={18} strokeWidth={1.9} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-bottom">
            <button className="sidebar-collapse" onClick={() => setCollapsed((v) => !v)} title="折叠侧栏">
              <ChevronsLeft size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-frame">
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
