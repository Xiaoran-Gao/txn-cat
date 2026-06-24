# TxnCatAI Frontend

This is the React/Vite frontend for TxnCatAI.

## Pages

- `/`: upload-first product home with drag-and-drop import and classification progress
- `/dashboard`: monthly spending dashboard, anomaly cards, structured analytics, and AI monthly summary
- `/transactions`: transaction workbench for import, filtering, editing, deletion, pagination, and AI recategorization
- `/query`: Chinese natural-language query chat with generated SQL and result previews
- `/categories`: two-level category tree management
- `/settings`: local database, Ollama, and active model status

## Local Development

Install dependencies:

```bash
npm install
```

Run the frontend against the local backend:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000/api npm run dev -- --host 127.0.0.1 --port 5173
```

From the project root, prefer:

```bash
./scripts/dev.sh
```

The root dev script starts both FastAPI and Vite and injects the correct `VITE_API_BASE_URL`.

## API Client

The frontend API wrapper lives in `src/api/client.ts`. It defaults to `/api`, and uses `VITE_API_BASE_URL` when provided.

## Build

```bash
npm run build
```

## Lint

```bash
npm run lint
```
