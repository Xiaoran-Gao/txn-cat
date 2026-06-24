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
    product_info: Optional[str] = None
    amount: float
    currency: str = "CNY"
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None
    merchant_platform: Optional[str] = None


class TransactionUpdate(BaseModel):
    date: Optional[date] = None
    raw_description: Optional[str] = None
    display_description: Optional[str] = None
    raw_product_info: Optional[str] = None
    display_product_info: Optional[str] = None
    amount: Optional[float] = None
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None
    merchant_platform: Optional[str] = None
    category_id: Optional[int] = None
    subcategory_id: Optional[int] = None


class TransactionOut(BaseModel):
    id: int
    date: date
    raw_description: str
    display_description: str
    display_description_source: Optional[str] = None
    raw_product_info: Optional[str] = None
    display_product_info: Optional[str] = None
    amount: float
    currency: str
    account_name: Optional[str] = None
    payment_channel: Optional[str] = None
    merchant_platform: Optional[str] = None
    merchant_canonical: Optional[str] = None
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


class CreditCardCreate(BaseModel):
    name: str
    issuer: Optional[str] = None
    account_name: str
    statement_day: int = Field(ge=1, le=31)
    due_day: int = Field(ge=1, le=31)
    reminder_days: int = Field(default=3, ge=0)
    is_active: bool = True


class CreditCardUpdate(BaseModel):
    name: Optional[str] = None
    issuer: Optional[str] = None
    account_name: Optional[str] = None
    statement_day: Optional[int] = Field(default=None, ge=1, le=31)
    due_day: Optional[int] = Field(default=None, ge=1, le=31)
    reminder_days: Optional[int] = Field(default=None, ge=0)
    is_active: Optional[bool] = None


class CreditCardOut(BaseModel):
    id: int
    name: str
    issuer: Optional[str] = None
    account_name: str
    statement_day: int
    due_day: int
    reminder_days: int
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CreditCardStatementMarkCreate(BaseModel):
    statement_date: date
    marked_paid: bool = True
    note: Optional[str] = None


class CreditCardReminderOut(BaseModel):
    card: CreditCardOut
    previous_statement_date: date
    statement_date: date
    due_date: date
    estimated_statement_amount: float
    recognized_paid_amount: float
    remaining_amount: float
    days_until_due: int
    status: str
    status_label: str
    is_marked_paid: bool
    estimate_source: str = "transactions"
