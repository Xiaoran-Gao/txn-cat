export interface Transaction {
  id: number;
  date: string;
  raw_description: string;
  display_description: string;
  display_description_source: string | null;
  raw_product_info: string | null;
  display_product_info: string | null;
  amount: number;
  currency: string;
  account_name: string | null;
  payment_channel: string | null;
  merchant_platform: string | null;
  category_id: number | null;
  category_name: string | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  classification_confidence: number | null;
  classification_review_status: string | null;
  classification_review_reason: string | null;
  source: string;
  is_categorized: number;
  created_at: string;
}

export interface TransactionUpdateInput {
  date?: string;
  raw_description?: string;
  display_description?: string;
  raw_product_info?: string | null;
  display_product_info?: string | null;
  amount?: number;
  account_name?: string | null;
  payment_channel?: string | null;
  merchant_platform?: string | null;
  category_id?: number | null;
  subcategory_id?: number | null;
}

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  children?: Category[];
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
  categorized: number;
  categorize_failed: number;
  classification_job_id: string | null;
  classification_total: number;
}

export interface ClassificationJob {
  id: string;
  source: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  processed: number;
  categorized: number;
  failed: number;
  message: string;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SummaryData {
  month: string;
  total_spend: number;
  total_income: number;
  transaction_count: number;
  mom_change_pct: number | null;
  top_category: string | null;
}

export interface TrendItem {
  category_id: number;
  category_name: string;
  trend_pct: number;
  trend_label: string;
}

export interface AnomalyItem {
  type: string;
  category_name: string | null;
  transaction_id: number | null;
  description: string | null;
  amount: number | null;
  expected: number | null;
  detail: string;
}

export interface MonthlySummaryResult {
  summary: string;
  source: "llm" | "fallback";
}

export interface NLQueryResult {
  answer: string;
  sql: string;
  data: Record<string, string | number | boolean | null>[] | null;
}
