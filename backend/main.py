from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from seed_data import seed_default_data

app = FastAPI(title="TxnCatAI", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    init_db()
    seed_default_data()


@app.get("/api/health")
def health():
    return {"status": "ok"}


from routers import transactions, categories, analysis, query, system

app.include_router(transactions.router, prefix="/api/transactions", tags=["transactions"])
app.include_router(categories.router, prefix="/api/categories", tags=["categories"])
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(query.router, prefix="/api/query", tags=["query"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
