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
import { api } from "../api/client";
import type { ImportResult, Transaction } from "../types";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WandSparkles,
} from "lucide-react";

const demoTrend = [
  { month: "01", spend: 6200, income: 18000 },
  { month: "02", spend: 7100, income: 18100 },
  { month: "03", spend: 6800, income: 18600 },
  { month: "04", spend: 8200, income: 18800 },
  { month: "05", spend: 7928, income: 20680 },
];

const demoPie = [
  { name: "餐饮食品", value: 36.2, color: "#1f7aff" },
  { name: "购物消费", value: 22.1, color: "#ff8a1f" },
  { name: "交通出行", value: 15.8, color: "#22c55e" },
  { name: "通讯费用", value: 8.7, color: "#7c3aed" },
  { name: "其他", value: 17.2, color: "#94a3b8" },
];

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [activeInsight, setActiveInsight] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState("");

  const refreshTransactions = () => {
    api.listTransactions({ page: 1, per_page: 200, sort_by: "date", sort_order: "desc" })
      .then((data) => setTxns(data.items))
      .catch(() => setTxns([]));
  };

  useEffect(() => {
    refreshTransactions();
    api.health().then(setHealth).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setActiveInsight((v) => (v + 1) % 3), 4200);
    return () => window.clearInterval(timer);
  }, []);

  const handleImport = async (file?: File) => {
    if (!file) return;
    setUploadingState(true);
    try {
      const result = await api.importFile(file);
      setImportResult(result);
      refreshTransactions();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "上传失败，请检查后端服务是否运行。");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setUploadingState = (active: boolean) => {
    setImporting(active);
    setUploadError("");
    setImportResult(null);
  };

  const handleCategorizeAll = async () => {
    setCategorizing(true);
    try {
      await api.categorizeAll();
      refreshTransactions();
    } finally {
      setCategorizing(false);
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
      categorized,
      uncategorized,
      rate: txns.length ? Math.round((categorized / txns.length) * 100) : 0,
    };
  }, [txns]);

  const trend = useMemo(() => {
    if (!txns.length) return demoTrend;
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
    if (!txns.length) return demoPie;
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

  const insights = [
    {
      title: metrics.count ? "本月账单已就绪" : "从一份账单开始",
      body: metrics.count ? `本地账本已有 ${metrics.count} 条交易，分类覆盖率 ${metrics.rate}%。` : "上传 Excel/CSV 后，这里会生成消费结构、趋势和可追问的数据上下文。",
    },
    {
      title: "下一步建议",
      body: metrics.uncategorized ? `还有 ${metrics.uncategorized} 条交易待分类，建议先运行 AI 分类再看趋势。` : "分类状态良好，可以直接进入智能问答追问本月消费。",
    },
    {
      title: "本地隐私状态",
      body: health?.ollama ? "Ollama 正在本地运行，分类和问答不需要把流水发到云端。" : "交易会保存在本地 SQLite；Ollama 状态可在设置页确认。",
    },
  ];

  return (
    <div className="home-grid upload-first">
      <section className="home-hero upload-hero">
        <div className="upload-copy">
          <span className="eyebrow"><Sparkles size={15} />Local monthly ledger</span>
          <h1>上传本月账单，生成你的消费看板。</h1>
          <p>拖入银行、支付宝或微信导出的 Excel/CSV，TxnCatAI 会在本机完成解析、去重、清洗、分类和中文问答。</p>
          <div className="home-actions">
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <RefreshCw className="spin" size={16} /> : <UploadCloud size={16} />}
              {importing ? "导入中..." : "选择账单文件"}
            </button>
            <Link className="btn btn-secondary" to="/query"><MessageSquareText size={16} />问问账本</Link>
          </div>
        </div>

        <div
          className={`upload-dropzone ${dragActive ? "active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            handleImport(event.dataTransfer.files?.[0]);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => handleImport(event.target.files?.[0])}
          />
          <div className="upload-icon"><FileSpreadsheet size={28} /></div>
          <strong>{importing ? "正在读取账单..." : "拖拽 Excel/CSV 到这里"}</strong>
          <span>支持 .xlsx / .xls / .csv，本地解析，不上传云端</span>
          {importResult && (
            <div className="upload-result">
              <CheckCircle2 size={16} />
              新增 {importResult.imported} 条，自动分类 {importResult.categorized} 条
              {importResult.skipped > 0 ? `，跳过重复 ${importResult.skipped} 条` : ""}
            </div>
          )}
          {uploadError && <div className="upload-error">{uploadError}</div>}
        </div>
      </section>

      <section className="home-metrics">
        <HomeMetric label="交易笔数" value={String(metrics.count || 0)} delta={metrics.count ? "local" : "待上传"} />
        <HomeMetric label="本月支出" value={`¥ ${(metrics.spend || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="spend" />
        <HomeMetric label="收入金额" value={`¥ ${(metrics.income || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} delta="income" />
        <HomeMetric label="分类覆盖" value={`${metrics.rate}%`} delta={metrics.uncategorized ? `${metrics.uncategorized} 待分类` : "ready"} />
      </section>

      <section className="home-panel next-actions-panel">
        <div className="panel-title">
          <div>
            <strong>本月处理流</strong>
            <span>上传后按这个顺序完成 demo</span>
          </div>
        </div>
        <div className="workflow-steps">
          <WorkflowStep index="01" title="导入账单" body="读取交易日期、描述和金额，自动跳过重复流水。" active />
          <WorkflowStep index="02" title="AI 分类" body="用本地 Ollama 清洗商户名并匹配消费类别。" active={metrics.count > 0} />
          <WorkflowStep index="03" title="追问趋势" body="直接问这个月哪里花多了、哪些交易异常。" active={metrics.rate > 0} />
        </div>
        <div className="action-strip">
          <button className="wide-action" onClick={handleCategorizeAll} disabled={!metrics.count || categorizing}>
            {categorizing ? <RefreshCw className="spin" size={16} /> : <WandSparkles size={16} />}
            {categorizing ? "分类中..." : "运行 AI 分类"}
          </button>
          <Link className="wide-action" to="/transactions">查看交易明细 <ArrowRight size={16} /></Link>
        </div>
      </section>

      <aside className="home-panel ai-carousel">
        <div className="panel-title">
          <div>
            <strong>AI 洞察</strong>
            <span>上传后自动变成你的账本上下文</span>
          </div>
          <Bot size={18} />
        </div>
        <div className="insight-carousel-card">
          <span>{activeInsight + 1}/3</span>
          <h3>{insights[activeInsight].title}</h3>
          <p>{insights[activeInsight].body}</p>
        </div>
        <div className="carousel-dots">
          {insights.map((item, index) => (
            <button
              key={item.title}
              className={activeInsight === index ? "active" : ""}
              onClick={() => setActiveInsight(index)}
              aria-label={item.title}
            />
          ))}
        </div>
        <div className="prompt-chips">
          <Link to="/query">这个月哪里花多了？</Link>
          <Link to="/query">有哪些异常大额交易？</Link>
        </div>
      </aside>

      <section className="home-panel chart-panel">
        <div className="panel-title">
          <div>
            <strong>收支趋势</strong>
            <span>{metrics.count ? "基于本地交易" : "上传后替换为真实数据"}</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={246}>
          <AreaChart data={trend}>
            <defs>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1f7aff" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#1f7aff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#edf2f7" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis hide />
            <Tooltip />
            <Area type="monotone" dataKey="spend" stroke="#1f7aff" fill="url(#spendFill)" strokeWidth={2.5} />
            <Area type="monotone" dataKey="income" stroke="#22c55e" fill="url(#incomeFill)" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <section className="home-panel pie-panel">
        <div className="panel-title">
          <div>
            <strong>分类结构</strong>
            <span>支出占比</span>
          </div>
        </div>
        <div className="pie-wrap">
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
                <em>{typeof item.value === "number" ? item.value.toFixed(item.value > 100 ? 0 : 1) : item.value}</em>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-panel privacy-panel">
        <ShieldCheck size={22} />
        <div>
          <strong>本地优先的月度账本</strong>
          <p>交易存进 SQLite，AI 通过 Ollama 在本机运行。适合用真实账单做私密 demo。</p>
        </div>
        <div className="privacy-icons">
          <LockKeyhole size={19} />
          <Database size={19} />
        </div>
      </section>
    </div>
  );
}

function HomeMetric({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="home-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{delta}</em>
    </div>
  );
}

function WorkflowStep({ index, title, body, active }: { index: string; title: string; body: string; active: boolean }) {
  return (
    <div className={`workflow-step ${active ? "active" : ""}`}>
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  );
}
