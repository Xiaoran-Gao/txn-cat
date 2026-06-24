# TxnCatAI Spec

## 1. Product Summary

TxnCatAI is a local-first, single-user transaction categorization and analysis app for Chinese personal finance workflows.

The implemented product lets the user:

- upload Excel or CSV transaction statements
- parse and normalize transaction rows into SQLite
- deduplicate imported rows
- classify transactions with a local Ollama model
- review, search, filter, edit, delete, bulk delete, and manually add transactions
- maintain a two-level category tree
- view a monthly spending dashboard with deterministic analytics and optional LLM narrative
- ask natural-language Chinese questions that are converted into read-only SQLite queries
- inspect local database and Ollama health from Settings

All persisted transaction data is stored locally in SQLite. LLM classification and natural-language querying are implemented through local Ollama.

## 2. Runtime Stack

| Layer | Implemented Choice |
| --- | --- |
| Backend | Python, FastAPI |
| Database | SQLite at `data/txncatai.db` by default |
| AI Runtime | Ollama local chat API |
| Frontend | React, Vite, TypeScript |
| Charts | Recharts |
| Icons | lucide-react |
| File Parsing | pandas, openpyxl, Python csv utilities |
| Dev Scripts | `scripts/dev.sh`, `scripts/stop-dev.sh` |

Default backend settings are in `backend/config.py`:

```text
APP_VERSION=0.1.0
DATABASE_URL=sqlite:///data/txncatai.db
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT=180
OLLAMA_BATCH_SIZE=4
OLLAMA_RETRY_BATCH_SIZE=2
OLLAMA_BATCH_WORKERS=1
OLLAMA_MAX_PARALLEL=1
OLLAMA_REVIEW_LOW_CONFIDENCE=80
OLLAMA_REVIEW_SAMPLE_RATE=0
OLLAMA_MAX_RETRIES=5
MAX_CORRECTION_EXAMPLES=20
```

## 3. Implemented User Workflow

1. The user starts the app with `./scripts/dev.sh`.
2. The backend initializes SQLite tables and seeds default Chinese categories if none exist.
3. The user uploads `.xlsx`, `.xls`, or `.csv` from Home, Dashboard, or Transactions.
4. The parser detects transaction columns, product info, payment channel, account, and merchant platform when possible.
5. The importer normalizes descriptions, inserts new rows, skips duplicates, and creates a background classification job for new or still-uncategorized duplicate rows.
6. The frontend polls the classification job endpoint and displays progress.
7. The user reviews transactions, filters/searches/sorts them, edits metadata and categories, deletes rows, or triggers AI classification again.
8. The user can ask Chinese questions in the AI Query page. The backend asks Ollama for SELECT SQL, validates it against dangerous write keywords, runs it against SQLite, then asks Ollama to summarize the result in Chinese.

## 4. Backend Implementation

### 4.1 App Startup

`backend/main.py` creates the FastAPI app, enables permissive local CORS for localhost/127.0.0.1 ports, initializes the database, seeds categories, and registers routers:

- `/api/transactions`
- `/api/categories`
- `/api/analysis`
- `/api/query`
- `/api/system`

### 4.2 Database

`backend/database.py` creates and migrates the local SQLite schema. SQLite is opened with:

- `PRAGMA journal_mode=WAL`
- `PRAGMA foreign_keys=ON`
- `PRAGMA busy_timeout=30000`

Implemented tables:

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
    raw_description TEXT NOT NULL,
    display_description TEXT NOT NULL,
    display_description_source TEXT DEFAULT 'rule',
    raw_product_info TEXT,
    display_product_info TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CNY',
    account_name TEXT,
    payment_channel TEXT,
    merchant_platform TEXT,
    merchant_canonical TEXT,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    classification_confidence INTEGER,
    classification_review_status TEXT,
    classification_review_reason TEXT,
    source TEXT DEFAULT 'import',
    is_categorized INTEGER DEFAULT 0,
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

Implemented indexes:

```sql
CREATE INDEX idx_txn_date ON transactions(date);
CREATE INDEX idx_txn_category ON transactions(category_id);
CREATE INDEX idx_txn_subcategory ON transactions(subcategory_id);
CREATE INDEX idx_txn_categorized ON transactions(is_categorized);
CREATE INDEX idx_txn_history_exact
    ON transactions(raw_description, raw_product_info, is_categorized, category_id);
CREATE INDEX idx_txn_merchant_history
    ON transactions(merchant_canonical, is_categorized, category_id, date);
CREATE INDEX idx_correction_raw_description
    ON correction_examples(raw_description, created_at);
```

### 4.3 Default Categories

`backend/seed_data.py` seeds a two-level Chinese category tree:

- 餐饮美食: 餐馆, 快餐, 外卖, 咖啡饮品, 零食
- 交通出行: 公共交通, 加油充电, 打车代驾, 停车费, 汽车维修
- 购物消费: 服饰鞋包, 数码电器, 家居日用, 网购, 商超百货
- 休闲娱乐: 视频会员, 电影演出, 游戏, 运动健身, 图书
- 住房居家: 房租房贷, 水电燃气, 物业费, 通讯宽带, 维修
- 医疗健康: 药店, 医院诊所, 体检, 保险
- 金融理财: 银行手续费, 利息收支, 投资理财, 信用卡还款
- 旅行出行: 机票, 酒店, 火车票, 景点游玩
- 教育学习: 培训, 资料, 学费
- 收入: 工资, 兼职, 退款, 理财收益
- 其他: 其他

## 5. Import and Parsing

Implemented in `backend/services/parser.py` and `backend/routers/transactions.py`.

### 5.1 Supported Files

- `.xlsx`
- `.xls`
- `.csv`

Unsupported file extensions are rejected with HTTP 400.

### 5.2 CSV Handling

CSV parsing supports multiple encodings:

- `utf-8-sig`
- `utf-8`
- `gb18030`
- `gbk`
- `big5`
- `latin1`

CSV header detection scans preamble rows and common delimiters:

- comma
- tab
- semicolon
- pipe

The parser can detect account information from preamble text and payment channel from filename/preamble/header context.

### 5.3 Column Detection

The parser detects:

- date column
- description column
- single amount column
- split expense/income columns
- account column
- payment channel column
- merchant platform column

Detection uses header matching and sample heuristics. It also calls local Ollama for structured column mapping through `ai_detect_columns`, then falls back to position-based guesses when needed.

### 5.4 Metadata Detection

Parser-detected metadata fields:

- `account_name`
- `payment_channel`
- `merchant_platform`
- `raw_product_info`

Importer-derived metadata fields:

- `display_product_info`
- `merchant_canonical`

Payment channel detection currently recognizes common Chinese wallets and banks, including Alipay, WeChat Pay, CMB, BOC, ICBC, CCB, ABC, and Bankcomm by keyword.

Merchant platform detection currently recognizes platforms such as 美团, 饿了么, 滴滴, 淘宝, 天猫, 京东, 拼多多, 抖音, 小红书, 携程, and 高德 by keyword.

### 5.5 Amount Semantics

Implemented convention:

- positive amount = spending
- negative amount = income or refund

For split expense/income columns:

- expense values are imported as positive amounts
- income values are imported as negative amounts

### 5.6 Deduplication

Import deduplication checks:

```text
date + raw_description + amount + raw_product_info
```

Existing duplicates are skipped. If a duplicate existing row is still uncategorized, its id is included in the classification job.

## 6. Description Normalization

Implemented in `backend/services/normalizer.py`.

On import and manual creation, the app stores:

- `raw_description`: original statement text
- `display_description`: deterministic cleaned display text
- `display_description_source`: initially `rule`
- `raw_product_info`: imported product/item detail when detected
- `display_product_info`: deterministic cleaned product/item detail
- `merchant_canonical`: canonical merchant key derived from description, display text, and product/platform hints

When the LLM later returns a better display description, the source becomes `llm`, unless the user manually edited the display description. Manual display descriptions are preserved during grouped classification updates.

## 7. AI Categorization

Implemented in `backend/services/categorizer.py` and `backend/services/classification_jobs.py`.

### 7.1 Ollama Model Selection

The classifier checks available local Ollama models. If the configured model exists, it uses it. If not, it falls back to the first available local model. If no local model is available, classification fails with an Ollama availability error.

### 7.2 Classification Jobs

Bulk classification is asynchronous from the frontend perspective:

1. API creates an in-memory classification job.
2. FastAPI `BackgroundTasks` runs classification.
3. Frontend polls `/api/transactions/categorize/jobs/{job_id}`.

Job fields:

- `id`
- `source`: `upload` or `manual`
- `status`: `queued`, `running`, `done`, `failed`
- `total`
- `processed`
- `categorized`
- `failed`
- `message`
- `error`
- `created_at`
- `updated_at`

Jobs are in-memory only and do not survive backend restart.

### 7.3 Grouping Before LLM Calls

Before calling the LLM, batch classification first tries to reuse existing classifications from:

- exact user correction examples by `raw_description`
- exact prior categorized transactions by `raw_description`, `raw_product_info`, and amount direction
- same canonical merchant plus similar product details and amount direction

Rows that still need the LLM are grouped by:

```text
merchant_canonical + display/raw description fallback + amount direction + similar product key
```

Amount direction is:

- `positive`
- `negative`
- `zero`

Only one representative row per group is sent to the LLM. Valid results are copied back to all rows in the group.

### 7.4 Batch Classification

The LLM prompt includes:

- category id tree
- recent correction examples
- transaction id
- display description
- raw description
- product info
- canonical merchant
- amount
- optional refund context

The model is expected to return JSON with:

- `id`
- `display_description`
- `category_id`
- `subcategory_id`
- `confidence`

The backend validates category ids and subcategory parentage before updating transactions.

### 7.5 Retry Behavior

Invalid or missing batch results are retried in smaller chunks using a stricter LLM prompt. If a valid category cannot be resolved after retry, affected rows remain uncategorized and count as failed.

### 7.6 Review Agent

The second LLM review pass is implemented for:

- confidence below `OLLAMA_REVIEW_LOW_CONFIDENCE`
- deterministic sampled rows controlled by `OLLAMA_REVIEW_SAMPLE_RATE`

The reviewer can approve or correct category/subcategory ids and writes:

- `classification_review_status`
- `classification_review_reason`
- updated confidence

Default sample rate is currently `0`, so only low-confidence review runs by default.

### 7.7 Refund Context

If the transaction looks like a refund by negative amount or refund-related keywords, the classifier searches recent categorized positive transactions by amount similarity and recency. Candidate originals are included in the LLM prompt as context.

## 8. Transactions API

Implemented endpoints:

```text
POST   /api/transactions/import
POST   /api/transactions
GET    /api/transactions
GET    /api/transactions/{txn_id}
PUT    /api/transactions/{txn_id}
DELETE /api/transactions/{txn_id}
POST   /api/transactions/bulk-update
DELETE /api/transactions/bulk-delete
POST   /api/transactions/categorize
GET    /api/transactions/categorize/jobs/{job_id}
POST   /api/transactions/{txn_id}/categorize
```

Implemented list query parameters:

- `page`
- `per_page`
- `start_date`
- `end_date`
- `category_id`
- `subcategory_id`
- `search`
- `is_categorized`
- `sort_by`: `date`, `amount`, `created_at`
- `sort_order`: `asc`, `desc`

Manual transaction creation supports:

- date
- description
- product info
- amount
- currency
- account name
- payment channel
- merchant platform

Transaction update supports:

- date
- raw description
- display description
- raw product info
- display product info
- amount
- account name
- payment channel
- merchant platform
- category id
- subcategory id

When a category is manually assigned, the transaction is marked categorized, review status becomes `manual`, and a correction example is stored.

## 9. Categories API

Implemented endpoints:

```text
GET    /api/categories
POST   /api/categories
PUT    /api/categories/{cat_id}
DELETE /api/categories/{cat_id}?reassign_to={id}
```

Implemented behavior:

- list returns a nested two-level tree
- create supports top-level categories and subcategories
- update renames a category
- delete removes a category
- optional `reassign_to` reassigns transactions that reference the deleted category

Current frontend deletion does not pass `reassign_to`; deleting a category through the UI leaves affected transactions uncategorized/null through database foreign-key behavior.

## 10. Analysis API

Implemented in `backend/services/analysis.py`.

```text
GET /api/analysis/summary?month=YYYY-MM
GET /api/analysis/trends?months=12
GET /api/analysis/anomalies?month=YYYY-MM
GET /api/analysis/monthly-spend?months=12
POST /api/analysis/monthly-summary
```

### 10.1 Monthly Summary

Returns:

- month
- total spend from positive amounts
- total income from absolute negative amounts
- positive-spend transaction count
- month-over-month spend change when prior month has spend
- top category by positive spend

### 10.2 Trends

Computes simple per-category linear trend over recent monthly totals. Categories with fewer than three data points return `数据不足`.

### 10.3 Anomalies

Implemented deterministic anomaly checks:

- category spend spike above recent 3-month average plus 2 standard deviations
- unusually high transaction within subcategory by IQR over recent 6 months

Returns at most 20 anomaly items.

### 10.4 Monthly Spend

Returns monthly positive spend grouped by category for charting.

### 10.5 Monthly Narrative

`POST /api/analysis/monthly-summary` accepts precomputed monthly analytics JSON from the frontend Dashboard and asks the local LLM to write a concise Chinese monthly summary.

Implemented prompt constraints:

- do not recalculate numbers
- do not invent missing facts
- only cite facts from the provided JSON
- write naturally for ordinary users
- avoid heavy financial jargon

If Ollama fails or returns an empty response, the endpoint returns:

```json
{"summary":"","source":"fallback"}
```

The Dashboard then displays its deterministic fallback summary based on the same structured JSON.

## 11. Natural-Language Query

Implemented in `backend/services/nl_query.py`.

Endpoint:

```text
POST /api/query
```

Request:

```json
{"question":"上个月我的总支出是多少？"}
```

Response:

```json
{
  "answer": "...",
  "sql": "SELECT ...",
  "data": [{ "...": "..." }]
}
```

Implemented flow:

1. Ollama receives a Chinese system prompt with SQLite schema and rules.
2. Ollama generates SQL.
3. Backend strips markdown fences and trailing semicolon.
4. Backend rejects SQL containing write or schema-changing keywords:
   - `INSERT`
   - `UPDATE`
   - `DELETE`
   - `DROP`
   - `ALTER`
   - `CREATE`
   - `ATTACH`
   - `DETACH`
5. Backend executes the SQL against SQLite.
6. Ollama summarizes the SQL result in concise Chinese.

Important limitation: the current validation blocks obvious dangerous keywords but does not parse SQL into an AST. It relies on keyword rejection plus prompt instructions.

## 12. System API

Implemented endpoints:

```text
GET /api/system/health
GET /api/system/models
```

Health returns:

- database status
- Ollama status
- configured model
- active model
- Ollama error when present
- app version
- SQLite storage usage, including main db/WAL/SHM files

Models returns:

- available Ollama model names
- active model
- error if Ollama is unavailable or configured model is missing

## 13. Frontend Implementation

### 13.1 Routing

Implemented routes in `frontend/src/App.tsx`:

```text
/              Home
/dashboard     Dashboard
/transactions  Transactions
/query         NLQuery
/categories    Categories
/settings      Settings
```

### 13.2 Home

Implemented in `frontend/src/pages/Home.tsx`.

Home currently provides:

- upload-first landing experience
- drag-and-drop and file-picker import
- upload result summary
- classification job progress polling
- animated product story sections for classification, category tree, dashboard concept, and natural-language query
- links into Transactions, Categories, Dashboard, and Query

After upload/classification completion, Home navigates to `/dashboard`.

### 13.3 Dashboard

Implemented in `frontend/src/pages/Dashboard.tsx`.

Dashboard currently provides:

- upload Excel/CSV from the dashboard header
- trigger AI classification for uncategorized transactions
- classification job progress polling
- fetch all transaction pages through the list API
- automatically select the latest month that has positive spending data
- switch the dashboard analysis month from a header month selector
- monthly overview metrics:
  - total spending
  - daily average spending
  - spending transaction count
  - average transaction amount
  - covered category count, excluding uncategorized spending
  - month-over-month change when previous month spending exists
  - anomaly count
- daily spending heatmap for the active month
- shared toggle between spending amount and transaction count for monthly trend and daily heatmap
- monthly bar chart for spending amount or transaction count
- category donut chart with Top categories and merged "其他"
- category ranking with amount, share, count, and month-over-month change
- Top 3 merchant ranking by amount
- Top 3 merchant ranking by count
- Top 3 platform ranking by amount/count when `merchant_platform` data exists
- payment channel distribution when `payment_channel` data exists
- account preference list when `account_name` data exists
- anomaly cards
- AI monthly summary
- visible structured monthly analytics JSON used as LLM input
- links to Transactions and AI Query

Dashboard analytics are computed deterministically in the frontend from persisted transaction rows before any monthly summary is requested from Ollama.

Implemented Dashboard anomaly rules:

- single transaction above recent 90-day P95 when at least 10 recent samples exist
- single transaction above category recent 90-day mean plus 3 standard deviations when at least 5 category samples exist
- daily spending above three times the current-month nonzero-day average
- category month-over-month growth above 50%
- same-merchant same-day repeated charges with close amounts

Dashboard sends only structured monthly analytics JSON to `POST /api/analysis/monthly-summary`; it does not send raw transaction rows for narrative generation.

### 13.4 Transactions

Implemented in `frontend/src/pages/Transactions.tsx`.

Transactions page currently provides:

- Excel/CSV import
- classification job progress banner
- AI classify all pending transactions
- manual transaction creation
- transaction editing modal
- single-row AI recategorization
- row deletion
- bulk deletion
- bulk "mark for recategorization" action in the UI
- search
- month filter wired to backend `start_date` and `end_date`
- category/subcategory filter
- categorization status filter
- account filter based on currently loaded rows
- date/amount sorting
- pagination at 50 rows per page
- current-page stat cards
- import result banner
- per-job classification progress bar
- classification confidence and review status display

Limitations in current implementation:

- Account filtering is applied client-side to the currently loaded page, not backend-wide.
- Bulk recategorization currently calls bulk update with `category_id: null`; backend only updates rows when `category_id` is not null, so this does not actually clear categorization or trigger AI classification by itself.

### 13.5 Categories

Implemented in `frontend/src/pages/Categories.tsx`.

Categories page currently provides:

- category tree display
- expand/collapse top-level categories
- add top-level category
- add subcategory
- rename category/subcategory
- delete category/subcategory
- summary counts for top-level and child categories

### 13.6 AI Query

Implemented in `frontend/src/pages/NLQuery.tsx`.

AI Query page currently provides:

- chat-like message history
- Chinese input box
- enter-to-send
- example question chips
- returned answer display
- generated SQL display
- first 10 returned data rows as a table

### 13.7 Settings

Implemented in `frontend/src/pages/Settings.tsx`.

Settings currently displays:

- database status
- Ollama status
- active/configured model

## 14. Dev Scripts

### 14.1 Start

`scripts/dev.sh`:

- frees existing backend/frontend ports with `lsof` and `kill`
- starts backend with uvicorn
- starts frontend with Vite
- passes `VITE_API_BASE_URL` to frontend
- defaults to backend `127.0.0.1:8000` and frontend `127.0.0.1:5173`

### 14.2 Stop

`scripts/stop-dev.sh` stops local dev processes on the configured ports.

## 15. Current Known Gaps

These are not implemented or not fully wired in the current code:

- Settings does not yet expose correction example management or data export/clear controls.
- Transactions UI exposes a month picker rather than an arbitrary date range picker.
- Transaction list API does not support backend account/payment-channel/merchant-platform filters yet.
- Natural-language SQL safety uses keyword rejection, not a SQL parser or read-only SQLite connection enforcement.
- Classification jobs are stored in process memory and disappear on backend restart.
- Correction examples are stored on manual category update, but there is no frontend screen to view or clear them.
- Dashboard computes most rich monthly analytics in the frontend from fetched transaction rows; backend analysis endpoints exist but are not the main data source for the Dashboard page.

## 16. Project Structure

```text
txn-cat/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── models.py
│   ├── seed_data.py
│   ├── routers/
│   │   ├── analysis.py
│   │   ├── categories.py
│   │   ├── query.py
│   │   ├── system.py
│   │   └── transactions.py
│   └── services/
│       ├── analysis.py
│       ├── categorizer.py
│       ├── classification_jobs.py
│       ├── nl_query.py
│       ├── normalizer.py
│       └── parser.py
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── api/client.ts
│   │   ├── components/Layout.tsx
│   │   ├── pages/
│   │   │   ├── Categories.tsx
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Home.tsx
│   │   │   ├── NLQuery.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── Transactions.tsx
│   │   ├── types/index.ts
│   │   └── index.css
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   ├── dev.sh
│   └── stop-dev.sh
├── README.md
└── SPEC.md
```
