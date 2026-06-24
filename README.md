# TxnCatAI

TxnCatAI is a local-first transaction organization, AI categorization, and spending analysis app for Chinese personal finance workflows. It imports bank, WeChat Pay, Alipay, Excel, and CSV statements into local SQLite, then uses a local Ollama model for categorization, natural-language querying, and monthly summaries.

The app runs three local pieces:

- Ollama: local LLM inference for transaction categorization, natural-language queries, and monthly narratives
- FastAPI backend: file parsing, SQLite storage, classification jobs, and analysis APIs
- Vite React frontend: upload, dashboard, transaction workbench, category management, AI query, and settings UI

## Implemented Features

- Import `.xlsx`, `.xls`, and `.csv` transaction statements
- Detect transaction date, description, amount, income/spend direction, account, payment channel, merchant platform, and product information
- Deduplicate imports by `date + raw_description + amount + raw_product_info`
- Persist all transaction data locally in SQLite at `data/txncatai.db` by default
- Run asynchronous batch categorization with a local Ollama model and visible frontend job progress
- Reclassify a single transaction, classify all pending transactions, and manually edit assigned categories
- Store manual correction examples so future LLM categorization can use them as reference
- Maintain a two-level Chinese category tree with create, rename, and delete actions
- Search, month-filter, category-filter, status-filter, account-filter, sort, and paginate transactions
- Manually add, edit, delete, and bulk-delete transactions
- View a spending dashboard with monthly metrics, calendar heatmap, category share, merchant/platform/payment-channel breakdowns, anomaly signals, and AI monthly summary
- Ask Chinese natural-language questions that are converted into read-only SQLite queries, with generated SQL and result preview
- Check local database, Ollama, and active model status from Settings

Amount convention:

- Positive amount = spending
- Negative amount = income or refund

## Requirements

- Python 3.11+
- Node.js and npm
- Ollama installed and running
- A local Ollama model, for example `qwen3:8b`

## First-Time Setup

Install backend dependencies:

```bash
cd backend
pip3 install -r requirements.txt
cd ..
```

Install frontend dependencies:

```bash
cd frontend
npm install
cd ..
```

Install or pull the default Ollama model:

```bash
ollama pull qwen3:8b
```

The default backend settings are in `backend/config.py`:

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

You can override these values with environment variables. Larger `OLLAMA_BATCH_SIZE` values reduce round trips but need more model context and may be slower or trigger Ollama 503s on small machines. `OLLAMA_BATCH_WORKERS` parallelizes chunks within one classification job, while `OLLAMA_MAX_PARALLEL` caps concurrent Ollama requests across the backend. Low-confidence results are reviewed by a second LLM pass; deterministic sampled review is controlled by `OLLAMA_REVIEW_SAMPLE_RATE`.

## Start Ollama

If the Ollama desktop app is already running, this may already be available.

Check that Ollama responds:

```bash
ollama list
```

If it is not running, start it:

```bash
ollama serve
```

Keep that terminal open, then verify in another terminal:

```bash
ollama list
```

## Start The App

From the project root:

```bash
./scripts/dev.sh
```

This script:

- frees the default dev ports if old local dev processes are still listening
- starts the backend at `http://127.0.0.1:8000`
- starts the frontend at `http://127.0.0.1:5173`
- wires the frontend API URL to the backend

Open the app:

```text
http://127.0.0.1:5173
```

Stop both services with `Ctrl+C`, or from another terminal:

```bash
./scripts/stop-dev.sh
```

## Typical Workflow

1. Start Ollama and run `./scripts/dev.sh`.
2. Open `http://127.0.0.1:5173`.
3. Upload a bank, WeChat Pay, Alipay, Excel, or CSV statement from Home, Dashboard, or Transactions.
4. Wait for the classification progress banner to finish.
5. Review results in Transactions, manually fix categories when needed, and optionally rerun AI classification.
6. Open Dashboard for monthly analysis and AI-generated summary.
7. Use AI Query to ask Chinese questions such as `上个月我的总支出是多少？`.
8. Use Categories to adjust the two-level classification tree.

## Custom Ports

Use custom ports when the defaults are taken:

```bash
BACKEND_PORT=8010 FRONTEND_PORT=5174 ./scripts/dev.sh
```

Then open:

```text
http://127.0.0.1:5174
```

The script passes the matching backend API URL to Vite automatically.

## Manual Startup

If you prefer separate terminals, start the backend:

```bash
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Start the frontend:

```bash
cd frontend
VITE_API_BASE_URL=http://127.0.0.1:8000/api npm run dev -- --host 127.0.0.1 --port 5173
```

## Health Checks

Backend health:

```bash
curl http://127.0.0.1:8000/api/health
```

System health:

```bash
curl http://127.0.0.1:8000/api/system/health
```

Ollama models:

```bash
ollama list
```

In the app, the Settings page also shows database, Ollama, and model status.

## Troubleshooting

If the backend says the port is already in use:

```text
address already in use
```

Run:

```bash
./scripts/stop-dev.sh
./scripts/dev.sh
```

If classification fails and transactions stay uncategorized, check Ollama first:

```bash
ollama list
```

If `ollama list` cannot connect, start Ollama:

```bash
ollama serve
```

If `ollama list` works but the app still cannot classify, restart the backend so it reconnects to Ollama:

```bash
./scripts/stop-dev.sh
./scripts/dev.sh
```

If the configured model is missing, Settings will show the configured model and active fallback model. Pull the configured model or set `OLLAMA_MODEL` to an installed model.

If you see `operation not permitted` while starting ports from a sandboxed tool, run `./scripts/dev.sh` directly in macOS Terminal. Local port binding and local Ollama access may be blocked inside sandboxed execution environments.
