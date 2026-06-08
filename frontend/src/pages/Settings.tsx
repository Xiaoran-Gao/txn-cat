import { useState, useEffect, type ReactNode } from "react";
import { api } from "../api/client";
import { Database, RadioTower, ServerCog } from "lucide-react";

type HealthStatus = Awaited<ReturnType<typeof api.health>>;

export default function Settings() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  return (
    <div className="surface">
      <div className="page-header app-hero">
        <div>
          <h1>设置</h1>
          <p>检查本地运行状态和模型环境。</p>
        </div>
      </div>

      <div className="settings-grid">
      <div className="settings-panel">
        <div className="panel-heading"><ServerCog size={18} /><strong>系统状态</strong></div>
        {health ? (
          <div className="status-grid">
            <StatusBadge icon={<Database size={16} />} label="数据库" ok={health.database} />
            <StatusBadge icon={<RadioTower size={16} />} label="Ollama" ok={health.ollama} />
            <div className="status-card">
              <span>模型</span>
              <strong>{health.ollama_model_active || health.ollama_model}</strong>
              {health.ollama_model_active && health.ollama_model_active !== health.ollama_model && (
                <small>配置 {health.ollama_model}</small>
              )}
            </div>
          </div>
        ) : (
          <span style={{ color: "#999" }}>加载中...</span>
        )}
      </div>

      </div>
    </div>
  );
}

function StatusBadge({ icon, label, ok }: { icon: ReactNode; label: string; ok: boolean }) {
  return (
    <div className="status-card">
      <div>{icon}<span>{label}</span></div>
      <strong className={ok ? "ok-text" : "danger-text"}>{ok ? "正常" : "异常"}</strong>
    </div>
  );
}
