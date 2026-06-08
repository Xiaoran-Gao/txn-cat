from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional


class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: str


class CategoryOut(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    children: list["CategoryOut"] = []


class TransactionCreate(BaseModel):
    date: date
    description: str
    amount: float
    currency: str = "CNY"
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None


class TransactionUpdate(BaseModel):
    date: Optional[date] = None
    raw_description: Optional[str] = None
    display_description: Optional[str] = None
    amount: Optional[float] = None
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None
    category_id: Optional[int] = None
    subcategory_id: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    date: date
    raw_description: str
    display_description: str
    display_description_source: Optional[str] = None
    amount: float
    currency: str
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    subcategory_id: Optional[int] = None
    subcategory_name: Optional[str] = None
    classification_confidence: Optional[int] = None
    classification_review_status: Optional[str] = None
    classification_review_reason: Optional[str] = None
    source: str
    is_categorized: bool
    created_at: datetime


class TransactionList(BaseModel):
    items: list[TransactionOut]
    total: int
    page: int
    per_page: int


class BulkUpdate(BaseModel):
    ids: list[int]
    category_id: Optional[int] = None
    subcategory_id: Optional[int] = None


class BulkDelete(BaseModel):
    ids: list[int]


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: list[str]
    categorized: int = 0
    categorize_failed: int = 0
    classification_job_id: Optional[str] = None
    classification_total: int = 0


class CategorizeResult(BaseModel):
    total: int
    categorized: int
    failed: int
    job_id: Optional[str] = None


class ClassificationJobOut(BaseModel):
    id: str
    source: str
    status: str
    total: int
    processed: int
    categorized: int
    failed: int
    message: str
    error: Optional[str] = None
    created_at: str
    updated_at: str


class NLQueryRequest(BaseModel):
    question: str


class NLQueryResponse(BaseModel):
    answer: str
    sql: str
    data: Optional[list[dict]] = None


class AnalysisSummary(BaseModel):
    month: str
    total_spend: float
    total_income: float
    transaction_count: int
    mom_change_pct: Optional[float] = None
    top_category: Optional[str] = None


class CategoryTrend(BaseModel):
    category_id: int
    category_name: str
    trend_pct: float  # positive = up, negative = down
    trend_label: str   # "up 15%", "down 8%", "stable"


class AnomalyItem(BaseModel):
    type: str  # "category_spike" | "unusual_transaction"
    category_name: Optional[str] = None
    transaction_id: Optional[int] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    expected: Optional[float] = None
    detail: str
