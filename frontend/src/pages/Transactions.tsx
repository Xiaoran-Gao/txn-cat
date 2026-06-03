import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import type { Transaction, Category, ImportResult } from "../types";

export default function Transactions() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const perPage = 50;

  const load = useCallback(() => {
    api.listTransactions({ page, per_page: perPage, search, category_id: catFilter || undefined, sort_by: sortBy, sort_order: sortOrder })
      .then((d: any) => { setTxns(d.items); setTotal(d.total); })
      .catch(() => setToast({ msg: "加载交易记录失败", type: "error" }));
  }, [page, search, catFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importFile(file);
      setImportResult(result);
      showToast(`导入完成：新增 ${result.imported} 条，跳过 ${result.skipped} 条`);
      load();
    } catch {
      showToast("导入失败", "error");
    }
    setImporting(false);
    e.target.value = "";
  };

  const handleCategorize = async () => {
    setCategorizing(true);
    try {
      const result: any = await api.categorizeAll();
      showToast(`分类完成：${result.categorized} 条，失败 ${result.failed} 条`);
      load();
    } catch {
      showToast("分类失败，请检查Ollama是否运行", "error");
    }
    setCategorizing(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除此交易？")) return;
    await api.deleteTransaction(id);
    showToast("已删除");
    load();
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`确定删除选中的 ${selected.size} 条交易？`)) return;
    await api.bulkDelete([...selected]);
    setSelected(new Set());
    showToast("已删除");
    load();
  };

  const handleBulkCategorize = async () => {
    if (selected.size === 0) return;
    setCategorizing(true);
    try {
      await api.bulkUpdate({ ids: [...selected], category_id: null });
      showToast("已标记待重新分类");
      setSelected(new Set());
      load();
    } catch {
      showToast("操作失败", "error");
    }
    setCategorizing(false);
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === txns.length) setSelected(new Set());
    else setSelected(new Set(txns.map((t) => t.id)));
  };

  const reCategorize = async (id: number) => {
    try {
      await api.categorizeOne(id);
      showToast("已重新分类");
      load();
    } catch {
      showToast("分类失败", "error");
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      <div className="page-header">
        <h1>交易记录</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={handleCategorize} disabled={categorizing}>
            {categorizing ? "分类中..." : "AI 分类"}
          </button>
          <label className="btn btn-primary" style={{ cursor: "pointer" }}>
            {importing ? "导入中..." : "导入 Excel/CSV"}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} hidden />
          </label>
          <button className="btn btn-secondary" onClick={() => setShowAdd(true)}>手动添加</button>
        </div>
      </div>

      {importResult && (
        <div className="card" style={{ background: "#f0fdf4", borderColor: "#bbf7d0" }}>
          导入完成：新增 <b>{importResult.imported}</b> 条，跳过重复 <b>{importResult.skipped}</b> 条
          {importResult.errors.length > 0 && <span style={{ color: "red" }}>，{importResult.errors.length} 条错误</span>}
          <button style={{ marginLeft: 12, fontSize: 12 }} onClick={() => setImportResult(null)}>关闭</button>
        </div>
      )}

      <div className="filters">
        <input placeholder="搜索描述..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}>
          <option value="">全部分类</option>
          {categories.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {c.children?.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <select value={`${sortBy}-${sortOrder}`} onChange={(e) => {
          const [s, o] = e.target.value.split("-");
          setSortBy(s);
          setSortOrder(o);
        }}>
          <option value="date-desc">日期 ↓</option>
          <option value="date-asc">日期 ↑</option>
          <option value="amount-desc">金额 ↓</option>
          <option value="amount-asc">金额 ↑</option>
        </select>
        {selected.size > 0 && (
          <>
            <button className="btn btn-sm btn-secondary" onClick={handleBulkCategorize}>批量重新分类</button>
            <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>删除选中 ({selected.size})</button>
          </>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th className="checkbox-col"><input type="checkbox" checked={selected.size === txns.length && txns.length > 0} onChange={toggleAll} /></th>
              <th>日期</th>
              <th>原始描述</th>
              <th>清洗后描述</th>
              <th>金额</th>
              <th>分类</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: 40, color: "#999" }}>暂无交易记录</td></tr>
            ) : (
              txns.map((t) => (
                <tr key={t.id}>
                  <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>{t.date}</td>
                  <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.raw_description}>{t.raw_description}</td>
                  <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.cleaned_description}>{t.cleaned_description}</td>
                  <td style={{ color: t.amount > 0 ? "#ef4444" : "#22c55e", fontWeight: 500, whiteSpace: "nowrap" }}>
                    {t.amount > 0 ? "-" : "+"}¥{Math.abs(t.amount).toFixed(2)}
                  </td>
                  <td>
                    {t.category_name ? (
                      <span>
                        {t.category_name}
                        {t.subcategory_name && <span style={{ color: "#999" }}> › {t.subcategory_name}</span>}
                        {!t.is_categorized && <span style={{ color: "#f59e0b", fontSize: 11 }}> (待确认)</span>}
                      </span>
                    ) : (
                      <span style={{ color: "#f59e0b" }}>未分类</span>
                    )}
                  </td>
                  <td>
                    <div className="inline-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => setEditing(t)} title="编辑">✏️</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => reCategorize(t.id)} title="AI重新分类">🔄</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(t.id)} title="删除">🗑</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 3, totalPages - 6));
            const pn = start + i;
            if (pn > totalPages) return null;
            return <button key={pn} className={pn === page ? "active" : ""} onClick={() => setPage(pn)}>{pn}</button>;
          })}
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>下一页</button>
        </div>
      )}

      {showAdd && <AddModal categories={categories} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); showToast("已添加"); }} />}
      {editing && <EditModal txn={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); showToast("已保存"); }} />}
    </div>
  );
}

function AddModal({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");

  const handleSubmit = async () => {
    if (!date || !desc || !amount) return;
    await api.createTransaction({ date, description: desc, amount: parseFloat(amount) });
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>添加交易</h2>
        <div className="form-group"><label>日期</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="form-group"><label>描述</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="交易描述" /></div>
        <div className="form-group"><label>金额（正数=支出）</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit}>添加</button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ txn, categories, onClose, onSaved }: { txn: Transaction; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [catId, setCatId] = useState(txn.category_id || 0);
  const [subId, setSubId] = useState(txn.subcategory_id || 0);
  const [date, setDate] = useState(txn.date);
  const [desc, setDesc] = useState(txn.raw_description);
  const [amount, setAmount] = useState(String(txn.amount));

  const parentCats = categories.filter((c) => !c.parent_id);
  const selectedParent = parentCats.find((c) => c.id === catId);
  const subCats = selectedParent?.children || [];

  const handleSubmit = async () => {
    await api.updateTransaction(txn.id, {
      date,
      raw_description: desc,
      amount: parseFloat(amount),
      category_id: catId || null,
      subcategory_id: subId || null,
    });
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>编辑交易</h2>
        <div className="form-group"><label>日期</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="form-group"><label>描述</label><input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="form-group"><label>金额</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="form-group"><label>分类</label>
          <select value={catId} onChange={(e) => { setCatId(Number(e.target.value)); setSubId(0); }}>
            <option value={0}>未分类</option>
            {parentCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {subCats.length > 0 && (
          <div className="form-group"><label>子分类</label>
            <select value={subId} onChange={(e) => setSubId(Number(e.target.value))}>
              <option value={0}>不指定</option>
              {subCats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={handleSubmit}>保存</button>
        </div>
      </div>
    </div>
  );
}
