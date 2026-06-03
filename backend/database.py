import sqlite3
from contextlib import contextmanager
from config import DATABASE_URL

# Extract file path from sqlite:/// URL
_db_path = DATABASE_URL.replace("sqlite:///", "")


def get_db():
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db_connection():
    conn = get_db()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with db_connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
            UNIQUE(name, parent_id)
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date DATE NOT NULL,
            raw_description TEXT NOT NULL,
            cleaned_description TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'CNY',
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            subcategory_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            source TEXT DEFAULT 'import',
            is_categorized INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS merchant_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            is_regex INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS correction_examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            description TEXT NOT NULL,
            category_id INTEGER NOT NULL REFERENCES categories(id),
            subcategory_id INTEGER REFERENCES categories(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
        CREATE INDEX IF NOT EXISTS idx_txn_subcategory ON transactions(subcategory_id);
        CREATE INDEX IF NOT EXISTS idx_txn_categorized ON transactions(is_categorized);
        """)
