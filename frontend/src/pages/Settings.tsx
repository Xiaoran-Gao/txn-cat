import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  FileStack,
  HardDrive,
  RefreshCw,
  RadioTower,
  ServerCog,
  Sparkles,
} from "lucide-react";
import { api } from "../api/client";

type HealthStatus = Awaited<ReturnType<typeof api.health>>;

export default function Settings() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadHealth();
  }, []);

  async function loadHealth() {
    setLoading(true);
    setError(null);
    try {
      setHealth(await api.health());
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法读取本地状态。");
    } finally {
      setLoading(false);
    }
  }

  const storageFiles = health?.storage.files ?? [];

  return (
    <div className="surface settings-surface">
      <div className="page-header app-hero settings-hero">
        <div>
          <h1>设置</h1>
          <p>查看本地运行状态。</p>
        </div>
        <button className="btn btn-secondary" onClick={loadHealth} disabled={loading}>
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          刷新
        </button>
      </div>

      {error && <div className="settings-alert">{error}</div>}

      <section className="settings-panel settings-simple-panel">
        <div className="settings-section">
          <PanelHeading icon={<ServerCog size={18} />} title="系统状态" />
          {health ? (
            <div className="settings-row-grid">
              <StatusBadge icon={<Database size={16} />} label="数据库" ok={health.database} />
              <StatusBadge icon={<RadioTower size={16} />} label="Ollama" ok={health.ollama} />
              <StatusBadge icon={<Activity size={16} />} label="本地 API" ok={health.database} />
            </div>
          ) : (
            <LoadingState />
          )}
        </div>

        <div className="settings-section">
          <PanelHeading icon={<HardDrive size={18} />} title="本地存储" />
          {health ? (
            <div className="settings-detail-row">
              <div className="settings-detail-main">
                <span>SQLite 文件占用</span>
                <strong>{formatBytes(health.storage.bytes)}</strong>
                <p>清除交易后，SQLite 仍会保留数据库结构、索引和空闲页供下次写入复用。</p>
              </div>
              <div className="storage-file-list">
                <small>{storageFiles.length} 个文件</small>
                {storageFiles.length > 0 ? storageFiles.map((file) => (
                  <div className="storage-file-row" key={file.path}>
                    <FileStack size={15} />
                    <span>{fileName(file.path)}</span>
                    <strong>{formatBytes(file.bytes)}</strong>
                  </div>
                )) : (
                  <span className="muted-copy">没有检测到数据库文件。</span>
                )}
              </div>
            </div>
          ) : (
            <LoadingState />
          )}
        </div>

        <div className="settings-section">
          <PanelHeading icon={<Sparkles size={18} />} title="模型环境" />
          {health ? (
            <div className="settings-row-grid two">
              <div className="settings-kv">
                <div>
                  <span>当前使用</span>
                  <strong>{health.ollama_model_active || "未检测到可用模型"}</strong>
                </div>
              </div>
              <div className="settings-kv">
                <div>
                  <span>配置模型</span>
                  <strong>{health.ollama_model}</strong>
                </div>
              </div>
              <div className="settings-kv">
                <div>
                  <span>连接状态</span>
                  <strong className={health.ollama ? "ok-text" : "danger-text"}>{health.ollama ? "已连接" : "未连接"}</strong>
                </div>
              </div>
              {health.ollama_error && <p className="settings-note danger-text">{health.ollama_error}</p>}
            </div>
          ) : (
            <LoadingState />
          )}
        </div>
      </section>
    </div>
  );
}

function PanelHeading({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-heading">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function LoadingState() {
  return <span className="muted-copy">加载中...</span>;
}

function StatusBadge({ icon, label, ok }: { icon: ReactNode; label: string; ok: boolean }) {
  return (
    <div className="status-card">
      <div>{icon}<span>{label}</span></div>
      <div className="status-card-value">
        <CheckCircle2 size={15} />
        <strong className={ok ? "ok-text" : "danger-text"}>{ok ? "正常" : "异常"}</strong>
      </div>
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

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
