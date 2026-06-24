from datetime import date

from fastapi import APIRouter, HTTPException, Query

from database import db_connection
from models import (
    CreditCardCreate,
    CreditCardOut,
    CreditCardReminderOut,
    CreditCardStatementMarkCreate,
    CreditCardUpdate,
)
from services.credit_cards import get_card_reminder

router = APIRouter()


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _row_to_card(row) -> dict:
    card = dict(row)
    card["is_active"] = bool(card["is_active"])
    return card


@router.get("", response_model=list[CreditCardOut])
def list_credit_cards():
    with db_connection() as conn:
        rows = conn.execute(
            """SELECT *
               FROM credit_cards
               ORDER BY is_active DESC, issuer, name, id"""
        ).fetchall()
        return [_row_to_card(row) for row in rows]


@router.get("/account-options")
def credit_card_account_options():
    with db_connection() as conn:
        account_rows = conn.execute(
            """SELECT account_name, COUNT(*) as transaction_count
               FROM transactions
               WHERE account_name IS NOT NULL
                 AND account_name != ''
               GROUP BY account_name
               ORDER BY transaction_count DESC, account_name"""
        ).fetchall()
        card_rows = conn.execute(
            """SELECT account_name
               FROM credit_cards
               WHERE account_name IS NOT NULL
                 AND account_name != ''"""
        ).fetchall()

    accounts = [row["account_name"] for row in account_rows]
    used_accounts = [row["account_name"] for row in card_rows]
    used = set(used_accounts)
    return {
        "accounts": accounts,
        "used_accounts": used_accounts,
        "available_accounts": [account for account in accounts if account not in used],
    }


@router.post("", response_model=CreditCardOut)
def create_credit_card(card: CreditCardCreate):
    name = _clean_text(card.name)
    account_name = _clean_text(card.account_name)
    if not name or not account_name:
        raise HTTPException(400, "Card name and account name are required")

    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO credit_cards
               (name, issuer, account_name, statement_day, due_day, reminder_days, is_active)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                name,
                _clean_text(card.issuer),
                account_name,
                card.statement_day,
                card.due_day,
                card.reminder_days,
                1 if card.is_active else 0,
            ),
        )
        row = conn.execute("SELECT * FROM credit_cards WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _row_to_card(row)


@router.put("/{card_id}", response_model=CreditCardOut)
def update_credit_card(card_id: int, update: CreditCardUpdate):
    with db_connection() as conn:
        existing = conn.execute("SELECT * FROM credit_cards WHERE id = ?", (card_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Credit card not found")

        fields = []
        params = []
        update_fields = getattr(update, "model_fields_set", set())

        if "name" in update_fields:
            name = _clean_text(update.name)
            if not name:
                raise HTTPException(400, "Card name is required")
            fields.append("name = ?")
            params.append(name)
        if "issuer" in update_fields:
            fields.append("issuer = ?")
            params.append(_clean_text(update.issuer))
        if "account_name" in update_fields:
            account_name = _clean_text(update.account_name)
            if not account_name:
                raise HTTPException(400, "Account name is required")
            fields.append("account_name = ?")
            params.append(account_name)
        if update.statement_day is not None:
            fields.append("statement_day = ?")
            params.append(update.statement_day)
        if update.due_day is not None:
            fields.append("due_day = ?")
            params.append(update.due_day)
        if update.reminder_days is not None:
            fields.append("reminder_days = ?")
            params.append(update.reminder_days)
        if update.is_active is not None:
            fields.append("is_active = ?")
            params.append(1 if update.is_active else 0)

        if fields:
            fields.append("updated_at = CURRENT_TIMESTAMP")
            params.append(card_id)
            conn.execute(f"UPDATE credit_cards SET {', '.join(fields)} WHERE id = ?", params)

        row = conn.execute("SELECT * FROM credit_cards WHERE id = ?", (card_id,)).fetchone()
        return _row_to_card(row)


@router.delete("/{card_id}")
def delete_credit_card(card_id: int):
    with db_connection() as conn:
        existing = conn.execute("SELECT id FROM credit_cards WHERE id = ?", (card_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Credit card not found")
        conn.execute("DELETE FROM credit_cards WHERE id = ?", (card_id,))
    return {"status": "ok"}


@router.get("/reminders", response_model=list[CreditCardReminderOut])
def credit_card_reminders(as_of: date | None = Query(None, description="YYYY-MM-DD")):
    today = as_of or date.today()
    with db_connection() as conn:
        rows = conn.execute(
            """SELECT *
               FROM credit_cards
               WHERE is_active = 1
               ORDER BY issuer, name, id"""
        ).fetchall()
        reminders = [get_card_reminder(conn, _row_to_card(row), today) for row in rows]
        return sorted(reminders, key=lambda item: (item["status"] not in {"overdue", "due_soon"}, item["days_until_due"]))


@router.post("/{card_id}/statement-marks")
def mark_credit_card_statement(card_id: int, mark: CreditCardStatementMarkCreate):
    with db_connection() as conn:
        existing = conn.execute("SELECT id FROM credit_cards WHERE id = ?", (card_id,)).fetchone()
        if not existing:
            raise HTTPException(404, "Credit card not found")
        conn.execute(
            """INSERT INTO credit_card_statement_marks
               (card_id, statement_date, marked_paid, note)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(card_id, statement_date) DO UPDATE SET
                   marked_paid = excluded.marked_paid,
                   note = excluded.note,
                   updated_at = CURRENT_TIMESTAMP""",
            (
                card_id,
                mark.statement_date.isoformat(),
                1 if mark.marked_paid else 0,
                _clean_text(mark.note),
            ),
        )
    return {"status": "ok"}
