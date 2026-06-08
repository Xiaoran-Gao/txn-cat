# TxnCatAI — Local Transaction Intelligence

## Overview

A local-first web application for a monthly personal finance ritual: manually upload the latest bank, Alipay, WeChat, or card statement as Excel/CSV, let the system parse and deduplicate transactions, generate readable display descriptions, categorize spending with a local LLM (Ollama 8B), then review a monthly dashboard and ask questions in Chinese. Single-user, privacy-preserving — all transaction data, SQLite storage, and AI processing stays on the machine. Primary language: Chinese (transactions and UI).

The product should feel upload-first, not report-first. The home screen is the starting point for the month: a clear bill upload entry, local privacy status, import progress/results, and the fastest path into classification, spending trends, and natural-language questions.

---

## Product Workflow

1. **Upload this month's bill**: The user drags in or selects an Excel/CSV statement from a bank, Alipay, WeChat, or card account.
2. **Understand the bill format**: The app detects payment channel, account, date, description, and amount columns. It uses deterministic header/sample heuristics first and asks the local LLM to map columns when the format is ambiguous.
3. **Parse, deduplicate, and classify**: The app imports new rows, skips duplicates, stores account/channel metadata, and automatically runs local Ollama categorization for newly imported transactions.
4. **Review monthly dashboard**: After upload, the home screen refreshes into a dashboard with spend, income, category mix, trend movement, and classification coverage.
5. **Ask the ledger**: The user asks questions in Chinese, backed by read-only SQL over the local transaction database.

### Primary Screens

- **Home / Upload Center**: The default route. Provides the main upload dropzone, import/classification result, monthly status, local privacy indicators, charts, and entry points into transaction review and AI questions.
- **Transactions**: Detailed transaction table for filtering, correction, recategorization, and manual edits.
- **AI Query**: Conversational analysis for spending questions and drill-downs.
- **Categories**: Category tree management.
- **Settings**: Local model and database status.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Python + FastAPI | Mature ecosystem, easy Ollama integration, good data analysis libs |
| Database | SQLite | Zero-config, single-file, perfect for single-user local use |
| AI | Ollama (local 8B model) | Local inference, no data leaves the machine |
| Frontend | React + Recharts | Component-rich dashboard, good charting library |
| File Parsing | Pandas + openpyxl + Ollama-assisted mapping | Robust Excel/CSV handling across bank, Alipay, and WeChat statement formats |
| Packaging | Docker (optional) | One-command startup if desired |

---

## Feature Set

### Phase 1 — MVP

#### 1. Transaction Ingestion
- **Excel Import**: Upload .xlsx/.xls file; system auto-detects transaction columns (`date`, `description`, `amount` or `expense/income`) by header matching, sample inspection, and AI-assisted mapping when needed.
- **CSV Import**: Supports CSV with Chinese locale encodings (UTF-8/GB18030/GBK/Big5), preamble rows, and common delimiters (comma, tab, semicolon, pipe).
- **Home Upload Center**: The home screen exposes the primary drag-and-drop/file-picker upload interaction and shows import + automatic classification feedback.
- **Payment Channel Detection**: Detect Alipay, WeChat Pay, and common bank sources from filename, preamble text, column headers, and channel/account columns.
- **Account Metadata**: Store `account_name` and `payment_channel` per transaction when available; display real account/channel values instead of generated labels.
- **Manual Entry**: A form to add a single transaction (date, description, amount).
- **Duplicate Detection**: On import, skip transactions that match an existing row on (date, description, amount).

#### 2. Data Pipeline — Format Understanding, Cleaning & AI Categorization

The system processes uploads through a three-phase pipeline:

**Phase A — Statement Format Understanding**:
- Runs during upload before row import.
- Detects CSV encoding, delimiter, preamble rows, payment channel, account metadata, and transaction table header.
- Maps date/description/amount columns with deterministic rules first.
- If required columns remain ambiguous, sends column names and a small sample of rows to local Ollama and asks for a structured column mapping.

**Phase B — Rule-Based Pre-Cleaning** (on import, non-LLM):
- Runs automatically on import and manual entry. Fast, deterministic, no LLM call.
- Strips mechanical noise via regex: transaction IDs, reference numbers, dates, redundant suffixes ("消费", "快捷支付").
- Does NOT do semantic replacement (that's the LLM's job).
- Stores both `raw_description` (original) and `display_description` (human-readable display text). The initial value comes from deterministic pre-cleaning.

**Phase C — Local LLM Categorization**:
- Runs automatically for newly imported transactions after dedupe.
- Uses Ollama locally; there is no rule-based category fallback.
- Batches multiple transactions in a single prompt to reduce slow local-model round trips.
- For each transaction, the LLM returns `{display_description, category, subcategory}`.
- Uses the editable category tree and recent user corrections as prompt context.
- If a category/subcategory cannot be resolved or Ollama fails, the transaction remains uncategorized for manual review.

**Category Hierarchy** (two-level, Chinese, user-editable):
  - 餐饮美食 (餐馆, 快餐, 外卖, 咖啡饮品, 零食)
  - 交通出行 (公共交通, 加油充电, 打车代驾, 停车费, 汽车维修)
  - 购物消费 (服饰鞋包, 数码电器, 家居日用, 网购, 商超百货)
  - 休闲娱乐 (视频会员, 电影演出, 游戏, 运动健身, 图书)
  - 住房居家 (房租房贷, 水电燃气, 物业费, 通讯宽带, 维修)
  - 医疗健康 (药店, 医院诊所, 体检, 保险)
  - 金融理财 (银行手续费, 利息收支, 投资理财, 信用卡还款)
  - 旅行出行 (机票, 酒店, 火车票, 景点游玩)
  - 教育学习 (培训, 资料, 学费)
  - 收入 (工资, 兼职, 退款, 理财收益)
  - 其他 (其他)

#### 3. User Corrections & Learning
- **Re-categorize**: Click any transaction to change its category/subcategory.
- **Correction Memory**: Corrected (raw description, display description, category, subcategory) examples are stored. The most recent N (default 20) are included as few-shot examples in subsequent LLM prompts.
- **Correction Management**: View and clear stored corrections in Settings.

#### 4. Transaction Management
- **List View**: Paginated, sortable, filterable table (by date range, category, account/channel, amount range, source).
- **Search**: Free-text search on description.
- **Edit/Delete**: Modify any transaction field or remove it.
- **Bulk Operations**: Select multiple and re-categorize or delete.

#### 5. Category Management
- View the full category tree.
- Add, rename, or delete categories/subcategories.
- Deleting a category prompts reassignment of its transactions.

#### 6. Natural Language Query
- **Chat Interface**: A dedicated page where the user types questions in Chinese about their spending.
- **LLM-to-SQL**: The question is sent to the LLM along with the DB schema. The LLM generates a SQL query, which is executed read-only against the database. Results are returned and rendered as text + optional chart.
- **Example Queries**:
  - "上个月我在外卖上花了多少钱？"
  - "今年餐饮支出最高的三个月是哪些？"
  - "打车支出最近半年是什么趋势？"
  - "这个月有没有特别大额的异常交易？"
- **Safety**: Only SELECT queries are allowed. The LLM prompt instructs read-only SQL generation.

#### 7. Monthly Dashboard
- **Upload Status**: Show whether the current local ledger has data, how many transactions were imported, how many were automatically categorized, and how many remain uncategorized.
- **Summary Cards**: Monthly spend, income, transaction count, and categorization coverage.
- **Trend Preview**: Recent month spend/income trend after import.
- **Category Structure**: Top spending categories and uncategorized share.
- **Next Actions**: Guide users to transaction review or natural language questions after automatic import/classification.

---

### Phase 2 — Analysis & Insights (Future)

#### 8. Trend Detection
- Per-category linear trends over 6–12 months. Highlight fastest-growing categories.

#### 9. Anomaly Detection
- Per-category spend vs 3-month moving average (2σ threshold).
- Unusual single transactions via IQR method.

#### 10. Export
- Export filtered transactions to Excel/CSV.

---

### Phase 3 — Advanced (Future)

#### 11. Photo Upload (OCR)
- Upload photos of bank card transaction records (screenshots, receipts, paper statements).
- OCR extraction of transaction details: date, description, amount from images.
- Auto-import extracted transactions into the system for categorization and analysis.

---

## Database Schema

```sql
CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    UNIQUE(name, parent_id)
);

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    raw_description TEXT NOT NULL,       -- original description from bank
    display_description TEXT NOT NULL,   -- LLM/rule-cleaned human-readable transaction text
    display_description_source TEXT DEFAULT 'rule', -- rule | llm | manual
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CNY',
    account_name TEXT,                  -- parsed account/card/wallet label when available
    payment_channel TEXT,               -- e.g. Alipay, WeChat Pay, bank name
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    classification_confidence INTEGER,  -- LLM self-rated confidence, 0-100
    classification_review_status TEXT,  -- not_reviewed | review_approved | review_corrected | review_invalid | review_missing | manual
    classification_review_reason TEXT,  -- short reviewer note when present
    source TEXT DEFAULT 'import',        -- 'import' | 'manual'
    is_categorized INTEGER DEFAULT 0,   -- 0 = pending, 1 = done
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE correction_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_description TEXT NOT NULL,
    display_description TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    subcategory_id INTEGER REFERENCES categories(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### Transactions
```
POST   /api/transactions/import          - Excel/CSV file upload, parse, dedupe, auto-categorize new rows
POST   /api/transactions                 - Create single transaction
GET    /api/transactions                 - List (query: page, per_page, start_date, end_date,
                                           category_id, subcategory_id, search, is_categorized,
                                           sort_by, sort_order)
GET    /api/transactions/:id             - Get single transaction
PUT    /api/transactions/:id             - Update transaction
DELETE /api/transactions/:id             - Delete transaction
POST   /api/transactions/bulk-update     - Bulk update category
DELETE /api/transactions/bulk-delete     - Bulk delete
POST   /api/transactions/categorize      - Trigger AI categorization for all uncategorized rows
POST   /api/transactions/:id/categorize  - Re-categorize single transaction with AI
```

### Categories
```
GET    /api/categories                   - Get full category tree
POST   /api/categories                   - Create category/subcategory
PUT    /api/categories/:id               - Rename category
DELETE /api/categories/:id               - Delete category (with reassignment)
```

### Analysis
```
GET    /api/analysis/summary              - Monthly summary (query: month)
GET    /api/analysis/trends               - Per-category trends (query: months=12)
GET    /api/analysis/anomalies            - Anomaly feed (query: month)
GET    /api/analysis/monthly-spend        - Monthly totals for chart (query: months=12)
```

### Natural Language Query
```
POST   /api/query                         - NL query, returns {answer, sql, data}
```

### System
```
GET    /api/system/health                 - Health check (DB + Ollama)
GET    /api/system/models                 - List available Ollama models
```

---

## LLM Prompt Design (Chinese)

### Statement Column Mapping

Used only when deterministic header/sample detection cannot confidently identify required fields.

```
你是账单表格列映射助手。根据列名和样本行判断每一列的语义。
只返回 JSON，值必须是原始列名或 null。不要解释。
字段：date_col, desc_col, amount_col, expense_col, income_col, account_col, channel_col。
如果金额是单列正负数，用 amount_col；如果支出/收入分列，用 expense_col/income_col。
```

Input payload:

```json
{
  "columns": ["..."],
  "sample_rows": [{ "...": "..." }]
}
```

### Batch Transaction Categorization

Used after import for newly inserted rows, and for manual recategorization batches. The model classifies a chunk of transactions in one call and returns IDs plus an LLM self-rated confidence score. There is no rule-based category fallback; unparseable or invalid LLM outputs remain uncategorized or are retried through LLM only.

```
你是一个本地账单批量分类助手。根据每条交易描述和金额，输出商户名、一级分类ID、二级分类ID、置信度。

分类表：
{category_choices}

用户纠正记录：
{corrections}

规则：
- 每个输入 id 必须返回一条结果。
- display_description 要短、可读，去掉流水号/订单号/卡号尾号/支付渠道噪音，保留真实交易对象或用途。
- 如果原始描述只包含清晰商户/交易对方，没有明确用途信息，display_description 必须保持该商户/交易对方名称，不要补全或猜测场景。
- 只有原始描述明确包含外卖、买菜、打车、酒店、电影、会员、转账、还款等用途信息时，才保留为"美团外卖"、"滴滴打车"、"招商银行信用卡还款"、"微信转账-张三"这类更具体描述。
- 不要根据金额大小推断用途；金额只能辅助判断收入、退款或支出方向。
- category_id 必须选择一级分类 ID，不能使用二级分类 ID。
- subcategory_id 必须属于该一级分类；不确定时使用对应一级分类下的"其他"子类，如果没有则为 null。
- confidence 输出 0-100 的整数，表示模型对分类的把握，不是统计学概率。
- 如果输入含 refund_context，优先参考候选原始交易来判断退款分类。
- 只返回 JSON 对象，不要 Markdown 或解释。

JSON 格式：
{"results":[{"id":1,"display_description":"...","category_id":1,"subcategory_id":2,"confidence":88}]}
```

### Low-Confidence / Sample Review Agent

After the batch classifier returns valid IDs, a second LLM reviewer pass is used only for:

- low-confidence items below `OLLAMA_REVIEW_LOW_CONFIDENCE` (default 80)
- deterministic sampled high-confidence items controlled by `OLLAMA_REVIEW_SAMPLE_RATE` (default 0.10)

The reviewer does not use deterministic classification rules. It receives the candidate classification, category ID table, correction examples, raw/display descriptions, amount, and confidence. It must return a valid category/subcategory ID pair or the original candidate is retained with a review status.

Operational defaults prioritize local Ollama stability over maximum chunk size: `OLLAMA_BATCH_SIZE=16`, `OLLAMA_RETRY_BATCH_SIZE=8`, and `OLLAMA_MAX_RETRIES=3`. If Ollama returns 503 during classification, reduce batch size or review sample rate before increasing concurrency.

```
你是一个交易分类复核 agent。请审计候选分类，修正低置信或明显错误的分类。

规则：
- 每个输入 id 必须返回一条结果。
- 如果候选分类合理，approved=true，并返回原 category_id/subcategory_id。
- 如果候选分类不合理，approved=false，并返回修正后的 category_id/subcategory_id。
- category_id 必须选择一级分类 ID；subcategory_id 必须属于该一级分类，不能编造 ID。
- confidence 输出复核后的 0-100 整数。
- reason 用一句很短的中文说明复核判断。
- 只返回 JSON 对象，不要 Markdown 或解释。
```

### NL Query Prompt

```
你是一个SQL查询助手。根据用户的自然语言问题，生成一个SQLite查询语句。
数据库schema如下：

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    raw_description TEXT NOT NULL,
    display_description TEXT NOT NULL,
    display_description_source TEXT DEFAULT 'rule',
    amount REAL NOT NULL,
    category_id INTEGER,
    subcategory_id INTEGER,
    classification_confidence INTEGER,
    classification_review_status TEXT,
    classification_review_reason TEXT,
    ...
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER
);

规则：
- 只生成SELECT语句，禁止INSERT/UPDATE/DELETE/DROP等写操作。
- 只返回SQL语句，不要输出其他内容。
- 金额字段amount，正值表示支出，负值表示收入。
- 日期字段date格式为'YYYY-MM-DD'。

用户问题：{question}
```

---

## Frontend Pages

### Layout
- Sidebar: 交易记录, 智能问答, 分类管理, 设置
- Chinese-first UI

### Page: 交易记录 (Transactions)
- Top bar: Import Excel/CSV, Add Transaction, search, date range filter
- Filter chips: category, categorization status
- Table: date, description (display + raw), amount, category > subcategory, actions
- Batch bar on selection
- Pagination

### Page: 智能问答 (NL Query)
- Chat-like interface: text input + send button
- Message history (question/answer pairs)
- Answers render as text summary + optional simple chart/table
- Suggested example questions as clickable chips

### Page: 分类管理 (Categories)
- Tree view with edit/delete
- Add category/subcategory form

### Page: 设置 (Settings)
- Ollama config (URL, model, test connection)
- Correction examples table
- Data management (export, clear all)

---

## Project Structure

```
TxnCatAI/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── routers/
│   │   ├── transactions.py
│   │   ├── categories.py
│   │   ├── analysis.py
│   │   ├── query.py          # NL query endpoint
│   │   └── system.py
│   ├── services/
│   │   ├── categorizer.py    # LLM categorization
│   │   ├── parser.py         # Excel/CSV parsing + column detection
│   │   ├── normalizer.py     # Mechanical description pre-cleaning
│   │   ├── analysis.py       # Trend, anomaly, summary
│   │   └── nl_query.py       # NL-to-SQL service
│   └── seed_data.py          # Default categories
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api/
│   │   ├── pages/
│   │   │   ├── Transactions.tsx
│   │   │   ├── NLQuery.tsx
│   │   │   ├── Categories.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   └── types/
│   └── package.json
├── SPEC.md
└── README.md
```

---

## Design Decisions

1. **Excel First**: Primary input format is .xlsx/.xls (Chinese banks typically export Excel). CSV as secondary.
2. **Chinese by Default**: UI, prompts, and category tree default to Chinese. Configurable to English.
3. **Display Description in Pipeline**: Deterministic pre-cleaning creates an initial display description on import; LLM categorization replaces it with a more readable `display_description` unless the user manually edited it.
4. **Two Descriptions Stored**: `raw_description` (original) and `display_description` (human-readable). Both visible in UI.
5. **NL Query Safety**: Read-only SQL generation only. LLM prompt enforces SELECT-only.
6. **No Auth**: Local single-user tool.
7. **LLM-Only Categorization With Selective Review**: The main path is one batched LLM classifier for speed. Low-confidence results and a deterministic sample of high-confidence results go through a second LLM reviewer agent. Avoid fixed sequential multi-agent classification for every transaction because it multiplies local Ollama latency.
8. **Refund Matching**: Refunds (negative amounts or descriptions with 退款/退货) are matched to candidate original transactions by amount similarity (±2% tolerance). Candidate transactions are included in the LLM prompt as context so the refund inherits the same category. Supports partial refunds (broader search by recency when exact amount doesn't match).
9. **No Synthetic Analytics Data**: Dashboards, charts, confidence values, trends, and insight cards must be computed from persisted local data or explicit LLM outputs. Empty states are shown when no real data exists; do not display demo transactions, fake percentages, placeholder chart series, or fabricated confidence scores.
