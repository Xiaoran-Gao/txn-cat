import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { api } from "../api/client";
import type { Category, ClassificationJob, ImportResult, Transaction } from "../types";
import { getClassificationProgress } from "../utils/classificationProgress";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";

export default function Transactions() {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [activeMonth, setActiveMonth] = useState(currentMonth());
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState("desc");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [classificationJob, setClassificationJob] = useState<ClassificationJob | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [filterOptions, setFilterOptions] = useState({
    accounts: [] as string[],
    payment_channels: [] as string[],
    merchant_platforms: [] as string[],
  });

  const perPage = 50;

  const load = useCallback(() => {
    const [filterType, filterId] = catFilter.split(":");
    const [startDate, endDate] = monthRange(activeMonth);
    api.listTransactions({
      page,
      per_page: perPage,
      start_date: startDate,
      end_date: endDate,
      search,
      category_id: filterType === "cat" ? filterId : undefined,
      subcategory_id: filterType === "sub" ? filterId : undefined,
      is_categorized: statusFilter === "confirmed" ? true : statusFilter === "pending" ? false : undefined,
      account_name: accountFilter === "all" ? undefined : accountFilter,
      sort_by: sortBy,
      sort_order: sortOrder,
    })
      .then((d) => {
        setTxns(d.items);
        setTotal(d.total);
      })
      .catch(() => setToast({ msg: "加载交易记录失败", type: "error" }));
  }, [page, activeMonth, search, catFilter, statusFilter, accountFilter, sortBy, sortOrder]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const [filterType, filterId] = catFilter.split(":");
    const [startDate, endDate] = monthRange(activeMonth);
    api.transactionFilterOptions({
      start_date: startDate,
      end_date: endDate,
      search,
      category_id: filterType === "cat" ? filterId : undefined,
      subcategory_id: filterType === "sub" ? filterId : undefined,
      is_categorized: statusFilter === "confirmed" ? true : statusFilter === "pending" ? false : undefined,
    })
      .then((options) => {
        setFilterOptions(options);
        setAccountFilter((current) => current === "all" || options.accounts.includes(current) ? current : "all");
      })
      .catch(() => setFilterOptions({ accounts: [], payment_channels: [], merchant_platforms: [] }));
  }, [activeMonth, search, catFilter, statusFilter]);

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
    const categorized = txns.filter((t) => t.is_categorized && t.category_name).length;
    const uncategorized = txns.length - categorized;
    const reviewNeeded = txns.filter(needsManualReview).length;
    const rate = txns.length ? Math.round(categorized / txns.length * 100) : 0;
    const confidenceValues = txns
      .map((t) => t.classification_confidence)
      .filter((value): value is number => typeof value === "number");
    const avgConfidence = confidenceValues.length
      ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
      : null;
    return { count: txns.length, categorized, uncategorized, reviewNeeded, rate, avgConfidence };
  }, [txns]);

  const totalPages = Math.ceil(total / perPage);
  const classificationProgress = classificationJob ? getClassificationProgress(classificationJob) : null;

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

      {classificationJob && classificationProgress && (
        <div className="import-banner">
          <div className="classification-banner-body">
            <div>
              <Loader2 className={classificationJob.status === "queued" || classificationProgress.isActive ? "spin" : ""} size={18} />
              <span>
                <b>{classificationJob.message}</b>：
                {classificationProgress.processed}/{classificationProgress.total}
                ，成功 <b>{classificationProgress.categorized}</b> 条，失败 <b>{classificationProgress.failed}</b> 条
              </span>
              {classificationJob.error && <span className="danger-text">，{classificationJob.error}</span>}
            </div>
            <div className={`progress-track ${classificationProgress.isActive ? "active" : ""}`}>
              <span style={{ width: `${classificationProgress.percent}%` }} />
            </div>
          </div>
          <button className="ghost-link" onClick={() => setClassificationJob(null)}>关闭</button>
        </div>
      )}

      <section className="stat-card-grid">
        <StatCard label="当前页交易" value={`${stats.count} 条`} meta={`全量匹配 ${total} 条`} icon={<ListChecks size={14} />} tone="cyan" />
        <StatCard label="分类覆盖率" value={`${stats.rate}%`} meta={`已分类 ${stats.categorized} 条`} icon={<CheckCheck size={14} />} tone="green" />
        <StatCard label="未分类交易" value={`${stats.uncategorized} 条`} meta="建议批量 AI 分类" icon={<AlertTriangle size={14} />} tone="orange" />
        <StatCard label="需要人工复核" value={`${stats.reviewNeeded} 条`} meta={stats.avgConfidence === null ? "暂无置信度" : `平均置信度 ${stats.avgConfidence}%`} icon={<Eye size={14} />} tone="violet" />
      </section>

      <div className="transaction-layout-grid single-column">
        <section className="glass-panel transaction-main-panel">
          <div className="filter-strip">
            <div className="table-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="搜索描述、商品、商户"
              />
            </div>
            <label className="month-filter">
              <CalendarDays size={15} />
              <span>月份</span>
              <input
                type="month"
                lang="zh-CN"
                value={activeMonth}
                onChange={(e) => { setActiveMonth(e.target.value); setPage(1); }}
              />
            </label>
            <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }}>
              <option value="all">全部账户</option>
              {filterOptions.accounts.map((account) => <option key={account} value={account}>{account}</option>)}
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
            <button className="filter-btn" onClick={() => { setCatFilter(""); setStatusFilter("all"); setAccountFilter("all"); setSearch(""); setActiveMonth(currentMonth()); }}>重置</button>
          </div>

          <div className="table-control-line">
            <div>
              <strong>共 {total} 条交易</strong>
              <button onClick={load}><RefreshCcw size={15} /></button>
            </div>
            <div className="view-toggles">
              <button className="filter-btn" onClick={() => setShowAdd(true)}><Plus size={15} />手动添加</button>
            </div>
          </div>

          <div className="transaction-table-shell">
            <table className="transaction-table">
              <colgroup>
                <col className="col-select" />
                <col className="col-date" />
                <col className="col-desc" />
                <col className="col-account" />
                <col className="col-category" />
                <col className="col-amount" />
                <col className="col-status" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="checkbox-col"><input type="checkbox" checked={selected.size === txns.length && txns.length > 0} onChange={toggleAll} /></th>
                  <th>日期</th>
                  <th>交易信息</th>
                  <th>账户/渠道</th>
                  <th>分类</th>
                  <th>金额</th>
                  <th>分类状态</th>
                  <th>
                    <div className="actions-head">
                      <strong>操作</strong>
                      <span><Pencil size={11} />编辑</span>
                      <span><Sparkles size={11} />AI 重分</span>
                      <span><Trash2 size={11} />删除</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {txns.length === 0 ? (
                  <tr><td colSpan={8} className="empty-table-cell">暂无交易记录</td></tr>
                ) : (
                  txns.map((t) => (
                    <tr key={t.id} className={selected.has(t.id) ? "selected-row" : ""}>
                      <td><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} /></td>
                      <td className="date-cell">{t.date}</td>
                      <td className="desc-cell" title={t.raw_description}>
                        <strong>{t.display_description || t.raw_description}</strong>
                        {formatTransactionMeta(t) && <span>{formatTransactionMeta(t)}</span>}
                      </td>
                      <td className="account-cell">
                        <strong>{getAccountName(t)}</strong>
                        {t.payment_channel && <span>{t.payment_channel}</span>}
                      </td>
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
                      <td
                        className="confidence-cell"
                        title={reviewLabel(t.classification_review_status, t.classification_review_reason)}
                      >
                        <span className={t.is_categorized && t.category_name ? "status-chip confirmed" : "status-chip pending"}>
                          {t.is_categorized && t.category_name ? "已分类" : "未分类"}
                        </span>
                        <em>{confidenceText(t)}</em>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button className="icon-btn" onClick={() => setEditing(t)} title="编辑交易"><Pencil size={15} /></button>
                          <button className="icon-btn" onClick={() => reCategorize(t.id)} title="AI重新分类"><Sparkles size={15} /></button>
                          <button className="icon-btn danger" onClick={() => handleDelete(t.id)} title="删除交易"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <div className="rows-select">
              每页显示 <strong>{perPage}</strong>
              <span>第 <strong>{Math.min(page, Math.max(totalPages, 1))}</strong> / <strong>{Math.max(totalPages, 1)}</strong> 页</span>
            </div>
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

      </div>

      {showAdd && <AddModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); showToast("已添加"); }} />}
      {editing && <EditModal txn={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); showToast("已保存"); }} />}
    </div>
  );
}

function StatCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: ReactNode; tone: string }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <span>{label} {icon}</span>
        <strong>{value}</strong>
        <em>{meta}</em>
      </div>
    </div>
  );
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(month: string) {
  if (!month) return [undefined, undefined] as const;
  const [year, monthIndex] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, monthIndex, 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return [start, end] as const;
}

function getAccountName(txn: Transaction) {
  return txn.account_name || "导入账单";
}

function formatTransactionMeta(txn: Transaction) {
  return txn.merchant_platform || "";
}

function categoryTone(name: string) {
  if (name.includes("餐饮")) return "orange";
  if (name.includes("交通")) return "blue";
  if (name.includes("收入") || name.includes("理财")) return "green";
  if (name.includes("购物")) return "pink";
  return "violet";
}

function reviewLabel(status: string | null, reason: string | null) {
  const labels: Record<string, string> = {
    not_reviewed: "未复核",
    review_approved: "复核通过",
    review_corrected: "复核已修正",
    review_invalid: "复核结果无效",
    review_missing: "复核未返回",
    manual: "人工分类",
  };
  const label = status ? labels[status] || status : "未复核";
  return reason ? `${label}：${reason}` : label;
}

function needsManualReview(txn: Transaction) {
  if (!txn.is_categorized || !txn.category_name) return true;
  if (typeof txn.classification_confidence === "number" && txn.classification_confidence < 70) return true;
  return ["not_reviewed", "review_invalid", "review_missing"].includes(txn.classification_review_status || "");
}

function confidenceText(txn: Transaction) {
  const confidence = typeof txn.classification_confidence === "number" ? `${txn.classification_confidence}%` : "未计算";
  return needsManualReview(txn) ? `${confidence} · 待复核` : `${confidence} · 已复核`;
}

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [accountName, setAccountName] = useState("");
  const [paymentChannel, setPaymentChannel] = useState("");
  const [merchantPlatform, setMerchantPlatform] = useState("");

  const handleSubmit = async () => {
    if (!date || !desc || !amount) return;
    await api.createTransaction({
      date,
      description: desc,
      amount: parseFloat(amount),
      account_name: emptyToNull(accountName),
      payment_channel: emptyToNull(paymentChannel),
      merchant_platform: emptyToNull(merchantPlatform),
    });
    onSaved();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>添加交易</h2>
        <div className="form-group"><label>日期</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="form-group"><label>描述</label><input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="交易描述" /></div>
        <div className="form-group"><label>金额（正数=支出）</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        <div className="form-grid two-col">
          <div className="form-group"><label>账户</label><input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="招商银行（尾号 1234）/ 微信零钱 / 支付宝余额" /></div>
          <div className="form-group"><label>支付渠道</label><input value={paymentChannel} onChange={(e) => setPaymentChannel(e.target.value)} placeholder="微信 / 支付宝 / 银行卡" /></div>
        </div>
        <div className="form-group"><label>消费平台</label><input value={merchantPlatform} onChange={(e) => setMerchantPlatform(e.target.value)} placeholder="美团 / 饿了么 / 滴滴" /></div>
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
  const [displayDesc, setDisplayDesc] = useState(txn.display_description || txn.raw_description);
  const [amount, setAmount] = useState(String(txn.amount));
  const [accountName, setAccountName] = useState(txn.account_name || "");
  const [paymentChannel, setPaymentChannel] = useState(txn.payment_channel || "");
  const [merchantPlatform, setMerchantPlatform] = useState(txn.merchant_platform || "");

  const parentCats = categories.filter((c) => !c.parent_id);
  const selectedParent = parentCats.find((c) => c.id === catId);
  const subCats = selectedParent?.children || [];

  const handleSubmit = async () => {
    await api.updateTransaction(txn.id, {
      date,
      raw_description: desc,
      display_description: displayDesc,
      amount: parseFloat(amount),
      account_name: emptyToNull(accountName),
      payment_channel: emptyToNull(paymentChannel),
      merchant_platform: emptyToNull(merchantPlatform),
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
        <div className="form-group"><label>展示描述</label><input value={displayDesc} onChange={(e) => setDisplayDesc(e.target.value)} /></div>
        <div className="form-group"><label>原始描述</label><input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="form-group"><label>金额</label><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="form-grid two-col">
          <div className="form-group"><label>账户</label><input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="招商银行（尾号 1234）/ 微信零钱 / 支付宝余额" /></div>
          <div className="form-group"><label>支付渠道</label><input value={paymentChannel} onChange={(e) => setPaymentChannel(e.target.value)} placeholder="微信 / 支付宝 / 银行卡" /></div>
        </div>
        <div className="form-group"><label>消费平台</label><input value={merchantPlatform} onChange={(e) => setMerchantPlatform(e.target.value)} placeholder="美团 / 饿了么 / 滴滴" /></div>
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

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
