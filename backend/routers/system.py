from fastapi import APIRouter
from database import db_connection
from services.categorizer import check_ollama
from config import OLLAMA_BASE_URL, OLLAMA_MODEL
from models import MerchantMappingCreate

router = APIRouter()


@router.get("/health")
def health():
    db_ok = True
    try:
        with db_connection() as conn:
            conn.execute("SELECT 1")
    except Exception:
        db_ok = False

    ollama_ok = check_ollama()

    return {
        "database": db_ok,
        "ollama": ollama_ok,
        "ollama_model": OLLAMA_MODEL,
    }


@router.get("/models")
def list_models():
    from services.categorizer import check_ollama
    if not check_ollama():
        return {"models": [], "error": "Ollama not available"}
    import ollama
    client = ollama.Client(host=OLLAMA_BASE_URL)
    models = client.list()
    return {"models": [m.get("name", str(m)) for m in models.get("models", [])]}


# Merchant mappings
@router.get("/merchants")
def list_merchants():
    with db_connection() as conn:
        rows = conn.execute(
            "SELECT id, pattern, display_name, is_regex FROM merchant_mappings ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/merchants")
def create_merchant(m: MerchantMappingCreate):
    with db_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO merchant_mappings (pattern, display_name, is_regex) VALUES (?, ?, ?)",
                (m.pattern, m.display_name, 1 if m.is_regex else 0),
            )
            return {"id": cur.lastrowid}
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(400, "Mapping already exists")


@router.delete("/merchants/{mapping_id}")
def delete_merchant(mapping_id: int):
    with db_connection() as conn:
        conn.execute("DELETE FROM merchant_mappings WHERE id = ?", (mapping_id,))
    return {"status": "ok"}
