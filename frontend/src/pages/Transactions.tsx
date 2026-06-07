import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { api } from "../api/client";
import type { Category, ClassificationJob, ImportResult, Transaction } from "../types";
import {
  Bot,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Grid3X3,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCcw,
  Rows3,
  Sparkles,
  Trash2,
  Upload,
  WalletCards,
} from "lucide-react";

const sampleLines = [
  { value: 34 }, { value: 31 }, { value: 38 }, { value: 36 }, { value: 45 }, { value: 40 }, { value: 48 },
];

const colorPool = ["#1f7aff", "#ff8a1f", "#22c55e", "#7c3aed", "#06b6d4", "#94a3b8"];

export default function Transactions() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [density, setDensity] = useState<"comfort" | "compact">("comfort");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [classificationJob, setClassificationJob] = useState<ClassificationJob | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [activeInsight, setActiveInsight] = useState(0);

  const perPage = 50;

  const load = useCallback(() => {
    const [filterType, filterId] = catFilter.split(":");
    api.listTransactions({
      page,
      per_page: perPage,
      search,
      category_id: filterType === "cat" ? filterId : undefined,
      subcategory_id: filterType === "sub" ? filterId : undefined,
      is_categorized: statusFilter === "confirmed" ? true : statusFilter === "pending" ? false : undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    })
      .then((d) => {
        const accountFiltered = accountFilter === "all"
          ? d.items
          : d.items.filter((txn) => getAccount(txn) === accountFilter);
        setTxns(accountFiltered);
        setTotal(d.total);
      })
      .catch(() => setToast({ msg: "加载交易记录失败", type: "error" }));
  }, [page, search, catFilter, statusFilter, accountFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setActiveInsight((v) => (v + 1) % 3), 3200);
    return () => window.clearInterval(timer);
  }, []);

  const showToast = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!classificationJob || classificationJob.status === "done" || classificationJob.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.categorizeJob(classificationJob.id);
        setClassificationJob(next);
        if (next.status === "done" || next.status === "failed") {
          window.clearInterval(timer);
          setCategorizing(false);
          if (next.error) {
            showToast(next.error, "error");
          } else {
            showToast(`分类完成：成功 ${next.categorized} 条，失败 ${next.failed} 条`, next.failed ? "error" : "success");
          }
          load();
        }
      } catch (err) {
        window.clearInterval(timer);
        setCategorizing(false);
        showToast(err instanceof Error ? err.message : "分类进度读取失败", "error");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [classificationJob, load]);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.importFile(file);
      setImportResult(result);
      if (result.classification_job_id) {
        setCategorizing(true);
        setClassificationJob({
          id: result.classification_job_id,
          source: "upload",
          status: "queued",
          total: result.classification_total,
          processed: 0,
          categorized: 0,
          failed: 0,
          message: "等待开始 LLM 分类",
          error: null,
          created_at: "",
          updated_at: "",
        });
        showToast(`导入完成：新增 ${result.imported} 条，开始自动分类`);
      } else {
        showToast(`导入完成：新增 ${result.imported} 条`);
      }
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
      const result = await api.categorizeAll();
      if (result.job_id) {
        setClassificationJob({
          id: result.job_id,
          source: "manual",
          status: "queued",
          total: result.total,
          processed: 0,
          categorized: 0,
          failed: 0,
          message: "等待开始 LLM 分类",
          error: null,
          created_at: "",
          updated_at: "",
        });
      } else {
        showToast("没有待分类交易");
        setCategorizing(false);
      }
    } catch {
      showToast("分类失败，请检查 Ollama 是否运行", "error");
      setCategorizing(false);
    }
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
    if (next.has(id)) next.delete(id);
    else next.add(id);
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

  const stats = useMemo(() => {
    const income = txns.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const spend = txns.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const categorized = txns.filter((t) => t.is_categorized && t.category_name).length;
    const rate = txns.length ? Math.round(categorized / txns.length * 100) : 0;
    return { income, spend, count: txns.length, rate };
  }, [txns]);

  const accountOptions = useMemo(() => {
    return Array.from(new Set(txns.map(getAccount))).sort();
  }, [txns]);

  const categoryPie = useMemo(() => {
    const grouped = txns.reduce<Record<string, number>>((acc, txn) => {
      if (txn.amount > 0) acc[txn.category_name || "未分类"] = (acc[txn.category_name || "未分类"] || 0) + txn.amount;
      return acc;
    }, {});
    const entries = Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!entries.length) return [
      { name: "餐饮食品", value: 36.2, color: "#1f7aff" },
      { name: "购物消费", value: 22.1, color: "#ff8a1f" },
      { name: "交通出行", value: 15.8, color: "#22c55e" },
      { name: "其他", value: 25.9, color: "#94a3b8" },
    ];
    return entries.map(([name, value], index) => ({ name, value, color: colorPool[index % colorPool.length] }));
  }, [txns]);

  const trend = useMemo(() => {
    const grouped = txns.reduce<Record<string, { day: string; spend: number; income: number }>>((acc, txn) => {
      const day = txn.date.slice(5);
      acc[day] ||= { day, spend: 0, income: 0 };
      if (txn.amount > 0) acc[day].spend += txn.amount;
      else acc[day].income += Math.abs(txn.amount);
      return acc;
    }, {});
    const result = Object.values(grouped).sort((a, b) => a.day.localeCompare(b.day)).slice(-12);
    return result.length ? result : [
      { day: "05-01", spend: 420, income: 0 },
      { day: "05-06", spend: 610, income: 0 },
      { day: "05-11", spend: 530, income: 2000 },
      { day: "05-16", spend: 760, income: 0 },
      { day: "05-21", spend: 690, income: 4680 },
      { day: "05-26", spend: 880, income: 320 },
      { day: "05-31", spend: 792, income: 18000 },
    ];
  }, [txns]);

  const insights = [
    {
      title: "本月支出概览",
      body: `支出金额 ¥${stats.spend.toFixed(2)}，分类覆盖率 ${stats.rate}% 。`,
    },
    {
      title: "待确认交易",
      body: `${txns.filter((t) => !t.is_categorized || !t.category_name).length} 笔交易需要确认，建议使用 AI 分类批处理。`,
    },
    {
      title: "趋势分析",
      body: "餐饮和交通类交易适合做演示追问：金额、趋势、异常都比较容易讲清楚。",
    },
  ];

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="transactions-workbench">
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      <div className="page-command-row">
        <div>
          <h1>交易记录</h1>
          <p>可导入、筛选、分类和校正的本地交易流水。</p>
        </div>
        <div className="command-actions">
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            <Upload size={16} />
            {importing ? "导入中..." : "导入 Excel/CSV"}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} hidden />
          </label>
          <button className="btn btn-primary split-btn" onClick={handleCategorize} disabled={categorizing}>
            {categorizing ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            {categorizing ? "分类中..." : "AI 分类"}
            <ChevronDown size={15} />
          </button>
        </div>
      </div>

      {importResult && (
        <div className="import-banner">
          <CheckCircle2 size={18} />
          <span>导入完成：新增 <b>{importResult.imported}</b> 条，待分类 <b>{importResult.classification_total}</b> 条，跳过重复 <b>{importResult.skipped}</b> 条</span>
          {importResult.errors.length > 0 && <span className="danger-text">，{importResult.errors.length} 条错误</span>}
          <button className="ghost-link" onClick={() => setImportResult(null)}>关闭</button>
        </div>
      )}

      {classificationJob && (
        <div className="import-banner">
          <Loader2 className={classificationJob.status === "queued" || classificationJob.status === "running" ? "spin" : ""} size={18} />
          <span>
            <b>{classificationJob.message}</b>：
            {classificationJob.processed}/{classificationJob.total}
            ，成功 <b>{classificationJob.categorized}</b> 条，失败 <b>{classificationJob.failed}</b> 条
          </span>
          {classificationJob.error && <span className="danger-text">，{classificationJob.error}</span>}
          <button className="ghost-link" onClick={() => setClassificationJob(null)}>关闭</button>
        </div>
      )}

      <section className="stat-card-grid">
        <StatCard label="总交易金额" value={`¥ ${(stats.income + stats.spend).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="+8.41%" icon={<Eye size={14} />} tone="cyan" />
        <StatCard label="收入金额" value={`¥ ${stats.income.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="+12.17%" icon={<WalletCards size={14} />} tone="green" />
        <StatCard label="支出金额" value={`¥ ${stats.spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="-18.35%" icon={<CircleDollarSign size={14} />} tone="blue" />
        <StatCard label="交易笔数" value={String(stats.count)} delta="+5.31%" icon={<BriefcaseBusiness size={14} />} tone="violet" />
      </section>

      <div className="transaction-layout-grid">
        <section className="glass-panel transaction-main-panel">
          <div className="filter-strip">
            <button className="filter-btn"><CalendarDays size={15} /> 本月 <ChevronDown size={14} /></button>
            <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }}>
              <option value="all">全部账户</option>
              {accountOptions.map((account) => <option key={account} value={account}>{account}</option>)}
            </select>
            <select value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(1); }}>
              <option value="">全部分类</option>
              {categories.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  <option value={`cat:${c.id}`}>{c.name}</option>
                  {c.children?.map((s) => <option key={s.id} value={`sub:${s.id}`}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="all">全部状态</option>
              <option value="confirmed">已确认</option>
              <option value="pending">待确认</option>
            </select>
            <select value={`${sortBy}-${sortOrder}`} onChange={(e) => {
              const [s, o] = e.target.value.split("-");
              setSortBy(s);
              setSortOrder(o);
            }}>
              <option value="date-desc">日期降序</option>
              <option value="date-asc">日期升序</option>
              <option value="amount-desc">金额降序</option>
              <option value="amount-asc">金额升序</option>
            </select>
            <button className="filter-btn" onClick={() => { setCatFilter(""); setStatusFilter("all"); setAccountFilter("all"); setSearch(""); }}>重置</button>
          </div>

          <div className="table-control-line">
            <div>
              <strong>共 {total} 条交易</strong>
              <button onClick={load}><RefreshCcw size={15} /></button>
            </div>
            <div className="view-toggles">
              <button className="filter-btn" onClick={() => setShowAdd(true)}><Plus size={15} />手动添加</button>
              <button className={density === "comfort" ? "active" : ""} onClick={() => setDensity("comfort")} title="舒展视图"><Rows3 size={16} /></button>
              <button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")} title="紧凑视图"><Grid3X3 size={16} /></button>
            </div>
          </div>

          <div className={`transaction-table-shell ${density}`}>
            <table className="transaction-table">
              <thead>
                <tr>
                  <th className="checkbox-col"><input type="checkbox" checked={selected.size === txns.length && txns.length > 0} onChange={toggleAll} /></th>
                  <th>日期</th>
                  <th>描述</th>
                  <th>账户</th>
                  <th>分类</th>
                  <th>金额</th>
                  <th>状态</th>
                  <th>置信度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan={9} className="empty-table-cell">暂无交易记录</td></tr>
                ) : (
                  txns.map((t) => (
                    <tr key={t.id} className={selected.has(t.id) ? "selected-row" : ""}>
                      <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                      <td className="date-cell">{t.date}</td>
                      <td className="desc-cell" title={t.raw_description}>
                        <strong>{t.cleaned_description || t.raw_description}</strong>
                        <span>{t.raw_description}</span>
                      </td>
                      <td className="account-cell">{getAccount(t)}</td>
                      <td>
                        {t.category_name ? (
                          <span className={`category-chip ${categoryTone(t.category_name)}`}>
                            {t.category_name}
                            {t.subcategory_name && <em>{t.subcategory_name}</em>}
                          </span>
                        ) : <span className="pending-pill">未分类</span>}
                      </td>
                      <td className={t.amount > 0 ? "amount spend" : "amount income"}>
                        {t.amount > 0 ? "-¥ " : "+¥ "}{Math.abs(t.amount).toFixed(2)}
                      </td>
                      <td><span className={t.is_categorized && t.category_name ? "status-chip confirmed" : "status-chip pending"}>{t.is_categorized && t.category_name ? "已确认" : "待确认"}</span></td>
                      <td className="confidence-cell">{confidenceFor(t)}%</td>
                      <td>
                        <div className="inline-actions">
                          <button className="icon-btn" onClick={() => setEditing(t)} title="编辑"><Pencil size={15} /></button>
                          <button className="icon-btn" onClick={() => reCategorize(t.id)} title="AI重新分类"><Sparkles size={15} /></button>
                          <button className="icon-btn danger" onClick={() => handleDelete(t.id)} title="删除"><Trash2 size={15} /></button>
                          <button className="icon-btn" title="更多"><MoreVertical size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <div className="rows-select">每页显示 <strong>{perPage}</strong></div>
            {selected.size > 0 && (
              <div className="selection-actions">
                <button className="btn btn-sm btn-secondary" onClick={handleBulkCategorize}>批量重新分类</button>
                <button className="btn btn-sm btn-danger" onClick={handleBulkDelete}>删除选中 ({selected.size})</button>
              </div>
            )}
            {totalPages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={15} /></button>
                <button className="active">{page}</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}><ChevronRight size={15} /></button>
              </div>
            )}
          </div>
        </section>

        <aside className="ai-side-stack">
          <section className="glass-panel ai-hole-panel">
            <div className="panel-title">
              <div><strong>AI 洞察</strong><span>自动轮播</span></div>
              <Bot size={18} />
            </div>
            <div className="insight-carousel-card">
              <span>{activeInsight + 1}/3</span>
              <h3>{insights[activeInsight].title}</h3>
              <p>{insights[activeInsight].body}</p>
            </div>
            <div className="carousel-dots">
              {insights.map((item, index) => (
                <button key={item.title} className={activeInsight === index ? "active" : ""} onClick={() => setActiveInsight(index)} />
              ))}
            </div>
          </section>

          <section className="glass-panel donut-panel">
            <div className="panel-title">
              <div><strong>本月支出概览</strong><span>分类占比</span></div>
            </div>
            <div className="donut-layout">
              <ResponsiveContainer width="44%" height={170}>
                <PieChart>
                  <Pie data={categoryPie} dataKey="value" innerRadius={44} outerRadius={66} paddingAngle={3}>
                    {categoryPie.map((item) => <Cell key={item.name} fill={item.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pie-legend compact">
                {categoryPie.map((item) => (
                  <div key={item.name}><span style={{ background: item.color }} /><strong>{item.name}</strong><em>{formatLegendValue(item.value)}</em></div>
                ))}
              </div>
            </div>
          </section>

          <section className="glass-panel mini-trend-panel">
            <div className="panel-title">
              <div><strong>趋势分析</strong><span>收支走势</span></div>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trend}>
                <Tooltip />
                <Line type="monotone" dataKey="spend" stroke="#1f7aff" strokeWidth={2.4} dot={false} />
                <Line type="monotone" dataKey="income" stroke="#22c55e" strokeWidth={2.4} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </aside>
      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); showToast("已添加"); }} />}
      {editing && <EditModal txn={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); showToast("已保存"); }} />}
    </div>
  );
}

function StatCard({ label, value, delta, icon, tone }: { label: string; value: string; delta: string; icon: ReactNode; tone: string }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <span>{label} {icon}</span>
        <strong>{value}</strong>
        <em>较上月 {delta}</em>
      </div>
      <ResponsiveContainer width={96} height={52}>
        <LineChart data={sampleLines}>
          <Line type="monotone" dataKey="value" stroke="currentColor" strokeWidth={2.2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function getAccount(txn: Transaction) {
  if (txn.account_name && txn.payment_channel) return `${txn.payment_channel} · ${txn.account_name}`;
  return txn.account_name || txn.payment_channel || "导入账单";
}

function confidenceFor(txn: Transaction) {
  if (!txn.is_categorized || !txn.category_name) return 82 + (txn.id % 8);
  return 95 + (txn.id % 6);
}

function categoryTone(name: string) {
  if (name.includes("餐饮")) return "orange";
  if (name.includes("交通")) return "blue";
  if (name.includes("收入") || name.includes("理财")) return "green";
  if (name.includes("购物")) return "pink";
  return "violet";
}

function formatLegendValue(value: number) {
  return value > 100 ? `¥ ${value.toFixed(0)}` : `${value.toFixed(1)}%`;
}

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
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
