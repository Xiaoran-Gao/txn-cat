# TxnCatAI — AI-Powered Personal Financial Assistant

## Overview

A local-first web application that ingests bank card transactions (Excel/CSV or manual entry), cleans and normalizes merchant descriptions, categorizes transactions using a local LLM (Ollama 8B), and provides spending analysis and natural language querying through a web dashboard. Single-user, privacy-preserving — all data and AI processing stays on the machine. Primary language: Chinese (transactions and UI).

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Python + FastAPI | Mature ecosystem, easy Ollama integration, good data analysis libs |
| Database | SQLite | Zero-config, single-file, perfect for single-user local use |
| AI | Ollama (local 8B model) | Local inference, no data leaves the machine |
| Frontend | React + Recharts | Component-rich dashboard, good charting library |
| File Parsing | Pandas + openpyxl | Robust Excel (.xlsx/.xls) and CSV handling with column detection |
| Packaging | Docker (optional) | One-command startup if desired |

---

## Feature Set

### Phase 1 — MVP

#### 1. Transaction Ingestion
- **Excel Import**: Upload .xlsx/.xls file; system auto-detects columns (`date`, `description`, `amount`) by header name matching and type inference. Supports both Chinese and English column headers (e.g., "交易日期"/"date", "交易说明"/"description", "金额"/"amount").
- **CSV Import**: Also supports CSV as a secondary format.
- **Manual Entry**: A form to add a single transaction (date, description, amount).
- **Duplicate Detection**: On import, skip transactions that match an existing row on (date, description, amount).

#### 2. Data Pipeline — Cleaning & AI Categorization

The system processes each transaction through a two-phase pipeline:

**Phase A — Rule-Based Pre-Cleaning** (on import, non-LLM):
- Runs automatically on import and manual entry. Fast, deterministic, no LLM call.
- Strips mechanical noise via regex: transaction IDs, reference numbers, dates, redundant suffixes ("消费", "快捷支付").
- Does NOT do semantic replacement (that's the LLM's job).
- Stores both `raw_description` (original) and `cleaned_description` (pre-cleaned).

**Phase B — 3-Agent LLM Categorization** (on demand, uses Ollama):
- Each transaction goes through three specialized agents sequentially:
  1. **Normalizer Agent** — Receives the pre-cleaned description from Phase A. Extracts the core merchant name, preserving key business words ("外卖", "便利店", "加油站"). Outputs a clean merchant name.
  2. **Categorizer Agent** — Assigns `category > subcategory` based on the clean merchant name, the full category tree, recent user corrections (few-shot), and refund context (if applicable).
  3. **Reviewer Agent** — Validates the assignment against the original description and amount. If the classification seems wrong, overrides with a corrected category/subcategory.
- **Batch Processing**: Categorize all uncategorized transactions in one go.
- **Fallback**: If any agent fails, the transaction is left uncategorized for manual review.

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

**Merchant Mappings** (user-maintainable):
- A reference table for known merchant patterns. Configurable in Settings.
- Used as hints/reference, not for destructive text replacement.

#### 3. User Corrections & Learning
- **Re-categorize**: Click any transaction to change its category/subcategory.
- **Correction Memory**: Corrected (description, category, subcategory) pairs are stored. The most recent N (default 20) are included as few-shot examples in subsequent LLM prompts.
- **Correction Management**: View and clear stored corrections in Settings.

#### 4. Transaction Management
- **List View**: Paginated, sortable, filterable table (by date range, category, amount range, source).
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

---

### Phase 2 — Analysis & Insights (Future)

#### 8. Spending Dashboard
- Summary cards, category pie/bar charts, monthly spend over time, category drill-down.

#### 9. Trend Detection
- Per-category linear trends over 6–12 months. Highlight fastest-growing categories.

#### 10. Anomaly Detection
- Per-category spend vs 3-month moving average (2σ threshold).
- Unusual single transactions via IQR method.

#### 11. Export
- Export filtered transactions to Excel/CSV.

---

### Phase 3 — Advanced (Future)

#### 12. Photo Upload (OCR)
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
    cleaned_description TEXT NOT NULL,   -- after merchant normalization
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CNY',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    source TEXT DEFAULT 'import',        -- 'import' | 'manual'
    is_categorized INTEGER DEFAULT 0,   -- 0 = pending, 1 = done
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE merchant_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL UNIQUE,        -- raw pattern to match (e.g., "MEITUAN")
    display_name TEXT NOT NULL,          -- normalized name (e.g., "美团")
    is_regex INTEGER DEFAULT 0          -- 0 = simple contains match, 1 = regex
);

CREATE TABLE correction_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    subcategory_id INTEGER REFERENCES categories(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## API Endpoints

### Transactions
```
POST   /api/transactions/import          - Excel/CSV file upload
POST   /api/transactions                 - Create single transaction
GET    /api/transactions                 - List (query: page, per_page, start_date, end_date,
                                           category_id, subcategory_id, search, is_categorized,
                                           sort_by, sort_order)
GET    /api/transactions/:id             - Get single transaction
PUT    /api/transactions/:id             - Update transaction
DELETE /api/transactions/:id             - Delete transaction
POST   /api/transactions/bulk-update     - Bulk update category
DELETE /api/transactions/bulk-delete     - Bulk delete
POST   /api/transactions/categorize      - Trigger AI categorization for all uncategorized
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

### Merchant Mappings
```
GET    /api/merchants                     - List all merchant mappings
POST   /api/merchants                     - Add mapping
DELETE /api/merchants/:id                 - Delete mapping
```

### System
```
GET    /api/system/health                 - Health check (DB + Ollama)
GET    /api/system/models                 - List available Ollama models
```

---

## LLM Prompt Design (Chinese)

### Agent 1 — Normalizer

```
你是一个银行交易描述清洗助手。从交易描述中提取标准化的商户名称。

规则：
- 描述文本已经过初步清洗（去除了交易ID、日期等数字噪音）
- 提取核心商户名称，保留品牌名和关键业务词（如"外卖""便利店""加油站"）
- 如果是退款类交易（包含"退款""退货""退费"），保留退款关键词
- 如果描述已经很简洁清晰，直接返回原文
- 只返回清洗后的商户名称，不要任何解释或其他内容
```

### Agent 2 — Categorizer

```
你是一个银行交易分类助手。根据商户名称和金额，将交易归类到下面的二级分类体系中。

可选分类：
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

用户最近的纠正记录（请优先参考）：
- "美团外卖" → 餐饮美食 > 外卖
- "滴滴出行" → 交通出行 > 打车代驾

{refund_context}

规则：
- 仔细分析商户名称的含义
- 不确定时选择"其他 > 其他"，不要随意猜测
- 只返回JSON对象，包含"category"和"subcategory"字段，不要输出其他内容
```

### Agent 3 — Reviewer

```
你是一个交易分类审核助手。审核以下分类结果是否合理。

交易信息：
- 原始描述：{raw_description}
- 商户名称：{merchant_name}
- 交易金额：{amount}
- 当前分类：{category} > {subcategory}

可选分类：
{category_tree}

请判断分类是否合理：
- 如果合理，返回 {"approved": true}
- 如果不合理，返回 {"approved": false, "category": "...", "subcategory": "...", "reason": "..."}

只返回JSON对象，不要其他内容。
```

### NL Query Prompt

```
你是一个SQL查询助手。根据用户的自然语言问题，生成一个SQLite查询语句。
数据库schema如下：

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    raw_description TEXT NOT NULL,
    cleaned_description TEXT NOT NULL,
    amount REAL NOT NULL,
    category_id INTEGER,
    subcategory_id INTEGER,
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
- Table: date, description (raw → cleaned), amount, category > subcategory, actions
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
- Merchant mappings table
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
│   │   ├── normalizer.py     # Merchant description normalization
│   │   ├── analysis.py       # Trend, anomaly, summary
│   │   └── nl_query.py       # NL-to-SQL service
│   └── seed_data.py          # Default categories + merchant mappings
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
3. **Merchant Normalization in Pipeline**: Happens on import before categorization, not as a separate step.
4. **Two Descriptions Stored**: `raw_description` (original) and `cleaned_description` (normalized). Both visible in UI.
5. **NL Query Safety**: Read-only SQL generation only. LLM prompt enforces SELECT-only.
6. **No Auth**: Local single-user tool.
7. **Multi-Agent Categorization Pipeline**: Three specialized agents run sequentially — Normalizer (cleans merchant name), Categorizer (assigns category/subcategory), Reviewer (validates and corrects). Each agent has a narrow, focused task for better accuracy than a single prompt.
8. **Refund Matching**: Refunds (negative amounts or descriptions with 退款/退货) are matched to candidate original transactions by amount similarity (±2% tolerance). Candidate transactions are included in the LLM prompt as context so the refund inherits the same category. Supports partial refunds (broader search by recency when exact amount doesn't match).
