import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CalendarDays,
  CreditCard,
  FileSpreadsheet,
  Flame,
  RefreshCw,
  Store,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { api } from "../api/client";
import type { ClassificationJob, ImportResult, MonthlySummaryResult, Transaction } from "../types";
import { getClassificationProgress } from "../utils/classificationProgress";

type HeatmapMode = "amount" | "count";

type DayStat = {
  date: string;
  day: number;
  amount: number;
  count: number;
  topCategory: string;
  largest: Transaction | null;
};

type CategoryStat = {
  name: string;
  amount: number;
  count: number;
  sharePct: number;
  countSharePct: number;
  momChangePct: number | null;
};

type EntityStat = {
  name: string;
  mainCategory: string;
  amount: number;
  count: number;
  sharePct: number;
};

type Anomaly = {
  id: string;
  title: string;
  date: string;
  merchant: string;
  platform: string | null;
  amount: number;
  category: string;
  channel: string | null;
  account: string | null;
  reason: string;
};

type HeatmapDay = DayStat | null;

type AnalyticsJson = {
  month: string;
  total_spending: number;
  mom_change_pct: number | null;
  transaction_count: number;
  average_transaction_amount: number;
  daily_average_spending: number;
  category_coverage_count: number;
  anomaly_count: number;
  top_categories: Array<{
    category: string;
    amount: number;
    share_pct: number;
    transaction_count: number;
    mom_change_pct: number | null;
  }>;
  top_merchants: Array<{
    merchant: string;
    amount: number;
    transaction_count: number;
    main_category: string;
  }>;
  top_platforms: Array<{
    platform: string;
    amount: number;
    transaction_count: number;
    main_category: string;
  }>;
  top_payment_channels: Array<{
    payment_channel: string;
    amount: number;
    share_pct: number;
    transaction_count: number;
  }>;
  anomalies: Array<{
    date: string;
    merchant: string;
    amount: number;
    category: string;
    reason: string;
  }>;
  weekday_vs_weekend: {
    weekday_avg: number;
    weekend_avg: number;
    weekend_multiplier: number | null;
  };
};

const CATEGORY_COLORS = ["#1f7aff", "#70b5ff", "#a8d5ff", "#d6ebff", "#7d95b8", "#ffad6f", "#94a3b8"];
const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

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

function monthKey(date: string) {
  return date.slice(0, 7);
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function daysInMonth(month: string) {
  const [year, m] = month.split("-").map(Number);
  return new Date(year, m, 0).getDate();
}

function prevMonthKey(month: string) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonthKey(month: string, offset: number) {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number, maximumFractionDigits = 0) {
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits })}`;
}

function formatPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "暂无";
  return `${value > 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}%`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function categoryOf(txn: Transaction) {
  return txn.category_name || "未分类";
}

function merchantOf(txn: Transaction) {
  return (txn.display_description || txn.raw_description || "未知商户").trim();
}

function spendingOnly(txns: Transaction[]) {
  return txns.filter((txn) => txn.amount > 0);
}

function groupAmountCount<T extends string>(
  txns: Transaction[],
  keyFn: (txn: Transaction) => T | null,
  totalSpend: number,
): EntityStat[] {
  const grouped = new Map<string, { amount: number; count: number; categories: Map<string, number> }>();
  txns.forEach((txn) => {
    const key = keyFn(txn);
    if (!key) return;
    const current = grouped.get(key) || { amount: 0, count: 0, categories: new Map<string, number>() };
    current.amount += txn.amount;
    current.count += 1;
    const category = categoryOf(txn);
    current.categories.set(category, (current.categories.get(category) || 0) + txn.amount);
    grouped.set(key, current);
  });
  return [...grouped.entries()]
    .map(([name, value]) => {
      const mainCategory = [...value.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "未分类";
      return {
        name,
        mainCategory,
        amount: roundMoney(value.amount),
        count: value.count,
        sharePct: totalSpend ? roundMoney((value.amount / totalSpend) * 100) : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stddev(values: number[]) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function getDateMs(date: string) {
  return new Date(`${date}T00:00:00`).getTime();
}

function sundayBasedWeekday(date: string) {
  return new Date(`${date}T00:00:00`).getDay();
}

function formatHeatmapValue(day: DayStat, mode: HeatmapMode) {
  if (mode === "count") return `${day.count} 笔`;
  if (!day.amount) return "0";
  return Math.round(day.amount).toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function fallbackSummary(data: AnalyticsJson) {
  if (!data.total_spending) return "暂无足够消费数据。导入本月账单后，TxnCat 会基于结构化统计生成月度总结。";
  const topCategory = data.top_categories[0];
  const topMerchant = data.top_merchants[0];
  const anomalyText = data.anomaly_count
    ? `本月识别到 ${data.anomaly_count} 个异常信号，建议优先查看异常交易卡片。`
    : "本月没有识别到明显异常交易。";
  return [
    `总体消费情况：本月总消费为 ${formatCurrency(data.total_spending)}，共 ${data.transaction_count} 笔，平均单笔 ${formatCurrency(data.average_transaction_amount)}。${data.mom_change_pct === null ? "" : ` 环比为 ${formatPct(data.mom_change_pct)}。`}`,
    topCategory ? `主要消费类别变化：${topCategory.category} 是本月最高支出类别，占总消费 ${topCategory.share_pct.toFixed(1)}%。` : "主要消费类别变化：暂无分类消费数据。",
    topMerchant ? `商户 / 平台消费习惯：本月消费较集中在 ${topMerchant.merchant}，主要分类为${topMerchant.main_category}。` : "商户 / 平台消费习惯：暂无可用商户数据。",
    `异常交易提醒：${anomalyText}`,
    "下月建议：优先关注高占比类别和异常交易日，避免让集中消费变成无感支出。",
  ].join("\n\n");
}

export default function Dashboard() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [job, setJob] = useState<ClassificationJob | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [monthlyTrendMode, setMonthlyTrendMode] = useState<HeatmapMode>("amount");
  const [categoryMode, setCategoryMode] = useState<HeatmapMode>("amount");
  const [channelMode, setChannelMode] = useState<HeatmapMode>("amount");
  const [llmSummary, setLlmSummary] = useState("");
  const [llmStatus, setLlmStatus] = useState<"idle" | "loading" | "ready" | "fallback">("idle");

  const refreshTransactions = useCallback(async () => {
    setTxns(await fetchAllTransactions());
  }, []);

  useEffect(() => {
    let active = true;
    fetchAllTransactions()
      .then((items) => {
        if (active) setTxns(items);
      })
      .catch(() => {
        if (active) setTxns([]);
      });
    return () => {
      active = false;
    };
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
  }, [job, refreshTransactions]);

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

  const availableMonths = useMemo(() => {
    const grouped = new Map<string, { month: string; amount: number; count: number }>();
    spendingOnly(txns).forEach((txn) => {
      const month = monthKey(txn.date);
      const current = grouped.get(month) || { month, amount: 0, count: 0 };
      current.amount += txn.amount;
      current.count += 1;
      grouped.set(month, current);
    });
    return [...grouped.values()]
      .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
      .sort((a, b) => b.month.localeCompare(a.month));
  }, [txns]);

  const latestMonth = availableMonths[0]?.month || currentMonthKey();
  const activeMonth = selectedMonth && availableMonths.some((item) => item.month === selectedMonth)
    ? selectedMonth
    : latestMonth;

  const analytics = useMemo(() => {
    const currentTxns = spendingOnly(txns).filter((txn) => monthKey(txn.date) === activeMonth);
    const previousMonth = prevMonthKey(activeMonth);
    const previousTxns = spendingOnly(txns).filter((txn) => monthKey(txn.date) === previousMonth);
    const totalSpend = currentTxns.reduce((sum, txn) => sum + txn.amount, 0);
    const previousSpend = previousTxns.reduce((sum, txn) => sum + txn.amount, 0);
    const totalCount = currentTxns.length;
    const monthDays = daysInMonth(activeMonth);
    const dailyAverage = monthDays ? totalSpend / monthDays : 0;
    const avgTransaction = currentTxns.length ? totalSpend / currentTxns.length : 0;
    const momChangePct = previousSpend > 0 ? ((totalSpend - previousSpend) / previousSpend) * 100 : null;

    const dayMap = new Map<string, DayStat>();
    for (let day = 1; day <= monthDays; day += 1) {
      const date = `${activeMonth}-${String(day).padStart(2, "0")}`;
      dayMap.set(date, { date, day, amount: 0, count: 0, topCategory: "无消费", largest: null });
    }
    currentTxns.forEach((txn) => {
      const stat = dayMap.get(txn.date);
      if (!stat) return;
      stat.amount += txn.amount;
      stat.count += 1;
      if (!stat.largest || txn.amount > stat.largest.amount) stat.largest = txn;
    });
    dayMap.forEach((stat) => {
      const sameDay = currentTxns.filter((txn) => txn.date === stat.date);
      const categoryTotals = new Map<string, number>();
      sameDay.forEach((txn) => categoryTotals.set(categoryOf(txn), (categoryTotals.get(categoryOf(txn)) || 0) + txn.amount));
      stat.topCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "无消费";
      stat.amount = roundMoney(stat.amount);
    });
    const dailyStats = [...dayMap.values()];
    const maxDayAmount = Math.max(0, ...dailyStats.map((day) => day.amount));
    const maxDayCount = Math.max(0, ...dailyStats.map((day) => day.count));
    const firstWeekday = sundayBasedWeekday(`${activeMonth}-01`);
    const heatmapDays: HeatmapDay[] = [
      ...Array.from({ length: firstWeekday }, () => null),
      ...dailyStats,
    ];

    const trend = dailyStats.map((day, index) => {
      const prevWindow = dailyStats.slice(Math.max(0, index - 6), index + 1);
      const weekday = sundayBasedWeekday(day.date);
      return {
        date: `${day.day}日`,
        fullDate: day.date,
        amount: day.amount,
        isMonday: weekday === 1,
        movingAverage: index >= 6 ? roundMoney(mean(prevWindow.map((item) => item.amount))) : null,
      };
    });

    const prevByDay = new Map<number, number>();
    previousTxns.forEach((txn) => {
      const day = Number(txn.date.slice(8, 10));
      prevByDay.set(day, (prevByDay.get(day) || 0) + txn.amount);
    });
    const hasPreviousDaily = prevByDay.size > 0;
    const trendWithPrevious = trend.map((day, index) => ({
      ...day,
      previousAmount: hasPreviousDaily ? roundMoney(prevByDay.get(index + 1) || 0) : null,
    }));

    const previousCategoryTotals = new Map<string, number>();
    previousTxns.forEach((txn) => {
      const category = categoryOf(txn);
      previousCategoryTotals.set(category, (previousCategoryTotals.get(category) || 0) + txn.amount);
    });

    const categoryTotals = new Map<string, { amount: number; count: number }>();
    currentTxns.forEach((txn) => {
      const category = categoryOf(txn);
      const current = categoryTotals.get(category) || { amount: 0, count: 0 };
      current.amount += txn.amount;
      current.count += 1;
      categoryTotals.set(category, current);
    });
    const categories: CategoryStat[] = [...categoryTotals.entries()]
      .map(([name, value]) => {
        const previous = previousCategoryTotals.get(name) || 0;
        return {
          name,
          amount: roundMoney(value.amount),
          count: value.count,
          sharePct: totalSpend ? roundMoney((value.amount / totalSpend) * 100) : 0,
          countSharePct: totalCount ? roundMoney((value.count / totalCount) * 100) : 0,
          momChangePct: previous > 0 ? roundMoney(((value.amount - previous) / previous) * 100) : null,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const topCategories = categories.slice(0, 6);
    const otherCategory = categories.slice(6).reduce(
      (acc, item) => ({
        name: "其他",
        amount: acc.amount + item.amount,
        count: acc.count + item.count,
        sharePct: acc.sharePct + item.sharePct,
        countSharePct: acc.countSharePct + item.countSharePct,
        momChangePct: null,
      }),
      { name: "其他", amount: 0, count: 0, sharePct: 0, countSharePct: 0, momChangePct: null } as CategoryStat,
    );
    const categoryPie = (otherCategory.amount > 0 ? [...topCategories, otherCategory] : topCategories).map((item, index) => ({
      ...item,
      color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
    }));
    const categoryCoverageCount = categories.filter((item) => item.name !== "未分类").length;

    const merchants = groupAmountCount(currentTxns, (txn) => merchantOf(txn), totalSpend);
    const platforms = groupAmountCount(currentTxns, (txn) => txn.merchant_platform?.trim() || null, totalSpend);
    const channels = groupAmountCount(currentTxns, (txn) => txn.payment_channel?.trim() || null, totalSpend);
    const accounts = groupAmountCount(currentTxns, (txn) => txn.account_name?.trim() || null, totalSpend);

    const monthStartMs = getDateMs(`${activeMonth}-01`);
    const monthEndMs = getDateMs(`${activeMonth}-${String(monthDays).padStart(2, "0")}`);
    const recent90 = spendingOnly(txns).filter((txn) => {
      const ms = getDateMs(txn.date);
      return ms <= monthEndMs && ms >= monthStartMs - 90 * 24 * 60 * 60 * 1000;
    });
    const p95 = recent90.length >= 10 ? percentile(recent90.map((txn) => txn.amount), 95) : null;
    const categorySamples = new Map<string, number[]>();
    recent90.forEach((txn) => {
      const category = categoryOf(txn);
      const samples = categorySamples.get(category) || [];
      samples.push(txn.amount);
      categorySamples.set(category, samples);
    });
    const anomalyMap = new Map<string, Anomaly>();
    currentTxns.forEach((txn) => {
      const reasons: string[] = [];
      if (p95 !== null && txn.amount > p95) reasons.push(`超过近 90 天单笔消费 P95（${formatCurrency(p95)}）`);
      const samples = categorySamples.get(categoryOf(txn)) || [];
      if (samples.length >= 5) {
        const avg = mean(samples);
        const sd = stddev(samples);
        if (sd > 0 && txn.amount > avg + 3 * sd) reasons.push(`高于${categoryOf(txn)}类近 90 天均值 3 倍标准差`);
      }
      if (reasons.length) {
        anomalyMap.set(`txn-${txn.id}`, {
          id: `txn-${txn.id}`,
          title: "异常大额交易",
          date: txn.date,
          merchant: merchantOf(txn),
          platform: txn.merchant_platform,
          amount: txn.amount,
          category: categoryOf(txn),
          channel: txn.payment_channel,
          account: txn.account_name,
          reason: reasons.join("，并且"),
        });
      }
    });

    const recent30DailyAverage = dailyStats.length >= 10 ? mean(dailyStats.map((day) => day.amount).filter((amount) => amount > 0)) : 0;
    if (recent30DailyAverage > 0) {
      dailyStats.forEach((day) => {
        if (day.amount > recent30DailyAverage * 3) {
          anomalyMap.set(`day-${day.date}`, {
            id: `day-${day.date}`,
            title: "单日集中消费",
            date: day.date,
            merchant: day.largest ? merchantOf(day.largest) : "多笔交易",
            platform: day.largest?.merchant_platform || null,
            amount: day.amount,
            category: day.topCategory,
            channel: day.largest?.payment_channel || null,
            account: day.largest?.account_name || null,
            reason: `当日总消费高于本月有消费日期均值的 3 倍（均值 ${formatCurrency(recent30DailyAverage)}）`,
          });
        }
      });
    }

    categories.forEach((category) => {
      if (category.momChangePct !== null && category.momChangePct > 50) {
        anomalyMap.set(`cat-${category.name}`, {
          id: `cat-${category.name}`,
          title: "分类支出快速增长",
          date: `${activeMonth}`,
          merchant: category.name,
          platform: null,
          amount: category.amount,
          category: category.name,
          channel: null,
          account: null,
          reason: `${category.name}本月环比增长 ${formatPct(category.momChangePct)}，超过 50%`,
        });
      }
    });

    const byMerchantDate = new Map<string, Transaction[]>();
    currentTxns.forEach((txn) => {
      const key = `${merchantOf(txn)}-${txn.date}`;
      const rows = byMerchantDate.get(key) || [];
      rows.push(txn);
      byMerchantDate.set(key, rows);
    });
    byMerchantDate.forEach((rows) => {
      if (rows.length < 2) return;
      const closeAmounts = rows.filter((txn) => rows.some((other) => other.id !== txn.id && Math.abs(other.amount - txn.amount) <= Math.max(1, txn.amount * 0.02)));
      if (closeAmounts.length >= 2) {
        const txn = closeAmounts[0];
        anomalyMap.set(`dup-${merchantOf(txn)}-${txn.date}`, {
          id: `dup-${merchantOf(txn)}-${txn.date}`,
          title: "疑似重复扣款",
          date: txn.date,
          merchant: merchantOf(txn),
          platform: txn.merchant_platform,
          amount: roundMoney(closeAmounts.reduce((sum, item) => sum + item.amount, 0)),
          category: categoryOf(txn),
          channel: txn.payment_channel,
          account: txn.account_name,
          reason: `同一商户当天出现 ${closeAmounts.length} 笔金额相近交易`,
        });
      }
    });
    const anomalies = [...anomalyMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 8);

    const weekdayAmounts: number[] = [];
    const weekendAmounts: number[] = [];
    dailyStats.forEach((day) => {
      const weekday = new Date(`${day.date}T00:00:00`).getDay();
      if (weekday === 0 || weekday === 6) weekendAmounts.push(day.amount);
      else weekdayAmounts.push(day.amount);
    });
    const weekdayAvg = mean(weekdayAmounts);
    const weekendAvg = mean(weekendAmounts);

    const structuredJson: AnalyticsJson = {
      month: activeMonth,
      total_spending: roundMoney(totalSpend),
      mom_change_pct: momChangePct === null ? null : roundMoney(momChangePct),
      transaction_count: currentTxns.length,
      average_transaction_amount: roundMoney(avgTransaction),
      daily_average_spending: roundMoney(dailyAverage),
      category_coverage_count: categoryCoverageCount,
      anomaly_count: anomalies.length,
      top_categories: categories.slice(0, 5).map((item) => ({
        category: item.name,
        amount: item.amount,
        share_pct: item.sharePct,
        transaction_count: item.count,
        mom_change_pct: item.momChangePct,
      })),
      top_merchants: merchants.slice(0, 3).map((item) => ({
        merchant: item.name,
        amount: item.amount,
        transaction_count: item.count,
        main_category: item.mainCategory,
      })),
      top_platforms: platforms.slice(0, 3).map((item) => ({
        platform: item.name,
        amount: item.amount,
        transaction_count: item.count,
        main_category: item.mainCategory,
      })),
      top_payment_channels: channels.slice(0, 5).map((item) => ({
        payment_channel: item.name,
        amount: item.amount,
        share_pct: item.sharePct,
        transaction_count: item.count,
      })),
      anomalies: anomalies.slice(0, 5).map((item) => ({
        date: item.date,
        merchant: item.merchant,
        amount: item.amount,
        category: item.category,
        reason: item.reason,
      })),
      weekday_vs_weekend: {
        weekday_avg: roundMoney(weekdayAvg),
        weekend_avg: roundMoney(weekendAvg),
        weekend_multiplier: weekdayAvg > 0 ? roundMoney(weekendAvg / weekdayAvg) : null,
      },
    };

    return {
      activeMonth,
      currentTxns,
      totalSpend: roundMoney(totalSpend),
      dailyAverage: roundMoney(dailyAverage),
      avgTransaction: roundMoney(avgTransaction),
      momChangePct,
      dailyStats,
      heatmapDays,
      maxDayAmount,
      maxDayCount,
      trend: trendWithPrevious,
      hasPreviousDaily,
      categories,
      categoryCoverageCount,
      categoryPie,
      merchants,
      platforms,
      channels,
      accounts,
      anomalies,
      structuredJson,
    };
  }, [activeMonth, txns]);

  const fallbackLlmSummary = useMemo(() => fallbackSummary(analytics.structuredJson), [analytics.structuredJson]);

  useEffect(() => {
    if (!analytics.structuredJson.total_spending) return;
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      setLlmStatus("loading");
      setLlmSummary("");
    });
    api.monthlySummary(analytics.structuredJson)
      .then((result: MonthlySummaryResult) => {
        if (!active) return;
        setLlmSummary(result.summary || "");
        setLlmStatus(result.source === "llm" ? "ready" : "fallback");
      })
      .catch(() => {
        if (!active) return;
        setLlmSummary("");
        setLlmStatus("fallback");
      });
    return () => {
      active = false;
    };
  }, [analytics.structuredJson]);

  const progress = job ? getClassificationProgress(job) : null;
  const hasSpendData = analytics.currentTxns.length > 0;
  const uncategorized = txns.filter((txn) => txn.amount > 0 && !txn.category_name).length;
  const topCategory = analytics.categories[0];
  const displayedLlmStatus = analytics.structuredJson.total_spending ? llmStatus : "fallback";
  const displayedLlmSummary = llmSummary || fallbackLlmSummary;
  const categoryRows = useMemo(() => {
    return [...analytics.categories].sort((a, b) => categoryMode === "amount" ? b.amount - a.amount : b.count - a.count);
  }, [analytics.categories, categoryMode]);
  const categoryPieRows = useMemo(() => {
    const topRows = categoryRows.slice(0, 6);
    const otherRows = categoryRows.slice(6);
    const rows = otherRows.length
      ? [
          ...topRows,
          otherRows.reduce(
            (acc, item) => ({
              name: "其他",
              amount: acc.amount + item.amount,
              count: acc.count + item.count,
              sharePct: acc.sharePct + item.sharePct,
              countSharePct: acc.countSharePct + item.countSharePct,
              momChangePct: null,
            }),
            { name: "其他", amount: 0, count: 0, sharePct: 0, countSharePct: 0, momChangePct: null } as CategoryStat,
          ),
        ]
      : topRows;
    return rows.map((item, index) => ({ ...item, color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }));
  }, [categoryRows]);
  const channelChartRows = useMemo(() => {
    return [...analytics.channels]
      .sort((a, b) => channelMode === "amount" ? b.amount - a.amount : b.count - a.count)
      .slice(0, 6);
  }, [analytics.channels, channelMode]);
  const channelChartHeight = channelChartRows.length <= 1
    ? 54
    : channelChartRows.length === 2
      ? 86
      : Math.max(132, channelChartRows.length * 40);
  const channelBarSize = channelChartRows.length <= 2 ? 24 : 28;
  const monthlyTrend = useMemo(() => {
    const byMonth = new Map(availableMonths.map((item) => [item.month, item]));
    return Array.from({ length: 6 }, (_, index) => {
      const month = shiftMonthKey(analytics.activeMonth, index - 5);
      const existing = byMonth.get(month);
      return {
        month,
        amount: existing?.amount || 0,
        count: existing?.count || 0,
        label: `${Number(month.slice(5, 7))}月`,
      };
    });
  }, [analytics.activeMonth, availableMonths]);

  return (
    <div className="spending-dashboard">
      <header className="dashboard-report-hero">
        <div className="report-hero-copy">
          <span className="eyebrow"><CalendarDays size={15} /> {analytics.activeMonth}</span>
          <h1>月度消费报告</h1>
          <p>把本月账单整理成一张可读的消费报告：先看总结，再看趋势、分类和异常。</p>
          <div className="report-hero-stats">
            <span>当前采用日粒度趋势</span>
            <span>{analytics.currentTxns.length} 笔支出</span>
            <span>{analytics.categoryCoverageCount} 个分类</span>
          </div>
        </div>
        <div className="dashboard-actions">
          <label className="month-switcher">
            <span>分析月份</span>
            <select
              value={analytics.activeMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              disabled={!availableMonths.length}
            >
              {availableMonths.length ? (
                availableMonths.map((item) => (
                  <option key={item.month} value={item.month}>
                    {item.month} · {formatCurrency(item.amount)} · {item.count} 笔
                  </option>
                ))
              ) : (
                <option value={analytics.activeMonth}>{analytics.activeMonth} · 暂无支出</option>
              )}
            </select>
          </label>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => handleImport(event.target.files?.[0])} />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing || categorizing}>
            {importing ? <RefreshCw className="spin" size={16} /> : <UploadCloud size={16} />}
            上传账单
          </button>
          <button className="btn btn-primary" onClick={handleCategorizeAll} disabled={!uncategorized || categorizing}>
            {categorizing ? <RefreshCw className="spin" size={16} /> : <WandSparkles size={16} />}
            {categorizing ? "分类中" : "补全分类"}
          </button>
        </div>
        <div className="report-hero-art" aria-hidden="true">
          <div className="report-sun" />
          <div className="report-card-illustration">
            <span />
            <strong>{formatCurrency(analytics.totalSpend)}</strong>
            <em>{analytics.momChangePct === null ? "暂无上月对比" : `环比 ${formatPct(analytics.momChangePct)}`}</em>
          </div>
          <div className="report-coin one" />
          <div className="report-coin two" />
        </div>
      </header>

      {job && progress && <ProgressBar job={job} progress={progress} />}
      {notice && <div className="upload-result">{notice}</div>}
      {error && <div className="upload-error">{error}</div>}

      <section className="dashboard-section dashboard-priority-grid">
        <div className="monthly-report-card">
          <div className="monthly-report-top">
            <div>
              <span>{analytics.activeMonth}</span>
              <strong>消费总览</strong>
            </div>
            <div className="report-mode-pill">日</div>
          </div>
          <div className="monthly-report-main">
            <Metric label="本月总消费" value={formatCurrency(analytics.totalSpend)} detail={`${analytics.currentTxns.length} 笔支出交易`} tone="blue" />
            <Metric label="环比变化" value={analytics.momChangePct === null ? "暂无上月" : formatPct(analytics.momChangePct)} detail={analytics.momChangePct === null ? "上月数据不足" : "相对上月消费"} tone={analytics.momChangePct !== null && analytics.momChangePct > 0 ? "rose" : "green"} muted={analytics.momChangePct === null} />
            <Metric label="异常交易" value={`${analytics.anomalies.length} 笔`} detail="基于规则检测" tone={analytics.anomalies.length ? "rose" : "green"} />
          </div>
          <div className="report-mini-grid">
            <Metric label="日均消费" value={formatCurrency(analytics.dailyAverage)} detail={`按 ${daysInMonth(analytics.activeMonth)} 天计算`} tone="green" />
            <Metric label="平均单笔" value={formatCurrency(analytics.avgTransaction)} detail="本月支出均值" tone="orange" />
            <Metric label="覆盖分类" value={`${analytics.categoryCoverageCount} 类`} detail={topCategory ? `最高：${topCategory.name}` : "不含未分类"} tone="plum" />
          </div>
        </div>

        <div className="home-panel ai-summary-panel report-summary-panel">
          <div className="panel-title">
            <div><strong>AI 月度总结</strong><span>{displayedLlmStatus === "ready" ? "本地 LLM 生成" : displayedLlmStatus === "loading" ? "正在请求本地 LLM" : "结构化规则兜底"}</span></div>
            <Brain size={19} />
          </div>
          <div className="summary-copy">{displayedLlmSummary}</div>
        </div>
      </section>

      <section className="dashboard-section">
        <SectionTitle
          title="消费趋势"
          subtitle="左侧看最近几个月变化，右侧看本月每天分布。"
          action={<MetricToggle value={monthlyTrendMode} onChange={setMonthlyTrendMode} />}
        />
        <div className="dashboard-two-col trend-layout">
          <div className="home-panel report-chart-panel monthly-trend-panel">
            <div className="panel-title">
              <div>
                <strong>{monthlyTrendMode === "amount" ? "月度消费金额趋势" : "月度消费笔数趋势"}</strong>
                <span>最近 6 个月，缺失月份按 0 计算</span>
              </div>
            </div>
            {monthlyTrend.length ? (
              <ResponsiveContainer width="100%" height={274}>
                <BarChart data={monthlyTrend}>
                  <CartesianGrid stroke="#e5edf6" strokeDasharray="3 5" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Bar
                    dataKey={monthlyTrendMode}
                    name={monthlyTrendMode === "amount" ? "月支出金额" : "月支出笔数"}
                    radius={[14, 14, 14, 14]}
                    fill="#8fc5ff"
                    barSize={52}
                    activeBar={{ fill: "#76b8ff", stroke: "#4d96eb", strokeWidth: 1 }}
                  >
                    <LabelList
                      dataKey={monthlyTrendMode}
                      position="top"
                      formatter={(value) => {
                        const metric = Number(value || 0);
                        if (monthlyTrendMode === "count") return `${metric}笔`;
                        return metric > 0 ? `¥${Math.round(metric).toLocaleString("zh-CN")}` : "¥0";
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState text="暂无月度消费趋势数据" />
            )}
          </div>

          <div className="home-panel report-chart-panel heatmap-panel">
            <div className="panel-title">
              <div><strong>本月消费热力图</strong><span>按自然周排列，顶部区分星期</span></div>
            </div>
            {hasSpendData ? (
              <div className="month-heatmap-shell">
                <div className="month-heatmap-header">
                  <div>
                    <strong>{Number(analytics.activeMonth.slice(5, 7))}月</strong>
                    <span>{analytics.activeMonth.slice(0, 4)}</span>
                  </div>
                  <em>{monthlyTrendMode === "amount" ? "每日支出金额" : "每日支出笔数"}</em>
                </div>
                <div className="weekday-row">
                  {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
                </div>
                <div className="spend-heatmap">
                  {analytics.heatmapDays.map((day, index) => {
                    if (!day) return <div className="heat-cell empty" key={`empty-${index}`} />;
                    const ratio = monthlyTrendMode === "amount"
                      ? (analytics.maxDayAmount ? day.amount / analytics.maxDayAmount : 0)
                      : (analytics.maxDayCount ? day.count / analytics.maxDayCount : 0);
                    const level = day.count === 0 ? 0 : Math.max(1, Math.ceil(ratio * 4));
                    return (
                      <div
                        className={`heat-cell level-${level}`}
                        key={day.date}
                      >
                        <strong>{day.day}</strong>
                        <span>{formatHeatmapValue(day, monthlyTrendMode)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState text="暂无本月消费热力数据" />
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <SectionTitle
          title="分类消费结构"
          subtitle="了解钱主要花在哪些类别，以及哪些类别增长最快。"
          action={<MetricToggle value={categoryMode} onChange={setCategoryMode} />}
        />
        <div className="dashboard-two-col category-layout-grid">
          <div className="home-panel report-chart-panel category-donut-panel">
            <div className="panel-title">
              <div><strong>{categoryMode === "amount" ? "分类金额占比" : "分类笔数占比"}</strong><span>Top 分类合并展示</span></div>
            </div>
            {categoryPieRows.length ? (
              <div className="donut-layout">
                <ResponsiveContainer width="42%" height={244}>
                  <PieChart>
                    <Pie data={categoryPieRows} dataKey={categoryMode} nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3}>
                      {categoryPieRows.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  {categoryPieRows.map((item) => (
                    <div key={item.name}>
                      <span style={{ background: item.color }} />
                      <strong>{item.name}</strong>
                      <em>{(categoryMode === "amount" ? item.sharePct : item.countSharePct).toFixed(1)}%</em>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState text="暂无分类占比数据" />
            )}
          </div>

          <div className="home-panel report-chart-panel category-rank-panel">
            <div className="panel-title">
              <div>
                <strong>{categoryMode === "amount" ? "分类金额排名" : "分类笔数排名"}</strong>
                <span>{categoryMode === "amount" ? "金额、占比和环比" : "笔数、占比和环比"}</span>
              </div>
            </div>
            {categoryRows.length ? (
              <div className="rank-list">
                {categoryRows.slice(0, 8).map((item) => (
                  <div className="rank-row" key={item.name}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{formatCurrency(item.amount)} · {item.count} 笔</span>
                    </div>
                    <div className="rank-bar"><span style={{ width: `${Math.min(100, categoryMode === "amount" ? item.sharePct : item.countSharePct)}%` }} /></div>
                    <div className="rank-value">
                      <strong>{categoryMode === "amount" ? formatCurrency(item.amount) : `${item.count} 笔`}</strong>
                      <span>{(categoryMode === "amount" ? item.sharePct : item.countSharePct).toFixed(1)}%</span>
                      <span className={item.momChangePct === null ? "" : item.momChangePct >= 0 ? "up" : "down"}>
                        {item.momChangePct === null ? "无环比" : formatPct(item.momChangePct)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无分类排名数据" />
            )}
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <SectionTitle title="商户 / 平台偏好" subtitle="我最常在哪些商户或平台花钱？" />
        <div className="preference-grid">
          <TopList title="Top 3 商户消费金额榜" icon={<Store size={17} />} rows={analytics.merchants.slice(0, 3)} mode="amount" />
          <TopList title="Top 3 商户消费笔数榜" icon={<Store size={17} />} rows={[...analytics.merchants].sort((a, b) => b.count - a.count).slice(0, 3)} mode="count" />
          {analytics.platforms.length > 0 && <TopList title="Top 3 平台消费金额榜" icon={<Flame size={17} />} rows={analytics.platforms.slice(0, 3)} mode="amount" />}
          {analytics.platforms.length > 0 && <TopList title="Top 3 平台消费笔数榜" icon={<Flame size={17} />} rows={[...analytics.platforms].sort((a, b) => b.count - a.count).slice(0, 3)} mode="count" />}
        </div>
      </section>

      {(analytics.channels.length > 0 || analytics.accounts.length > 0) && (
        <section className="dashboard-section">
          <SectionTitle
            title="支付渠道 / 账户偏好"
            subtitle="我习惯用哪些支付方式和账户？它们分别用于什么消费场景？"
            action={analytics.channels.length > 0 ? <MetricToggle value={channelMode} onChange={setChannelMode} /> : undefined}
          />
          <div className="dashboard-two-col preference-detail-grid">
            {analytics.channels.length > 0 && (
              <div className="home-panel report-chart-panel channel-chart-card">
                <div className="panel-title">
                  <div><strong>{channelMode === "amount" ? "支付渠道金额分布" : "支付渠道笔数分布"}</strong><span>{channelMode === "amount" ? "按金额展示" : "按交易笔数展示"}</span></div>
                </div>
                <ResponsiveContainer width="100%" height={channelChartHeight}>
                  <BarChart data={channelChartRows} layout="vertical" barCategoryGap="24%" margin={{ right: 72 }}>
                    <CartesianGrid stroke="#edf2f7" horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={82} tickLine={false} axisLine={false} />
                    <Bar dataKey={channelMode} fill="#8fc5ff" radius={[0, 8, 8, 0]} barSize={channelBarSize} activeBar={false}>
                      <LabelList
                        dataKey={channelMode}
                        position="right"
                        formatter={(value) => {
                          const metric = Number(value || 0);
                          return channelMode === "amount" ? `¥${Math.round(metric).toLocaleString("zh-CN")}` : `${metric}笔`;
                        }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {analytics.accounts.length > 0 && (
              <div className="home-panel report-chart-panel">
                <div className="panel-title"><div><strong>账户使用偏好</strong><span>账户 × 主要分类</span></div></div>
                <div className="account-list">
                  {analytics.accounts.slice(0, 6).map((item) => (
                    <div key={item.name}>
                      <CreditCard size={16} />
                      <strong>{item.name}</strong>
                      <span>{item.mainCategory}</span>
                      <em>{formatCurrency(item.amount)} · {item.count} 笔</em>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="dashboard-section">
        <SectionTitle title="异常交易" subtitle="哪些交易或消费模式看起来不太正常？" />
        {analytics.anomalies.length ? (
          <div className="anomaly-grid">
            {analytics.anomalies.map((item) => (
              <article className="anomaly-card" key={item.id}>
                <div className="anomaly-card-top">
                  <span><AlertTriangle size={15} /> {item.title}</span>
                  <strong>{formatCurrency(item.amount)}</strong>
                </div>
                <h3>{item.merchant}</h3>
                <p>{item.date} · {item.category}{item.channel ? ` · ${item.channel}` : ""}{item.account ? ` · ${item.account}` : ""}</p>
                <div>原因：{item.reason}</div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState text="本月暂未发现明显异常交易" />
        )}
      </section>

      <div className="dashboard-footer-actions">
        <Link className="wide-action" to="/transactions"><FileSpreadsheet size={16} />查看交易明细 <ArrowRight size={16} /></Link>
        <Link className="wide-action secondary" to="/query">继续用智能问答追问 <ArrowRight size={16} /></Link>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function MetricToggle({ value, onChange }: { value: HeatmapMode; onChange: (value: HeatmapMode) => void }) {
  return (
    <div className="segmented-control section-metric-toggle">
      <button className={value === "amount" ? "active" : ""} onClick={() => onChange("amount")}>金额</button>
      <button className={value === "count" ? "active" : ""} onClick={() => onChange("count")}>笔数</button>
    </div>
  );
}

function Metric({ label, value, detail, tone, muted }: { label: string; value: string; detail: string; tone: string; muted?: boolean }) {
  return (
    <div className={`overview-card tone-${tone} ${muted ? "muted" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-chart-state">{text}</div>;
}

function TopList({ title, rows, mode, icon }: { title: string; rows: EntityStat[]; mode: "amount" | "count"; icon: ReactNode }) {
  return (
    <div className="home-panel report-chart-panel top-list-panel">
      <div className="panel-title"><div><strong>{title}</strong><span>名称、主要分类、金额、笔数、占比</span></div>{icon}</div>
      {rows.length ? (
        <div className="entity-list">
          {rows.map((row) => (
            <div key={row.name}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.mainCategory}</span>
              </div>
              <em>{mode === "amount" ? formatCurrency(row.amount) : `${row.count} 笔`}</em>
              <small>{formatCurrency(row.amount)} · {row.count} 笔 · {row.sharePct.toFixed(1)}%</small>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="暂无可用数据" />
      )}
    </div>
  );
}

function ProgressBar({ job, progress }: { job: ClassificationJob; progress: ReturnType<typeof getClassificationProgress> }) {
  return (
    <div className="classification-progress">
      <div>
        <strong>{job.message}</strong>
        <span>{progress.processed}/{progress.total} · 成功 {progress.categorized} · 失败 {progress.failed}</span>
      </div>
      <div className={`progress-track ${progress.isActive ? "active" : ""}`}>
        <span style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}
