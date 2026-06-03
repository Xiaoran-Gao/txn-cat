import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { MerchantMapping } from "../types";

export default function Settings() {
  const [health, setHealth] = useState<any>(null);
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
    <div>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="page-header"><h1>设置</h1></div>

      <div className="card">
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>系统状态</h2>
        {health ? (
          <div style={{ display: "flex", gap: 20, fontSize: 14 }}>
            <StatusBadge label="数据库" ok={health.database} />
            <StatusBadge label="Ollama" ok={health.ollama} />
            <span>模型: {health.ollama_model}</span>
          </div>
        ) : (
          <span style={{ color: "#999" }}>加载中...</span>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>商户名称映射</h2>
          <button className="btn btn-sm btn-primary" onClick={() => setShowAdd(true)}>添加映射</button>
        </div>
        <p style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>
          将交易描述中的关键词映射为标准化商户名，用于数据清洗。例如："美团" → "美团"。
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
                  <td><button className="btn btn-sm btn-danger" onClick={() => handleDeleteMerchant(m.id)}>删除</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showAdd && <MerchantForm onSave={handleAddMerchant} onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function StatusBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ok ? "#22c55e" : "#ef4444", display: "inline-block" }} />
      {label}: {ok ? "正常" : "异常"}
    </span>
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
