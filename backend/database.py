import sqlite3
from contextlib import contextmanager
from config import DATABASE_URL

# Extract file path from sqlite:/// URL
_db_path = DATABASE_URL.replace("sqlite:///", "")


def get_db():
    conn = sqlite3.connect(_db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
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

        CREATE TABLE IF NOT EXISTS correction_examples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_description TEXT NOT NULL,
            display_description TEXT NOT NULL,
            category_id INTEGER NOT NULL REFERENCES categories(id),
            subcategory_id INTEGER REFERENCES categories(id),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS credit_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            issuer TEXT,
            account_name TEXT NOT NULL,
            statement_day INTEGER NOT NULL CHECK(statement_day BETWEEN 1 AND 31),
            due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
            reminder_days INTEGER NOT NULL DEFAULT 3 CHECK(reminder_days >= 0),
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS credit_card_statement_marks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
            statement_date DATE NOT NULL,
            marked_paid INTEGER NOT NULL DEFAULT 1,
            note TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(card_id, statement_date)
        );

        CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category_id);
        CREATE INDEX IF NOT EXISTS idx_txn_subcategory ON transactions(subcategory_id);
        CREATE INDEX IF NOT EXISTS idx_txn_categorized ON transactions(is_categorized);
        CREATE INDEX IF NOT EXISTS idx_txn_history_exact
            ON transactions(raw_description, raw_product_info, is_categorized, category_id);
        CREATE INDEX IF NOT EXISTS idx_txn_merchant_history
            ON transactions(merchant_canonical, is_categorized, category_id, date);
        CREATE INDEX IF NOT EXISTS idx_correction_raw_description
            ON correction_examples(raw_description, created_at);
        CREATE INDEX IF NOT EXISTS idx_credit_cards_account_name
            ON credit_cards(account_name);
        CREATE INDEX IF NOT EXISTS idx_credit_card_marks_card_statement
            ON credit_card_statement_marks(card_id, statement_date);
        """)

        columns = [row["name"] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()]
        if "account_name" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN account_name TEXT")
        if "payment_channel" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN payment_channel TEXT")
        if "display_description" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN display_description TEXT")
            conn.execute(
                """UPDATE transactions
                   SET display_description = raw_description
                   WHERE display_description IS NULL OR display_description = ''"""
            )
        conn.execute(
            """UPDATE transactions
               SET display_description = raw_description
               WHERE display_description IS NULL OR display_description = ''"""
        )
        if "display_description_source" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN display_description_source TEXT DEFAULT 'rule'")
            conn.execute(
                """UPDATE transactions
                   SET display_description_source = 'rule'
                   WHERE display_description_source IS NULL OR display_description_source = ''"""
            )
        if "raw_product_info" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN raw_product_info TEXT")
        if "display_product_info" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN display_product_info TEXT")
        if "classification_confidence" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN classification_confidence INTEGER")
        if "classification_review_status" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN classification_review_status TEXT")
        if "classification_review_reason" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN classification_review_reason TEXT")
        if "merchant_canonical" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN merchant_canonical TEXT")
