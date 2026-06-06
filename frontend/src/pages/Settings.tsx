import { useState, useEffect, type ReactNode } from "react";
import { api } from "../api/client";
import type { MerchantMapping } from "../types";
import { Database, Plus, RadioTower, ServerCog, Trash2 } from "lucide-react";

type HealthStatus = Awaited<ReturnType<typeof api.health>>;

export default function Settings() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [merchants, setMerchants] = useState<MerchantMapping[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const showT = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.merchants().then(setMerchants).catch(() => {});
  }, []);

  const handleAddMerchant = async (pattern: string, display: string) => {
    await api.createMerchant({ pattern, display_name: display, is_regex: false });
    showT("已添加");
    setShowAdd(false);
    api.merchants().then(setMerchants);
  };

  const handleDeleteMerchant = async (id: number) => {
    await api.deleteMerchant(id);
    showT("已删除");
    api.merchants().then(setMerchants);
  };

  return (
    <div className="surface">
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="page-header app-hero">
        <div>
          <h1>设置</h1>
          <p>检查本地运行状态，维护商户映射和模型环境。</p>
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
              <strong>{health.ollama_model}</strong>
            </div>
          </div>
        ) : (
          <span style={{ color: "#999" }}>加载中...</span>
        )}
      </div>

      <div className="settings-panel mappings-panel">
        <div className="table-toolbar">
          <div>
            <strong>商户名称映射</strong>
            <span>{merchants.length} 条规则</span>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}><Plus size={14} />添加映射</button>
        </div>
        <p className="muted-copy">
          将交易描述中的关键词映射为标准化商户名，用于数据清洗。
        </p>
        <table>
          <thead><tr><th>匹配模式</th><th>显示名称</th><th>操作</th></tr></thead>
          <tbody>
            {merchants.length === 0 ? (
              <tr><td colSpan={3} style={{ textAlign: "center", color: "#999" }}>暂无映射</td></tr>
            ) : (
              merchants.map((m) => (
                <tr key={m.id}>
                  <td><code>{m.pattern}</code></td>
                  <td>{m.display_name}</td>
                  <td><button className="icon-btn danger" onClick={() => handleDeleteMerchant(m.id)} title="删除"><Trash2 size={14} /></button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      {showAdd && <MerchantForm onSave={handleAddMerchant} onClose={() => setShowAdd(false)} />}
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

function MerchantForm({ onSave, onClose }: { onSave: (pattern: string, display: string) => void; onClose: () => void }) {
  const [pattern, setPattern] = useState("");
  const [display, setDisplay] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>添加商户映射</h2>
        <div className="form-group"><label>匹配关键词</label><input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="例如：美团" /></div>
        <div className="form-group"><label>显示名称</label><input value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="例如：美团" /></div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => pattern.trim() && display.trim() && onSave(pattern.trim(), display.trim())}>保存</button>
        </div>
      </div>
    </div>
  );
}
