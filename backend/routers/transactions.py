from fastapi import APIRouter, UploadFile, File, HTTPException, Query, BackgroundTasks
from database import db_connection
from models import (
    TransactionCreate, TransactionUpdate, TransactionOut,
    BulkUpdate, BulkDelete, ImportResult, CategorizeResult, ClassificationJobOut,
)
from services.parser import parse_excel
from services.normalizer import normalize_description

router = APIRouter()


@router.post("/import", response_model=ImportResult)
def import_transactions(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    if not (file.filename.lower().endswith((".xlsx", ".xls", ".csv"))):
        raise HTTPException(400, "Unsupported file format. Use .xlsx, .xls, or .csv")

    try:
        transactions = parse_excel(file.file, file.filename)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse file: {str(e)}")

    imported = 0
    skipped = 0
    errors = []
    imported_ids = []
    pending_existing_ids = []

    with db_connection() as conn:
        for txn in transactions:
            try:
                display_description = normalize_description(txn["description"])
                existing = conn.execute(
                    """SELECT id, is_categorized FROM transactions
                       WHERE date = ? AND raw_description = ? AND amount = ?""",
                    (txn["date"], txn["description"], txn["amount"]),
                ).fetchone()
                if existing:
                    if not existing["is_categorized"]:
                        pending_existing_ids.append(existing["id"])
                    skipped += 1
                    continue

                conn.execute(
                    """INSERT INTO transactions
                       (date, raw_description, display_description, display_description_source, amount, account_name, payment_channel, merchant_platform)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        txn["date"],
                        txn["description"],
                        display_description,
                        "rule",
                        txn["amount"],
                        txn.get("account_name"),
                        txn.get("payment_channel"),
                        txn.get("merchant_platform"),
                    ),
                )
                imported_ids.append(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
                imported += 1
            except Exception as e:
                errors.append(f"Row error: {str(e)}")

    categorized = 0
    categorize_failed = 0
    classification_job_id = None
    categorize_ids = list(dict.fromkeys(imported_ids + pending_existing_ids))
    if categorize_ids:
        from services.classification_jobs import create_classification_job, run_classification_job
        job = create_classification_job(categorize_ids, source="upload")
        classification_job_id = job["id"]
        background_tasks.add_task(run_classification_job, classification_job_id)

    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
        "categorized": categorized,
        "categorize_failed": categorize_failed,
        "classification_job_id": classification_job_id,
        "classification_total": len(categorize_ids),
    }


@router.post("")
def create_transaction(txn: TransactionCreate):
    display_description = normalize_description(txn.description)
    with db_connection() as conn:
        cur = conn.execute(
            """INSERT INTO transactions
               (date, raw_description, display_description, display_description_source, amount, currency, account_name, payment_channel, merchant_platform, source)
               VALUES (?, ?, ?, 'rule', ?, ?, ?, ?, ?, 'manual')""",
            (
                txn.date.isoformat(),
                txn.description,
                display_description,
                txn.amount,
                txn.currency,
                txn.account_name,
                txn.payment_channel,
                txn.merchant_platform,
            ),
        )
        return {"id": cur.lastrowid, "display_description": display_description}


@router.get("")
def list_transactions(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    start_date: str | None = None,
    end_date: str | None = None,
    category_id: int | None = None,
    subcategory_id: int | None = None,
    search: str | None = None,
    is_categorized: bool | None = None,
    sort_by: str = "date",
    sort_order: str = "desc",
):
    valid_sorts = {"date", "amount", "created_at"}
    if sort_by not in valid_sorts:
        sort_by = "date"
    if sort_order not in ("asc", "desc"):
        sort_order = "desc"

    conditions = []
    params = []

    if start_date:
        conditions.append("t.date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("t.date <= ?")
        params.append(end_date)
    if category_id:
        conditions.append("t.category_id = ?")
        params.append(category_id)
    if subcategory_id:
        conditions.append("t.subcategory_id = ?")
        params.append(subcategory_id)
    if search:
        conditions.append("(t.raw_description LIKE ? OR t.display_description LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    if is_categorized is not None:
        conditions.append("t.is_categorized = ?")
        params.append(1 if is_categorized else 0)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with db_connection() as conn:
        count = conn.execute(
            f"SELECT COUNT(*) FROM transactions t {where}", params
        ).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"""SELECT t.*, c1.name as category_name, c2.name as subcategory_name
                FROM transactions t
                LEFT JOIN categories c1 ON t.category_id = c1.id
                LEFT JOIN categories c2 ON t.subcategory_id = c2.id
                {where}
                ORDER BY t.{sort_by} {sort_order}
                LIMIT ? OFFSET ?""",
            params + [per_page, offset],
        ).fetchall()

    return {
        "items": [dict(r) for r in rows],
        "total": count,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{txn_id}")
def get_transaction(txn_id: int):
    with db_connection() as conn:
        row = conn.execute(
            """SELECT t.*, c1.name as category_name, c2.name as subcategory_name
               FROM transactions t
               LEFT JOIN categories c1 ON t.category_id = c1.id
               LEFT JOIN categories c2 ON t.subcategory_id = c2.id
               WHERE t.id = ?""",
            (txn_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Transaction not found")
        return dict(row)


@router.put("/{txn_id}")
def update_transaction(txn_id: int, update: TransactionUpdate):
    with db_connection() as conn:
        existing = conn.execute(
            "SELECT * FROM transactions WHERE id = ?", (txn_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(404, "Transaction not found")

        fields = []
        params = []

        if update.date is not None:
            fields.append("date = ?")
            params.append(update.date.isoformat())
        if update.raw_description is not None:
            from services.normalizer import normalize_description
            fields.append("raw_description = ?")
            params.append(update.raw_description)
            fields.append("display_description = ?")
            params.append(normalize_description(update.raw_description))
            fields.append("display_description_source = 'rule'")
        if update.display_description is not None:
            fields.append("display_description = ?")
            params.append(update.display_description.strip() or existing["raw_description"])
            fields.append("display_description_source = 'manual'")
        if update.amount is not None:
            fields.append("amount = ?")
            params.append(update.amount)
        update_fields = getattr(update, "model_fields_set", set())
        if "account_name" in update_fields:
            fields.append("account_name = ?")
            params.append(update.account_name)
        if "payment_channel" in update_fields:
            fields.append("payment_channel = ?")
            params.append(update.payment_channel)
        if "merchant_platform" in update_fields:
            fields.append("merchant_platform = ?")
            params.append(update.merchant_platform)
        if update.category_id is not None:
            fields.append("category_id = ?")
            params.append(update.category_id)
            fields.append("is_categorized = 1")
            fields.append("classification_confidence = NULL")
            fields.append("classification_review_status = 'manual'")
            fields.append("classification_review_reason = NULL")
        if update.subcategory_id is not None:
            fields.append("subcategory_id = ?")
            params.append(update.subcategory_id)

        if fields:
            params.append(txn_id)
            conn.execute(f"UPDATE transactions SET {', '.join(fields)} WHERE id = ?", params)

        # Save correction example if user changed category
        if update.category_id is not None:
            conn.execute(
                """INSERT INTO correction_examples
                   (raw_description, display_description, category_id, subcategory_id)
                   VALUES (?, ?, ?, ?)""",
                (
                    existing["raw_description"],
                    update.display_description or existing["display_description"],
                    update.category_id,
                    update.subcategory_id,
                ),
            )

    return {"status": "ok"}


@router.delete("/{txn_id}")
def delete_transaction(txn_id: int):
    with db_connection() as conn:
        conn.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
    return {"status": "ok"}


@router.post("/bulk-update")
def bulk_update(update: BulkUpdate):
    with db_connection() as conn:
        for txn_id in update.ids:
            if update.category_id is not None:
                conn.execute(
                    """UPDATE transactions
                       SET category_id = ?,
                           subcategory_id = ?,
                           is_categorized = 1,
                           classification_confidence = NULL,
                           classification_review_status = 'manual',
                           classification_review_reason = NULL
                       WHERE id = ?""",
                    (update.category_id, update.subcategory_id, txn_id),
                )
    return {"status": "ok"}


@router.delete("/bulk-delete")
def bulk_delete(delete: BulkDelete):
    with db_connection() as conn:
        for txn_id in delete.ids:
            conn.execute("DELETE FROM transactions WHERE id = ?", (txn_id,))
    return {"status": "ok"}


@router.post("/categorize", response_model=CategorizeResult)
def categorize_all(background_tasks: BackgroundTasks):
    with db_connection() as conn:
        uncategorized = conn.execute(
            "SELECT id FROM transactions WHERE is_categorized = 0 OR category_id IS NULL"
        ).fetchall()

    if not uncategorized:
        return {"total": 0, "categorized": 0, "failed": 0, "job_id": None}

    txn_ids = [r["id"] for r in uncategorized]
    from services.classification_jobs import create_classification_job, run_classification_job
    job = create_classification_job(txn_ids, source="manual")
    background_tasks.add_task(run_classification_job, job["id"])
    return {"total": job["total"], "categorized": 0, "failed": 0, "job_id": job["id"]}


@router.get("/categorize/jobs/{job_id}", response_model=ClassificationJobOut)
def get_categorize_job(job_id: str):
    from services.classification_jobs import get_classification_job
    job = get_classification_job(job_id)
    if not job:
        raise HTTPException(404, "Classification job not found")
    return job


@router.post("/{txn_id}/categorize")
def categorize_single(txn_id: int):
    from services.categorizer import categorize_transaction

    with db_connection() as conn:
        txn = conn.execute(
            """SELECT display_description, display_description_source, raw_description, amount
               FROM transactions
               WHERE id = ?""",
            (txn_id,),
        ).fetchone()
        if not txn:
            raise HTTPException(404, "Transaction not found")

    result = categorize_transaction(txn["display_description"], txn["amount"], txn["raw_description"])
    if result.get("category_id"):
        display_description = (
            txn["display_description"]
            if txn["display_description_source"] == "manual"
            else result["display_description"]
        )
        display_description_source = txn["display_description_source"] if txn["display_description_source"] == "manual" else "llm"
        with db_connection() as conn:
            conn.execute(
                """UPDATE transactions
                   SET category_id = ?,
                       subcategory_id = ?,
                       is_categorized = 1,
                       display_description = ?,
                       display_description_source = ?,
                       classification_confidence = ?,
                       classification_review_status = ?,
                       classification_review_reason = ?
                   WHERE id = ?""",
                (
                    result["category_id"],
                    result.get("subcategory_id"),
                    display_description,
                    display_description_source,
                    result.get("classification_confidence"),
                    result.get("classification_review_status"),
                    result.get("classification_review_reason"),
                    txn_id,
                ),
            )
        return {"status": "categorized", **result}

    return {"status": "failed", "error": result.get("error", "Unknown error")}
