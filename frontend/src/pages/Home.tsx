import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Database, FileSpreadsheet, LockKeyhole, RefreshCw, ShieldCheck, UploadCloud } from "lucide-react";
import { api } from "../api/client";
import type { ClassificationJob, ImportResult } from "../types";

export default function Home() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [job, setJob] = useState<ClassificationJob | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
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

  return (
    <div className="upload-gateway">
      <section className="home-hero upload-hero gateway-hero">
        <div className="upload-copy">
          <span className="eyebrow"><ShieldCheck size={15} />Local-first ledger</span>
          <h1>上传账单，自动生成消费看板。</h1>
          <p>选择银行、支付宝或微信导出的 Excel/CSV。系统会在本机完成解析、去重，并用 Ollama LLM 自动分类。</p>
          <div className="home-actions">
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={importing || !!job}>
              {importing ? <RefreshCw className="spin" size={16} /> : <UploadCloud size={16} />}
              {importing ? "导入中..." : "选择账单文件"}
            </button>
            <Link className="btn btn-secondary" to="/dashboard">查看 Dashboard</Link>
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
          <strong>{job ? "正在进行 LLM 分类..." : "拖拽 Excel/CSV 到这里"}</strong>
          <span>上传后会自动进入 Dashboard，不需要手动触发分类</span>
          {result && (
            <div className="upload-result">
              <CheckCircle2 size={16} />
              新增 {result.imported} 条，跳过重复 {result.skipped} 条
            </div>
          )}
          {job && <ProgressBar job={job} progress={progress} />}
          {error && <div className="upload-error">{error}</div>}
        </div>
      </section>

      <section className="home-panel privacy-panel gateway-status">
        <ShieldCheck size={22} />
        <div>
          <strong>{health?.ollama ? "Ollama 已连接" : "等待 Ollama"}</strong>
          <p>{health?.ollama ? `当前使用 ${health.ollama_model_active || health.ollama_model}。交易和 AI 推理都留在本机。` : "请先启动本地 Ollama 服务。"}</p>
        </div>
        <div className="privacy-icons">
          <LockKeyhole size={19} />
          <Database size={19} />
        </div>
      </section>
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
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
    </div>
  );
}
