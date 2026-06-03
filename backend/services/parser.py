import pandas as pd
from datetime import datetime
from typing import BinaryIO


def detect_columns(df: pd.DataFrame) -> dict:
    """Detect date, description, and amount columns by header name matching."""
    date_candidates = ["交易日期", "日期", "date", "transaction date", "posting date", "记账日期", "交易时间"]
    desc_candidates = ["交易说明", "交易描述", "description", "merchant", "商户名称", "交易对方", "摘要", "用途"]
    amount_candidates = ["金额", "交易金额", "amount", "发生额", "人民币金额", "支出", "收入"]

    result = {"date_col": None, "desc_col": None, "amount_col": None}

    cols_lower = {col.lower().strip(): col for col in df.columns}

    for cand in date_candidates:
        if cand in cols_lower:
            result["date_col"] = cols_lower[cand]
            break

    for cand in desc_candidates:
        if cand in cols_lower:
            result["desc_col"] = cols_lower[cand]
            break

    for cand in amount_candidates:
        if cand in cols_lower:
            result["amount_col"] = cols_lower[cand]
            break

    # Fallback: use position-based guessing
    if result["date_col"] is None and len(df.columns) > 0:
        result["date_col"] = df.columns[0]
    if result["desc_col"] is None and len(df.columns) > 1:
        result["desc_col"] = df.columns[1]
    if result["amount_col"] is None and len(df.columns) > 2:
        result["amount_col"] = df.columns[2]

    return result


def parse_excel(file: BinaryIO, filename: str) -> list[dict]:
    """Parse an Excel or CSV file and return a list of transaction dicts."""
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(file)
    else:
        df = pd.read_excel(file, engine="openpyxl")

    cols = detect_columns(df)

    if not all(cols.values()):
        missing = [k for k, v in cols.items() if v is None]
        raise ValueError(f"Could not detect columns: {missing}")

    df[cols["date_col"]] = pd.to_datetime(df[cols["date_col"]]).dt.date
    df[cols["amount_col"]] = pd.to_numeric(df[cols["amount_col"]], errors="coerce")

    transactions = []
    for _, row in df.iterrows():
        date_val = row[cols["date_col"]]
        desc_val = str(row[cols["desc_col"]]).strip()
        amount_val = float(row[cols["amount_col"]])

        if pd.isna(date_val) or not desc_val or pd.isna(amount_val):
            continue

        transactions.append({
            "date": str(date_val),
            "description": desc_val,
            "amount": amount_val,
        })

    return transactions


def parse_columns_for_preview(file: BinaryIO, filename: str) -> dict:
    """Return column names and sample rows for the column mapping UI."""
    if filename.lower().endswith(".csv"):
        df = pd.read_csv(file)
    else:
        df = pd.read_excel(file, engine="openpyxl")

    cols = detect_columns(df)
    return {
        "columns": list(df.columns),
        "detected": cols,
        "preview": df.head(5).to_dict(orient="records"),
    }
