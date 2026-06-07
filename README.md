# txn-cat

TxnCatAI is a local-first transaction categorization app. It runs three local pieces:

- Ollama for local LLM classification
- FastAPI backend for parsing, storage, and AI calls
- Vite React frontend for the web UI

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

The default model is configured in `backend/config.py`:

```text
OLLAMA_MODEL=qwen3:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

You can override these with environment variables.

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

Ollama models:

```bash
ollama list
```

In the app, the Settings page also shows database and Ollama status.

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

If you see `operation not permitted` while starting ports from a sandboxed tool, run `./scripts/dev.sh` directly in macOS Terminal. Local port binding and local Ollama access may be blocked inside sandboxed execution environments.
