const BASE = "http://localhost:8000/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Transactions
  importFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE}/transactions/import`, { method: "POST", body: form }).then((r) => r.json());
  },
  createTransaction: (data: { date: string; description: string; amount: number }) =>
    request(`${BASE}/transactions`, { method: "POST", body: JSON.stringify(data) }),
  listTransactions: (params: Record<string, string | number | boolean>) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") qs.set(k, String(v)); });
    return request(`${BASE}/transactions?${qs}`);
  },
  getTransaction: (id: number) => request(`${BASE}/transactions/${id}`),
  updateTransaction: (id: number, data: any) =>
    request(`${BASE}/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteTransaction: (id: number) => request(`${BASE}/transactions/${id}`, { method: "DELETE" }),
  bulkUpdate: (data: { ids: number[]; category_id?: number; subcategory_id?: number }) =>
    request(`${BASE}/transactions/bulk-update`, { method: "POST", body: JSON.stringify(data) }),
  bulkDelete: (ids: number[]) =>
    request(`${BASE}/transactions/bulk-delete`, { method: "DELETE", body: JSON.stringify({ ids }) }),
  categorizeAll: () => request(`${BASE}/transactions/categorize`, { method: "POST" }),
  categorizeOne: (id: number) => request(`${BASE}/transactions/${id}/categorize`, { method: "POST" }),

  // Categories
  listCategories: () => request<any[]>(`${BASE}/categories`),
  createCategory: (data: { name: string; parent_id?: number }) =>
    request(`${BASE}/categories`, { method: "POST", body: JSON.stringify(data) }),
  updateCategory: (id: number, data: { name: string }) =>
    request(`${BASE}/categories/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteCategory: (id: number, reassignTo?: number) =>
    request(`${BASE}/categories/${id}?${reassignTo ? `reassign_to=${reassignTo}` : ""}`, { method: "DELETE" }),

  // Analysis
  summary: (month: string) => request(`${BASE}/analysis/summary?month=${month}`),
  trends: (months = 12) => request(`${BASE}/analysis/trends?months=${months}`),
  anomalies: (month: string) => request(`${BASE}/analysis/anomalies?month=${month}`),
  monthlySpend: (months = 12) => request(`${BASE}/analysis/monthly-spend?months=${months}`),

  // NL Query
  query: (question: string) =>
    request(`${BASE}/query`, { method: "POST", body: JSON.stringify({ question }) }),

  // System
  health: () => request(`${BASE}/system/health`),
  models: () => request(`${BASE}/system/models`),
  merchants: () => request(`${BASE}/system/merchants`),
  createMerchant: (data: { pattern: string; display_name: string; is_regex: boolean }) =>
    request(`${BASE}/system/merchants`, { method: "POST", body: JSON.stringify(data) }),
  deleteMerchant: (id: number) => request(`${BASE}/system/merchants/${id}`, { method: "DELETE" }),
};
