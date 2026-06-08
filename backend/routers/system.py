from fastapi import APIRouter
from database import db_connection
from services.categorizer import check_ollama
from config import OLLAMA_MODEL

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
    ollama_model_active = None
    ollama_error = None
    try:
        from services.categorizer import clear_ollama_model_cache, get_ollama_model
        clear_ollama_model_cache()
        ollama_model_active = get_ollama_model()
    except Exception as exc:
        ollama_error = str(exc)

    return {
        "database": db_ok,
        "ollama": ollama_ok,
        "ollama_model": OLLAMA_MODEL,
        "ollama_model_active": ollama_model_active,
        "ollama_error": ollama_error,
    }


@router.get("/models")
def list_models():
    from services.categorizer import clear_ollama_model_cache, get_ollama_model, list_ollama_models
    try:
        clear_ollama_model_cache()
        models = list_ollama_models()
    except Exception as exc:
        return {"models": [], "error": f"Ollama not available: {exc}"}
    active_model = get_ollama_model()
    if not active_model:
        return {"models": [], "active_model": None, "error": "No Ollama models installed"}
    if OLLAMA_MODEL not in models:
        return {
            "models": models,
            "active_model": active_model,
            "error": f"Configured model '{OLLAMA_MODEL}' is not installed; using '{active_model}'",
        }
    return {"models": models, "active_model": active_model}
