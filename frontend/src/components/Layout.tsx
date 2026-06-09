import { NavLink } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  Cat,
  ChevronDown,
  ChevronsLeft,
  CircleDollarSign,
  FolderTree,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  Monitor,
  ReceiptText,
  Search,
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
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
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
  const [statusText, setStatusText] = useState("本地运行中");

  useEffect(() => {
    const labels = ["本地运行中", "隐私模式", "AI 待命中"];
    let index = 0;
    const timer = window.setInterval(() => {
      index = (index + 1) % labels.length;
      setStatusText(labels[index]);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`app-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand-mark"><Cat size={21} /></div>
          <div className="brand-copy">
            <strong>TxnCat<span>AI</span></strong>
            <small>Private ledger OS</small>
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
          <div className="storage-card">
            <div>
              <ReceiptText size={17} />
              <strong>本地存储</strong>
              <span className="live-dot" />
            </div>
            <p>已用 284.3 MB / 2 GB</p>
            <div className="storage-track"><span /></div>
          </div>
          <div className="sidebar-bottom">
            <span>v1.3.2</span>
            <button className="sidebar-collapse" onClick={() => setCollapsed((v) => !v)} title="折叠侧栏">
              <ChevronsLeft size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <button className="topbar-menu" onClick={() => setCollapsed((v) => !v)} title="切换侧栏">
            <Menu size={20} />
          </button>
          <div className="topbar-orbit" aria-hidden="true">
            <CircleDollarSign size={17} />
          </div>
          <div className="global-search">
            <Search size={18} />
            <input placeholder="搜索描述" />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <div className="system-pill">
              <span className="live-dot" />
              <span>系统状态</span>
              <strong>{statusText}</strong>
            </div>
            <button className="device-btn" title="显示模式">
              <Monitor size={18} />
              <ChevronDown size={15} />
            </button>
          </div>
        </header>
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}
