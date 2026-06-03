export interface Transaction {
  id: number;
  date: string;
  raw_description: string;
  cleaned_description: string;
  amount: number;
  currency: string;
  category_id: number | null;
  category_name: string | null;
  subcategory_id: number | null;
  subcategory_name: string | null;
  source: string;
  is_categorized: number;
  created_at: string;
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

export interface NLQueryResult {
  answer: string;
  sql: string;
  data: Record<string, any>[] | null;
}

export interface MerchantMapping {
  id: number;
  pattern: string;
  display_name: string;
  is_regex: number;
}
