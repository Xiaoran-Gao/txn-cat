import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  WalletCards,
} from "lucide-react";
import { api } from "../api/client";
import type { ClassificationJob, ImportResult } from "../types";

export default function Home() {
  const navigate = useNavigate();
  const storyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [job, setJob] = useState<ClassificationJob | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [activeScreen, setActiveScreen] = useState(0);
  const [classStep, setClassStep] = useState(0);
  const [dashboardStep, setDashboardStep] = useState(0);
  const [activeChat, setActiveChat] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setClassStep((value) => (value + 1) % classificationSteps.length), 1850);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setDashboardStep((value) => (value + 1) % 6), 2300);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setActiveChat((value) => (value + 1) % chatPreview.length), 2100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.categorizeJob(job.id);
        setJob(next);
        if (next.status === "done" || next.status === "failed") {
          window.clearInterval(timer);
          window.setTimeout(() => navigate("/dashboard"), 650);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "分类进度读取失败");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [job, navigate]);

  const handleImport = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setError("");
    setResult(null);
    setJob(null);
    try {
      const importResult = await api.importFile(file);
      setResult(importResult);
      if (importResult.classification_job_id) {
        setJob({
          id: importResult.classification_job_id,
          source: "upload",
          status: "queued",
          total: importResult.classification_total,
          processed: 0,
          categorized: 0,
          failed: 0,
          message: "等待开始 LLM 分类",
          error: null,
          created_at: "",
          updated_at: "",
        });
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败，请检查后端服务是否运行。");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const progress = job?.total ? Math.round((job.processed / job.total) * 100) : 0;
  const visibleChat = chatPreview.slice(0, activeChat + 1);
  const chatOffset = Math.max(0, visibleChat.length - 5) * 62;

  const handleStoryScroll = () => {
    const story = storyRef.current;
    if (!story) return;
    const next = Math.round(story.scrollTop / story.clientHeight);
    setActiveScreen(Math.max(0, Math.min(storyScreens.length - 1, next)));
  };

  const goToScreen = (index: number) => {
    const story = storyRef.current;
    const screen = story?.querySelectorAll<HTMLElement>(".story-screen")[index];
    if (story && screen) story.scrollTo({ top: screen.offsetTop, behavior: "smooth" });
  };

  return (
    <div className="product-story" ref={storyRef} onScroll={handleStoryScroll}>
      <nav className="story-progress" aria-label="Homepage sections">
        {storyScreens.map((screen, index) => (
          <button
            key={screen.label}
            className={index === activeScreen ? "active" : ""}
            onClick={() => goToScreen(index)}
            title={screen.label}
            type="button"
          >
            <span>{screen.index}</span>
          </button>
        ))}
      </nav>

      <section className="story-screen upload-screen">
        <div className="story-copy upload-story-copy">
          <span className="eyebrow"><ShieldCheck size={15} />Local-first finance copilot</span>
          <h1>把账单变成会说话的消费地图。</h1>
          <p>上传银行、微信或支付宝账单，剩下的交给本地 AI。</p>
        </div>

        <div
          className={`upload-dropzone story-upload-card ${dragActive ? "active" : ""}`}
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
          <strong>{job ? "正在进行 LLM 分类..." : "拖拽 Excel/CSV 到这里"}</strong>
          <span>上传后会自动进入 Dashboard</span>
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importing || !!job}>
            {importing ? <RefreshCw className="spin" size={16} /> : <UploadCloud size={16} />}
            {importing ? "导入中..." : "选择账单文件"}
          </button>
          {result && (
            <div className="upload-result">
              <CheckCircle2 size={16} />
              新增 {result.imported} 条，跳过重复 {result.skipped} 条
            </div>
          )}
          {job && <ProgressBar job={job} progress={progress} />}
          {error && <div className="upload-error">{error}</div>}
        </div>

        <div className="more-expect">
          <span>继续下滑，看看账单接下来会发生什么</span>
          <div>
            <button type="button" onClick={() => goToScreen(1)}>自动分类</button>
            <button type="button" onClick={() => goToScreen(2)}>消费看板</button>
            <button type="button" onClick={() => goToScreen(3)}>智能问答</button>
          </div>
        </div>
      </section>

      <section className="story-screen feature-screen classify-screen">
        <div className="story-copy">
          <span className="eyebrow"><Sparkles size={15} />交易分类</span>
          <h2>交易会自动找到自己的分类。</h2>
          <p>商户识别、分类建议、置信度和复核状态，会按步骤生成。</p>
        </div>
        <div className="classification-demo">
          <div className="transaction-input-card">
            <span>New transaction</span>
            <strong>2026-06-08 · 星巴克 · ¥38.00</strong>
          </div>
          <div className="classification-flow">
            {classificationSteps.map((step, index) => (
              <div className={`classification-step-card ${index <= classStep ? "visible" : ""} ${index === classStep ? "active" : ""}`} key={step.label}>
                <span>{step.label}</span>
                <strong>{step.value}</strong>
              </div>
            ))}
          </div>
          <div className={`final-category ${classStep === classificationSteps.length - 1 ? "visible" : ""}`}>
            <WalletCards size={17} />
            餐饮 / 咖啡饮品
          </div>
        </div>
      </section>

      <section className="story-screen feature-screen dashboard-screen reverse-screen">
        <div className={`dashboard-demo dashboard-canvas ${dashboardStep >= 0 ? "built" : ""}`}>
          <div className="dashboard-canvas-top">
            <div>
              <span />
              <span />
              <span />
            </div>
            <strong>Monthly overview</strong>
            <em>Live build</em>
          </div>

          <div className="dashboard-grid-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>

          <div className="dashboard-build-grid">
            <div className="dashboard-build-left">
              <div className={`ledger-feed build-step ${dashboardStep >= 1 ? "built" : ""}`}>
                <div className="ledger-feed-head">
                  <span>Parsed transactions</span>
                  <strong>4 of 284</strong>
                </div>
                {dashboardTransactions.map((txn, index) => (
                  <div className="ledger-row" key={txn.name} style={{ animationDelay: `${index * 140}ms` } as CSSProperties}>
                    <span>{txn.date}</span>
                    <strong>{txn.name}</strong>
                    <em>{txn.amount}</em>
                    <b>{txn.category}</b>
                  </div>
                ))}
              </div>

              <div className={`dashboard-metric-row build-step ${dashboardStep >= 2 ? "built" : ""}`}>
                <div><span>本月支出</span><strong>¥ 8,426</strong><em>+12.4%</em></div>
                <div><span>分类覆盖</span><strong>94%</strong><em>自动通过</em></div>
                <div><span>待复核</span><strong>12</strong><em>低置信度</em></div>
              </div>
            </div>

            <div className="dashboard-build-right">
              <div className={`trend-card build-step ${dashboardStep >= 3 ? "built" : ""}`}>
                <div className="trend-card-head">
                  <span>Spend trend</span>
                  <strong>按周聚合</strong>
                </div>
                <svg viewBox="0 0 520 220" role="img" aria-label="Monthly spend trend">
                  <defs>
                    <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#0e7490" stopOpacity="0.36" />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.03" />
                    </linearGradient>
                    <linearGradient id="trendStroke" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#0e7490" />
                      <stop offset="100%" stopColor="#2dd4bf" />
                    </linearGradient>
                  </defs>
                  <path className="trend-area" d="M18 178 C62 148 82 118 124 126 C172 136 184 78 232 88 C282 98 292 152 342 120 C392 88 410 58 464 74 C488 82 506 68 520 58 L520 220 L18 220 Z" />
                  <path className="trend-line" d="M18 178 C62 148 82 118 124 126 C172 136 184 78 232 88 C282 98 292 152 342 120 C392 88 410 58 464 74 C488 82 506 68 520 58" />
                  <g className="trend-bars">
                    {[88, 128, 82, 154, 116, 142, 178].map((height, index) => (
                      <rect key={height} x={36 + index * 68} y={204 - height} width="18" height={height} rx="5" />
                    ))}
                  </g>
                  <circle className="trend-point" cx="520" cy="58" r="6" />
                </svg>
              </div>

              <div className={`category-breakdown build-step ${dashboardStep >= 4 ? "built" : ""}`}>
                {dashboardCategories.map((category) => (
                  <div key={category.name}>
                    <span style={{ width: category.width }} />
                    <strong>{category.name}</strong>
                    <em>{category.value}</em>
                  </div>
                ))}
              </div>

              <div className={`insight-strip build-step ${dashboardStep >= 5 ? "built" : ""}`}>
                <span>Auto insight</span>
                <strong>餐饮支出较上月上升 18%，周末聚餐和外卖是主要变化。</strong>
              </div>
            </div>
          </div>
        </div>
        <div className="story-copy">
          <span className="eyebrow"><BarChart3 size={15} />消费看板</span>
          <h2>看懂这个月的钱去了哪里。</h2>
          <p>TxnCat 会把流水整理成趋势、分类和异常线索，而不是只给你一张表。</p>
        </div>
      </section>

      <section className="story-screen feature-screen ask-screen">
        <div className="story-copy">
          <span className="eyebrow"><Bot size={15} />智能问答</span>
          <h2>直接问你的账本。</h2>
          <p>从用户提问，到 SQL 查询，再到答案生成，过程透明也可以继续追问。</p>
          <Link className="btn btn-secondary split-btn" to="/query">打开智能问答 <ArrowRight size={15} /></Link>
        </div>
        <div className="ai-chat-demo">
          <div className="device-topline">
            <span />
            <strong>TxnCat AI</strong>
            <em>Typing</em>
          </div>
          <div className="device-chat-shell refined-chat-shell">
            <div className="device-chat" style={{ "--chat-offset": `${chatOffset}px` } as CSSProperties}>
              {visibleChat.map((item, index) => (
                <div className={`device-bubble ${item.from} ${item.kind || ""} ${index === activeChat ? "active" : ""}`} key={item.text}>
                  {item.from === "bot" && <Bot size={14} />}
                  <span>{item.text}</span>
                </div>
              ))}
              {activeChat < chatPreview.length - 1 && (
                <div className="device-typing">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const storyScreens = [
  { index: "01", label: "上传" },
  { index: "02", label: "分类" },
  { index: "03", label: "看板" },
  { index: "04", label: "问答" },
];

const classificationSteps = [
  { label: "商户识别", value: "星巴克 Starbucks" },
  { label: "消费方向", value: "支出 · 餐饮" },
  { label: "置信度", value: "92% · 自动通过" },
  { label: "复核建议", value: "无需人工处理" },
];

const dashboardTransactions = [
  { date: "06/08", name: "星巴克 Starbucks", amount: "¥38.00", category: "餐饮" },
  { date: "06/08", name: "滴滴出行", amount: "¥26.50", category: "交通" },
  { date: "06/07", name: "盒马鲜生", amount: "¥183.20", category: "购物" },
  { date: "06/07", name: "招商银行还款", amount: "¥2,000", category: "信用卡" },
];

const dashboardCategories = [
  { name: "餐饮", value: "¥2,184", width: "68%" },
  { name: "购物", value: "¥1,306", width: "46%" },
  { name: "交通", value: "¥620", width: "28%" },
];

const chatPreview = [
  { from: "user", text: "这个月餐饮为什么涨了？" },
  { from: "bot", kind: "sql", text: "SELECT category, COUNT(*), SUM(amount) FROM transactions WHERE month='2026-06' GROUP BY category;" },
  { from: "bot", text: "餐饮上涨主要来自外卖增加 18 笔，周末聚餐贡献最大。" },
  { from: "user", text: "有哪些异常大额交易？" },
  { from: "bot", kind: "sql", text: "SELECT date, merchant, amount FROM transactions WHERE amount > monthly_avg * 2.5;" },
  { from: "bot", text: "发现 3 笔高于常态，已标记待复核。" },
  { from: "user", text: "下个月我应该控制哪里？" },
  { from: "bot", kind: "sql", text: "SELECT category, trend_pct FROM monthly_spend ORDER BY trend_pct DESC LIMIT 3;" },
  { from: "bot", text: "建议先看餐饮、购物和交通，三项合计比上月多 ¥1,236。" },
];

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
