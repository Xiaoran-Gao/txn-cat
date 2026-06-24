import type {
  AnomalyItem,
  Category,
  ClassificationJob,
  CreditCard,
  CreditCardInput,
  CreditCardReminder,
  ImportResult,
  MonthlySummaryResult,
  NLQueryResult,
  SummaryData,
  Transaction,
  TransactionUpdateInput,
  TrendItem,
} from "../types";

const BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
type QueryParams = Record<string, string | number | boolean | null | undefined>;

async function readErrorMessage(res: Response): Promise<string> {
  const msg = await res.text();
  if (!msg) return `HTTP ${res.status}`;
  try {
    const data = JSON.parse(msg) as { detail?: string };
    return data.detail || msg;
  } catch {
    return msg;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("无法连接本地后端，请先启动 FastAPI 服务。");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res.json();
}

async function upload<T>(path: string, body: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: "POST", body });
  } catch {
    throw new Error("无法连接本地后端，请先启动 FastAPI 服务。");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res.json();
}

export const api = {
  // Transactions
  importFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<ImportResult>("/transactions/import", form);
  },
  createTransaction: (data: { date: string; description: string; product_info?: string | null; amount: number; account_name?: string | null; payment_channel?: string | null; merchant_platform?: string | null }) =>
    request<{ id: number; display_description: string }>("/transactions", { method: "POST", body: JSON.stringify(data) }),
  listTransactions: (params: QueryParams) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)); });
    return request<{ items: Transaction[]; total: number; page: number; per_page: number }>(`/transactions?${qs}`);
  },
  transactionFilterOptions: (params: QueryParams) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") qs.set(k, String(v)); });
    return request<{ accounts: string[]; payment_channels: string[]; merchant_platforms: string[] }>(`/transactions/filter-options?${qs}`);
  },
  getTransaction: (id: number) => request<Transaction>(`/transactions/${id}`),
  updateTransaction: (id: number, data: TransactionUpdateInput) =>
    request<{ status: string }>(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTransaction: (id: number) => request<{ status: string }>(`/transactions/${id}`, { method: "DELETE" }),
  bulkUpdate: (data: { ids: number[]; category_id?: number | null; subcategory_id?: number | null }) =>
    request<{ status: string }>("/transactions/bulk-update", { method: "POST", body: JSON.stringify(data) }),
  bulkDelete: (ids: number[]) =>
    request<{ status: string }>("/transactions/bulk-delete", { method: "DELETE", body: JSON.stringify({ ids }) }),
  categorizeAll: () => request<{ total: number; categorized: number; failed: number; job_id: string | null }>("/transactions/categorize", { method: "POST" }),
  categorizeOne: (id: number) => request<{ status: string }>(`/transactions/${id}/categorize`, { method: "POST" }),
  categorizeJob: (id: string) => request<ClassificationJob>(`/transactions/categorize/jobs/${id}`),

  // Categories
  listCategories: () => request<Category[]>("/categories"),
  createCategory: (data: { name: string; parent_id?: number }) =>
    request<{ id: number }>("/categories", { method: "POST", body: JSON.stringify(data) }),
  updateCategory: (id: number, data: { name: string }) =>
    request<{ status: string }>(`/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCategory: (id: number, reassignTo?: number) =>
    request<{ status: string }>(`/categories/${id}?${reassignTo ? `reassign_to=${reassignTo}` : ""}`, { method: "DELETE" }),

  // Credit cards
  listCreditCards: () => request<CreditCard[]>("/credit-cards"),
  createCreditCard: (data: CreditCardInput) =>
    request<CreditCard>("/credit-cards", { method: "POST", body: JSON.stringify(data) }),
  updateCreditCard: (id: number, data: Partial<CreditCardInput>) =>
    request<CreditCard>(`/credit-cards/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCreditCard: (id: number) => request<{ status: string }>(`/credit-cards/${id}`, { method: "DELETE" }),
  creditCardReminders: (asOf?: string) =>
    request<CreditCardReminder[]>(`/credit-cards/reminders${asOf ? `?as_of=${asOf}` : ""}`),
  creditCardAccountOptions: () =>
    request<{ accounts: string[]; used_accounts: string[]; available_accounts: string[] }>("/credit-cards/account-options"),
  markCreditCardStatement: (id: number, data: { statement_date: string; marked_paid?: boolean; note?: string | null }) =>
    request<{ status: string }>(`/credit-cards/${id}/statement-marks`, { method: "POST", body: JSON.stringify(data) }),

  // Analysis
  summary: (month: string) => request<SummaryData>(`/analysis/summary?month=${month}`),
  trends: (months = 12) => request<TrendItem[]>(`/analysis/trends?months=${months}`),
  anomalies: (month: string) => request<AnomalyItem[]>(`/analysis/anomalies?month=${month}`),
  monthlySpend: (months = 12) => request<{ categories: string[]; data: Record<string, string | number>[] }>(`/analysis/monthly-spend?months=${months}`),
  monthlySummary: (analytics: Record<string, unknown>) =>
    request<MonthlySummaryResult>("/analysis/monthly-summary", { method: "POST", body: JSON.stringify({ analytics }) }),

  // NL Query
  query: (question: string) =>
    request<NLQueryResult>("/query", { method: "POST", body: JSON.stringify({ question }) }),

  // System
  health: () => request<{
    database: boolean;
    ollama: boolean;
    ollama_model: string;
    ollama_model_active: string | null;
    ollama_error: string | null;
    version: string;
    storage: {
      kind: string;
      bytes: number;
      files: { path: string; bytes: number }[];
    };
  }>("/system/health"),
  models: () => request<{ models: string[]; active_model?: string | null; error?: string }>("/system/models"),
};
