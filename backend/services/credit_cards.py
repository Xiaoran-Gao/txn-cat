import calendar
import re
from datetime import date


REMINDER_LABELS = {
    "paid": "已还款",
    "overdue": "已逾期",
    "due_soon": "即将到期",
    "upcoming": "待还款",
    "no_bill": "本期无账单",
}


def clamp_day(year: int, month: int, day: int) -> date:
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last_day))


def add_months(value: date, months: int) -> date:
    month_index = value.year * 12 + value.month - 1 + months
    year = month_index // 12
    month = month_index % 12 + 1
    return clamp_day(year, month, value.day)


def statement_date_for_month(year: int, month: int, statement_day: int) -> date:
    return clamp_day(year, month, statement_day)


def due_date_for_statement(statement_date: date, statement_day: int, due_day: int) -> date:
    if due_day > statement_day:
        return clamp_day(statement_date.year, statement_date.month, due_day)
    next_month = add_months(date(statement_date.year, statement_date.month, 1), 1)
    return clamp_day(next_month.year, next_month.month, due_day)


def statement_cycle(statement_date: date, statement_day: int) -> tuple[date, date]:
    previous_month = add_months(date(statement_date.year, statement_date.month, 1), -1)
    return (
        statement_date_for_month(previous_month.year, previous_month.month, statement_day),
        statement_date,
    )


def current_statement_date(as_of: date, statement_day: int) -> date:
    current_month_statement = statement_date_for_month(as_of.year, as_of.month, statement_day)
    if current_month_statement <= as_of:
        return current_month_statement
    previous_month = add_months(date(as_of.year, as_of.month, 1), -1)
    return statement_date_for_month(previous_month.year, previous_month.month, statement_day)


def card_text_hints(card: dict) -> list[str]:
    values = [
        str(card.get("name") or "").strip(),
        str(card.get("issuer") or "").strip(),
        str(card.get("account_name") or "").strip(),
    ]
    tail_match = re.search(r"(?:尾号\s*)?(\d{4})(?!\d)", values[-1])
    if tail_match:
        values.append(tail_match.group(1))
    return [value for value in dict.fromkeys(values) if value]


def estimate_statement_amount(conn, card: dict, previous_statement_date: date, statement_date: date) -> float:
    row = conn.execute(
        """SELECT COALESCE(SUM(amount), 0) as total
           FROM transactions
           WHERE account_name = ?
             AND date > ?
             AND date <= ?""",
        (card["account_name"], previous_statement_date.isoformat(), statement_date.isoformat()),
    ).fetchone()
    return round(max(float(row["total"] or 0), 0), 2)


def recognized_paid_amount(conn, card: dict, statement_date: date, due_date: date) -> float:
    hints = card_text_hints(card)
    text_conditions = []
    params: list[str] = [statement_date.isoformat(), due_date.isoformat()]
    for hint in hints:
        like = f"%{hint}%"
        text_conditions.append(
            "(t.raw_description LIKE ? OR t.display_description LIKE ? OR COALESCE(t.raw_product_info, '') LIKE ? OR COALESCE(t.display_product_info, '') LIKE ?)"
        )
        params.extend([like, like, like, like])

    hint_sql = " OR ".join(text_conditions) if text_conditions else "0"
    rows = conn.execute(
        f"""SELECT COALESCE(SUM(ABS(t.amount)), 0) as total
            FROM transactions t
            LEFT JOIN categories c1 ON t.category_id = c1.id
            LEFT JOIN categories c2 ON t.subcategory_id = c2.id
            WHERE t.date >= ?
              AND t.date <= ?
              AND t.amount != 0
              AND (
                c1.name = '信用卡还款'
                OR c2.name = '信用卡还款'
                OR {hint_sql}
              )""",
        params,
    ).fetchone()
    return round(float(rows["total"] or 0), 2)


def is_marked_paid(conn, card_id: int, statement_date: date) -> bool:
    row = conn.execute(
        """SELECT marked_paid
           FROM credit_card_statement_marks
           WHERE card_id = ? AND statement_date = ?""",
        (card_id, statement_date.isoformat()),
    ).fetchone()
    return bool(row and row["marked_paid"])


def reminder_status(
    as_of: date,
    due_date: date,
    estimated_statement_amount: float,
    recognized_paid_amount_value: float,
    marked_paid: bool,
    reminder_days: int,
) -> tuple[str, float, int]:
    remaining = round(max(estimated_statement_amount - recognized_paid_amount_value, 0), 2)
    days_until_due = (due_date - as_of).days
    if marked_paid or (estimated_statement_amount > 0 and remaining <= 0):
        return "paid", 0, days_until_due
    if estimated_statement_amount <= 0:
        return "no_bill", 0, days_until_due
    if days_until_due < 0:
        return "overdue", remaining, days_until_due
    if days_until_due <= reminder_days:
        return "due_soon", remaining, days_until_due
    return "upcoming", remaining, days_until_due


def build_cycle_reminder(conn, card: dict, statement_date: date, as_of: date) -> dict:
    previous_statement_date, current_statement_date = statement_cycle(
        statement_date,
        int(card["statement_day"]),
    )
    due_date = due_date_for_statement(
        current_statement_date,
        int(card["statement_day"]),
        int(card["due_day"]),
    )
    estimated = estimate_statement_amount(conn, card, previous_statement_date, current_statement_date)
    paid_amount = recognized_paid_amount(conn, card, current_statement_date, due_date)
    marked_paid = is_marked_paid(conn, int(card["id"]), current_statement_date)
    status, remaining, days_until_due = reminder_status(
        as_of,
        due_date,
        estimated,
        paid_amount,
        marked_paid,
        int(card["reminder_days"]),
    )
    return {
        "card": dict(card),
        "previous_statement_date": previous_statement_date.isoformat(),
        "statement_date": current_statement_date.isoformat(),
        "due_date": due_date.isoformat(),
        "estimated_statement_amount": estimated,
        "recognized_paid_amount": paid_amount,
        "remaining_amount": remaining,
        "days_until_due": days_until_due,
        "status": status,
        "status_label": REMINDER_LABELS[status],
        "is_marked_paid": marked_paid,
        "estimate_source": "transactions",
    }


def get_card_reminder(conn, card: dict, as_of: date) -> dict:
    statement_date = current_statement_date(as_of, int(card["statement_day"]))
    return build_cycle_reminder(conn, card, statement_date, as_of)
