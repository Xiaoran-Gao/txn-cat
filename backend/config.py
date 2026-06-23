import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'txncatai.db'}")
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "180"))
OLLAMA_BATCH_SIZE = int(os.getenv("OLLAMA_BATCH_SIZE", "4"))
OLLAMA_RETRY_BATCH_SIZE = int(os.getenv("OLLAMA_RETRY_BATCH_SIZE", "2"))
OLLAMA_BATCH_WORKERS = int(os.getenv("OLLAMA_BATCH_WORKERS", "1"))
OLLAMA_MAX_PARALLEL = int(os.getenv("OLLAMA_MAX_PARALLEL", "1"))
OLLAMA_REVIEW_LOW_CONFIDENCE = int(os.getenv("OLLAMA_REVIEW_LOW_CONFIDENCE", "80"))
OLLAMA_REVIEW_SAMPLE_RATE = float(os.getenv("OLLAMA_REVIEW_SAMPLE_RATE", "0"))
OLLAMA_MAX_RETRIES = int(os.getenv("OLLAMA_MAX_RETRIES", "5"))
MAX_CORRECTION_EXAMPLES = int(os.getenv("MAX_CORRECTION_EXAMPLES", "20"))
