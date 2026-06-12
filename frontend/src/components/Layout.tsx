import { NavLink } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import {
  Cat,
  ChevronsLeft,
  FolderTree,
  LayoutDashboard,
  MessageSquareText,
  ReceiptText,
  Search,
  Settings,
  UploadCloud,
} from "lucide-react";
import { api } from "../api/client";

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
  const [systemInfo, setSystemInfo] = useState({
    statusText: "检测中",
    statusOk: false,
    databaseOk: false,
    storageText: "读取中",
    versionText: "版本读取中",
  });

  useEffect(() => {
    let cancelled = false;
    api.health()
      .then((health) => {
        if (cancelled) return;
        const statusText = health.database && health.ollama
          ? "AI 待命中"
          : health.database
            ? "本地运行中"
            : "数据库异常";
        setSystemInfo({
          statusText,
          statusOk: health.database && health.ollama,
          databaseOk: health.database,
          storageText: `数据库 ${formatBytes(health.storage.bytes)}`,
          versionText: `v${health.version}`,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSystemInfo({
          statusText: "后端不可用",
          statusOk: false,
          databaseOk: false,
          storageText: "存储不可用",
          versionText: "版本未知",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={`app-layout ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand-mark"><Cat size={21} /></div>
          <div className="brand-copy">
            <strong>TxnCat<span>AI</span></strong>
            <small>私人账本系统</small>
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
              <span className={`live-dot ${systemInfo.databaseOk ? "" : "danger"}`} />
            </div>
            <p>{systemInfo.storageText}</p>
          </div>
          <div className="sidebar-bottom">
            <span>{systemInfo.versionText}</span>
            <button className="sidebar-collapse" onClick={() => setCollapsed((v) => !v)} title="折叠侧栏">
              <ChevronsLeft size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <div className="global-search">
            <Search size={18} />
            <input placeholder="搜索描述" />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-actions">
            <div className="system-pill">
              <span className={`live-dot ${systemInfo.statusOk ? "" : "danger"}`} />
              <span>系统状态</span>
              <strong className={systemInfo.statusOk ? "" : "danger"}>{systemInfo.statusText}</strong>
            </div>
          </div>
        </header>
        <div className="main-content">{children}</div>
      </main>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "不可用";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
