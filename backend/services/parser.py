import csv
import io
import json
import re
import urllib.request
import pandas as pd
from datetime import datetime
from typing import BinaryIO
from config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT

CSV_ENCODINGS = ("utf-8-sig", "utf-8", "gb18030", "gbk", "big5", "latin1")
CSV_DELIMITERS = (",", "\t", ";", "|")
CHANNEL_KEYWORDS = [
    ("支付宝", ["支付宝", "alipay"]),
    ("微信支付", ["微信", "wechat", "零钱", "财付通"]),
    ("招商银行", ["招商银行", "招行", "cmb"]),
    ("中国银行", ["中国银行", "boc"]),
    ("工商银行", ["工商银行", "icbc"]),
    ("建设银行", ["建设银行", "ccb"]),
    ("农业银行", ["农业银行", "abc"]),
    ("交通银行", ["交通银行", "bankcomm"]),
]


def read_csv_with_fallback(file: BinaryIO, filename: str) -> pd.DataFrame:
    """Read bank-exported CSV files with locale encodings and preamble rows."""
    last_error: Exception | None = None
    for encoding in CSV_ENCODINGS:
        try:
            file.seek(0)
            text = file.read().decode(encoding)
            return read_csv_text(text, filename)
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    raise ValueError("Could not decode CSV. Please export as UTF-8 CSV or Excel .xlsx.") from last_error


def read_csv_text(text: str, filename: str) -> pd.DataFrame:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise ValueError("CSV file is empty")

    header_idx, delimiter = detect_csv_header(lines)
    account_name = detect_account_from_preamble(lines[:header_idx])
    payment_channel = detect_payment_channel(filename, "\n".join(lines[: min(len(lines), header_idx + 20)]))
    csv_text = "\n".join(lines[header_idx:])
    df = pd.read_csv(
        io.StringIO(csv_text),
        sep=delimiter,
        engine="python",
        quoting=csv.QUOTE_MINIMAL,
        on_bad_lines="skip",
    )
    df.attrs["account_name"] = account_name
    df.attrs["payment_channel"] = payment_channel
    return df


def detect_csv_header(lines: list[str]) -> tuple[int, str]:
    header_terms = (
        "交易日期", "日期", "date", "transaction date", "posting date", "记账日期", "交易时间",
        "交易说明", "交易描述", "description", "merchant", "商户名称", "交易对方", "摘要", "用途",
        "金额", "交易金额", "amount", "发生额", "人民币金额", "支出", "收入",
    )
    best: tuple[int, str, int] | None = None

    for idx, line in enumerate(lines[:120]):
        delimiter = max(CSV_DELIMITERS, key=line.count)
        delimiter_count = line.count(delimiter)
        if delimiter_count < 2:
            continue

        normalized = line.lower()
        term_hits = sum(1 for term in header_terms if term.lower() in normalized)
        score = term_hits * 10 + delimiter_count
        if best is None or score > best[2]:
            best = (idx, delimiter, score)
            if term_hits >= 3:
                break

    if best:
        return best[0], best[1]

    for idx, line in enumerate(lines[:120]):
        delimiter = max(CSV_DELIMITERS, key=line.count)
        if line.count(delimiter) >= 2:
            return idx, delimiter

    raise ValueError("Could not find a transaction table in CSV")


def detect_account_from_preamble(lines: list[str]) -> str | None:
    for line in lines:
        clean = line.strip().strip(",，")
        if not clean:
            continue
        if any(key in clean for key in ("账户", "账号", "卡号", "银行卡")):
            parts = [part.strip() for part in re.split(r"[,，:\t：]", clean) if part.strip()]
            if len(parts) >= 2:
                return parts[-1]
            return clean
    return None


def detect_payment_channel(filename: str, text: str) -> str | None:
    haystack = f"{filename}\n{text}".lower()
    for channel, keywords in CHANNEL_KEYWORDS:
        if any(keyword.lower() in haystack for keyword in keywords):
            return channel
    return None


def call_ollama_json(system_prompt: str, user_prompt: str, timeout: float = 45) -> dict | None:
    payload = json.dumps({
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 256},
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=min(timeout, OLLAMA_TIMEOUT)) as res:
            response = json.loads(res.read().decode("utf-8"))
        content = response["message"]["content"]
        match = re.search(r"\{.*\}", content, flags=re.S)
        return json.loads(match.group(0)) if match else None
    except Exception:
        return None


def ai_detect_columns(df: pd.DataFrame, result: dict) -> dict:
    sample = df.head(8).astype(str).to_dict(orient="records")
    system_prompt = """你是账单表格列映射助手。根据列名和样本行判断每一列的语义。
只返回 JSON，值必须是原始列名或 null。不要解释。
字段：date_col, desc_col, amount_col, expense_col, income_col, account_col, channel_col。
如果金额是单列正负数，用 amount_col；如果支出/收入分列，用 expense_col/income_col。"""
    user_prompt = json.dumps({
        "columns": [str(c) for c in df.columns],
        "sample_rows": sample,
    }, ensure_ascii=False)
    mapping = call_ollama_json(system_prompt, user_prompt)
    if not mapping:
        return result

    valid_cols = {str(c): c for c in df.columns}
    for key in result:
        value = mapping.get(key)
        if value in valid_cols:
            result[key] = valid_cols[value]
    return result


def detect_columns(df: pd.DataFrame) -> dict:
    """Detect date, description, and amount columns by header name matching."""
    date_candidates = ["交易日期", "日期", "date", "transaction date", "posting date", "记账日期", "交易时间"]
    desc_candidates = ["交易说明", "交易描述", "description", "merchant", "商户名称", "交易对方", "摘要", "用途"]
    amount_candidates = ["金额", "交易金额", "amount", "发生额", "人民币金额", "交易额"]
    expense_candidates = ["支出", "支出金额", "借方金额", "付款金额"]
    income_candidates = ["收入", "收入金额", "贷方金额", "收款金额"]
    account_candidates = ["账户", "账号", "卡号", "银行卡号", "交易账户", "付款账户", "收款账户", "account", "card"]
    channel_candidates = ["支付渠道", "渠道", "支付方式", "交易渠道", "来源", "source", "channel"]

    result = {"date_col": None, "desc_col": None, "amount_col": None, "expense_col": None, "income_col": None, "account_col": None, "channel_col": None}

    cols_lower = {str(col).lower().strip(): col for col in df.columns}

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

    for cand in expense_candidates:
        if cand in cols_lower:
            result["expense_col"] = cols_lower[cand]
            break

    for cand in income_candidates:
        if cand in cols_lower:
            result["income_col"] = cols_lower[cand]
            break

    for cand in account_candidates:
        if cand in cols_lower:
            result["account_col"] = cols_lower[cand]
            break

    for cand in channel_candidates:
        if cand in cols_lower:
            result["channel_col"] = cols_lower[cand]
            break

    if not result["date_col"] or not result["desc_col"] or not (result["amount_col"] or result["expense_col"] or result["income_col"]):
        result = ai_detect_columns(df, result)

    # Fallback: use position-based guessing
    if result["date_col"] is None and len(df.columns) > 0:
        result["date_col"] = df.columns[0]
    if result["desc_col"] is None and len(df.columns) > 1:
        result["desc_col"] = df.columns[1]
    if result["amount_col"] is None and result["expense_col"] is None and result["income_col"] is None and len(df.columns) > 2:
        result["amount_col"] = df.columns[2]

    return result


def parse_money(value) -> float | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text in {"-", "--", "nan", "None"}:
        return None
    negative = text.startswith("(") and text.endswith(")")
    text = text.replace(",", "").replace("￥", "").replace("¥", "").replace("元", "").replace("+", "")
    text = text.strip("() ")
    amount = pd.to_numeric(text, errors="coerce")
    if pd.isna(amount):
        return None
    value_float = float(amount)
    return -value_float if negative else value_float


def row_amount(row, cols: dict) -> float | None:
    if cols.get("amount_col") is not None:
        return parse_money(row[cols["amount_col"]])

    expense = parse_money(row[cols["expense_col"]]) if cols.get("expense_col") is not None else None
    income = parse_money(row[cols["income_col"]]) if cols.get("income_col") is not None else None
    if expense is not None and expense != 0:
        return abs(expense)
    if income is not None and income != 0:
        return -abs(income)
    return None


def row_account(row, cols: dict, fallback: str | None) -> str | None:
    if cols.get("account_col") is not None:
        value = row[cols["account_col"]]
        if not pd.isna(value):
            text = str(value).strip()
            if text and text.lower() != "nan":
                return text
    return fallback


def row_channel(row, cols: dict, fallback: str | None) -> str | None:
    if cols.get("channel_col") is not None:
        value = row[cols["channel_col"]]
        if not pd.isna(value):
            text = str(value).strip()
            if text and text.lower() != "nan":
                return text
    return fallback


def parse_excel(file: BinaryIO, filename: str) -> list[dict]:
    """Parse an Excel or CSV file and return a list of transaction dicts."""
    if filename.lower().endswith(".csv"):
        df = read_csv_with_fallback(file, filename)
    else:
        df = pd.read_excel(file, engine="openpyxl")
        df.attrs["payment_channel"] = detect_payment_channel(filename, " ".join(map(str, df.columns)))

    cols = detect_columns(df)

    if not cols["date_col"] or not cols["desc_col"] or not (cols["amount_col"] or cols["expense_col"] or cols["income_col"]):
        raise ValueError("Could not detect required columns: date, description, amount")

    df[cols["date_col"]] = pd.to_datetime(df[cols["date_col"]], errors="coerce").dt.date
    account_fallback = df.attrs.get("account_name")
    channel_fallback = df.attrs.get("payment_channel")

    transactions = []
    for _, row in df.iterrows():
        date_val = row[cols["date_col"]]
        desc_val = str(row[cols["desc_col"]]).strip()
        amount_val = row_amount(row, cols)
        account_val = row_account(row, cols, account_fallback)
        channel_val = row_channel(row, cols, channel_fallback)

        if pd.isna(date_val) or not desc_val or amount_val is None or pd.isna(amount_val):
            continue

        transactions.append({
            "date": str(date_val),
            "description": desc_val,
            "amount": amount_val,
            "account_name": account_val,
            "payment_channel": channel_val,
        })

    return transactions


def parse_columns_for_preview(file: BinaryIO, filename: str) -> dict:
    """Return column names and sample rows for the column mapping UI."""
    if filename.lower().endswith(".csv"):
        df = read_csv_with_fallback(file, filename)
    else:
        df = pd.read_excel(file, engine="openpyxl")

    cols = detect_columns(df)
    return {
        "columns": list(df.columns),
        "detected": cols,
        "preview": df.head(5).to_dict(orient="records"),
    }
