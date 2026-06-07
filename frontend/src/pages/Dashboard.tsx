import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowRight, FileSpreadsheet, MessageSquareText, RefreshCw, UploadCloud, WandSparkles } from "lucide-react";
import { api } from "../api/client";
import type { ClassificationJob, ImportResult, Transaction } from "../types";

async function fetchAllTransactions() {
  const perPage = 200;
  const first = await api.listTransactions({ page: 1, per_page: perPage, sort_by: "date", sort_order: "desc" });
  const items = [...first.items];
  const totalPages = Math.ceil(first.total / perPage);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await api.listTransactions({ page, per_page: perPage, sort_by: "date", sort_order: "desc" });
    items.push(...next.items);
  }
  return items;
}

export default function Dashboard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [job, setJob] = useState<ClassificationJob | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refreshTransactions = async () => {
    setTxns(await fetchAllTransactions());
  };

  useEffect(() => {
    refreshTransactions().catch(() => setTxns([]));
  }, []);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.categorizeJob(job.id);
        setJob(next);
        if (next.status === "done" || next.status === "failed") {
          setCategorizing(false);
          setNotice(`分类完成：成功 ${next.categorized} 条，失败 ${next.failed} 条。`);
          refreshTransactions().catch(() => {});
        }
      } catch (err) {
        setCategorizing(false);
        setError(err instanceof Error ? err.message : "分类进度读取失败");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  const startJob = (jobId: string | null, total = 0) => {
    if (!jobId) return;
    setCategorizing(true);
    setJob({
      id: jobId,
      source: "upload",
      status: "queued",
      total,
      processed: 0,
      categorized: 0,
      failed: 0,
      message: "等待开始分类",
      error: null,
      created_at: "",
      updated_at: "",
    });
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setError("");
    setNotice("");
    try {
      const result: ImportResult = await api.importFile(file);
      setNotice(`导入完成：新增 ${result.imported} 条，跳过重复 ${result.skipped} 条。`);
      startJob(result.classification_job_id, result.classification_total);
      if (!result.classification_job_id) await refreshTransactions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleCategorizeAll = async () => {
    setCategorizing(true);
    setError("");
    setNotice("");
    try {
      const result = await api.categorizeAll();
      if (result.job_id) startJob(result.job_id, result.total);
      else {
        setCategorizing(false);
        setNotice("没有待分类交易。");
      }
    } catch (err) {
      setCategorizing(false);
      setError(err instanceof Error ? err.message : "分类失败");
    }
  };

  const metrics = useMemo(() => {
    const spend = txns.filter((t) => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
    const income = txns.filter((t) => t.amount < 0).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const categorized = txns.filter((t) => t.is_categorized && t.category_name).length;
    const uncategorized = txns.length - categorized;
    return {
      spend,
      income,
      count: txns.length,
      uncategorized,
      rate: txns.length ? Math.round((categorized / txns.length) * 100) : 0,
    };
  }, [txns]);

  const trend = useMemo(() => {
    const grouped = txns.reduce<Record<string, { month: string; spend: number; income: number }>>((acc, txn) => {
      const month = txn.date.slice(5, 7);
      acc[month] ||= { month, spend: 0, income: 0 };
      if (txn.amount > 0) acc[month].spend += txn.amount;
      else acc[month].income += Math.abs(txn.amount);
      return acc;
    }, {});
    return Object.values(grouped).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  }, [txns]);

  const categoryPie = useMemo(() => {
    const grouped = txns.reduce<Record<string, number>>((acc, txn) => {
      if (txn.amount > 0) {
        const key = txn.category_name || "未分类";
        acc[key] = (acc[key] || 0) + txn.amount;
      }
      return acc;
    }, {});
    const colors = ["#1f7aff", "#ff8a1f", "#22c55e", "#7c3aed", "#06b6d4", "#94a3b8"];
    return Object.entries(grouped).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value], index) => ({
      name,
      value,
      color: colors[index % colors.length],
    }));
  }, [txns]);

  const progress = job?.total ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="home-grid dashboard-workspace">
      <section className="home-metrics">
        <Metric label="交易笔数" value={String(metrics.count)} delta="全量本地数据" />
        <Metric label="本月支出" value={`¥ ${metrics.spend.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="真实交易汇总" />
        <Metric label="收入金额" value={`¥ ${metrics.income.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="真实交易汇总" />
        <Metric label="分类覆盖" value={`${metrics.rate}%`} delta={metrics.uncategorized ? `${metrics.uncategorized} 待确认` : "全部确认"} />
      </section>

      <section className="home-panel next-actions-panel">
        <div className="panel-title">
          <div>
            <strong>本月账本</strong>
            <span>上传新账单后会自动调用本地 LLM 分类</span>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => handleImport(event.target.files?.[0])} />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing || categorizing}>
            {importing ? <RefreshCw className="spin" size={16} /> : <UploadCloud size={16} />}
            上传新账单
          </button>
        </div>
        <div className="action-strip">
          <button className="wide-action" onClick={handleCategorizeAll} disabled={!metrics.uncategorized || categorizing}>
            {categorizing ? <RefreshCw className="spin" size={16} /> : <WandSparkles size={16} />}
            {categorizing ? "LLM 分类中..." : "分类待确认交易"}
          </button>
          <Link className="wide-action" to="/transactions">查看交易明细 <ArrowRight size={16} /></Link>
        </div>
        {job && <ProgressBar job={job} progress={progress} />}
        {notice && <div className="upload-result">{notice}</div>}
        {error && <div className="upload-error">{error}</div>}
      </section>

      <section className="home-panel chart-panel">
        <div className="panel-title"><div><strong>收支趋势</strong><span>基于本地交易</span></div></div>
        {trend.length ? (
          <ResponsiveContainer width="100%" height={246}>
            <AreaChart data={trend}>
              <CartesianGrid stroke="#edf2f7" vertical={false} />
              <XAxis dataKey="month" tickLine={false} axisLine={false} />
              <YAxis hide />
              <Tooltip />
              <Area type="monotone" dataKey="spend" stroke="#1f7aff" fill="#dbeafe" strokeWidth={2.5} />
              <Area type="monotone" dataKey="income" stroke="#22c55e" fill="#dcfce7" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="empty-chart-state">暂无收支趋势数据</div>
        )}
      </section>

      <section className="home-panel pie-panel">
        <div className="panel-title"><div><strong>分类结构</strong><span>支出占比</span></div></div>
        <div className="pie-wrap">
          {categoryPie.length ? (
            <>
              <ResponsiveContainer width="45%" height={220}>
                <PieChart>
                  <Pie data={categoryPie} dataKey="value" innerRadius={52} outerRadius={82} paddingAngle={3}>
                    {categoryPie.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pie-legend">
                {categoryPie.map((item) => (
                  <div key={item.name}>
                    <span style={{ background: item.color }} />
                    <strong>{item.name}</strong>
                    <em>{item.value.toFixed(item.value > 100 ? 0 : 1)}</em>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-chart-state">暂无支出分类数据</div>
          )}
        </div>
      </section>

      <aside className="home-panel ai-carousel">
        <div className="panel-title"><div><strong>下一步</strong><span>继续探索账本</span></div></div>
        <div className="prompt-chips">
          <Link to="/query"><MessageSquareText size={15} />这个月哪里花多了？</Link>
          <Link to="/query">有哪些异常大额交易？</Link>
          <Link to="/transactions"><FileSpreadsheet size={15} />处理待确认交易</Link>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="home-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{delta}</em>
    </div>
  );
}

function ProgressBar({ job, progress }: { job: ClassificationJob; progress: number }) {
  return (
    <div className="classification-progress">
      <div>
        <strong>{job.message}</strong>
        <span>{job.processed}/{job.total} · 成功 {job.categorized} · 失败 {job.failed}</span>
      </div>
      <div className={`progress-track ${job.status === "running" && job.processed < job.total ? "active" : ""}`}>
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
