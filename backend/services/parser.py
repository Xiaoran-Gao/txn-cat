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

BANK_KEYWORDS = [
    ("招商银行", ["招商银行", "招行", "cmb"]),
    ("中国银行", ["中国银行", "boc"]),
    ("工商银行", ["工商银行", "工行", "icbc"]),
    ("建设银行", ["建设银行", "建行", "ccb"]),
    ("农业银行", ["农业银行", "农行", "abc"]),
    ("交通银行", ["交通银行", "交行", "bankcomm"]),
    ("浦发银行", ["浦发银行", "浦发"]),
    ("中信银行", ["中信银行", "中信"]),
    ("兴业银行", ["兴业银行", "兴业"]),
    ("民生银行", ["民生银行", "民生"]),
    ("广发银行", ["广发银行", "广发"]),
    ("平安银行", ["平安银行", "平安"]),
    ("光大银行", ["光大银行", "光大"]),
    ("邮储银行", ["邮储银行", "邮政储蓄"]),
]

PLATFORM_KEYWORDS = [
    ("美团", ["美团", "meituan"]),
    ("饿了么", ["饿了么", "eleme"]),
    ("滴滴", ["滴滴", "didi"]),
    ("淘宝", ["淘宝", "taobao"]),
    ("天猫", ["天猫", "tmall"]),
    ("京东", ["京东", "jd.com", "jingdong"]),
    ("拼多多", ["拼多多", "pinduoduo"]),
    ("抖音", ["抖音", "douyin"]),
    ("小红书", ["小红书", "xiaohongshu"]),
    ("携程", ["携程", "ctrip", "trip.com"]),
    ("高德", ["高德", "amap"]),
]

ACCOUNT_VALUE_KEYWORDS = (
    "余额", "零钱", "花呗", "余额宝", "银行卡", "信用卡", "储蓄卡", "借记卡",
    "尾号", "卡尾号", "末四位", "后四位",
)
ACCOUNT_NAME_HINTS = ("账户", "付款", "收款", "支付", "方式", "account", "method", "card")
ACCOUNT_ID_HINTS = ("账号", "手机号", "手机", "账户号", "用户", "登录", "phone", "mobile", "id")


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
                return normalize_account_name(parts[-1])
            return normalize_account_name(clean)
    return None


def detect_payment_channel(filename: str, text: str) -> str | None:
    haystack = f"{filename}\n{text}".lower()
    for channel, keywords in CHANNEL_KEYWORDS:
        if any(keyword.lower() in haystack for keyword in keywords):
            return channel
    return None


def detect_bank_name(text: str) -> str | None:
    haystack = text.lower()
    for bank, keywords in BANK_KEYWORDS:
        if any(keyword.lower() in haystack for keyword in keywords):
            return bank
    return None


def extract_card_tail(text: str) -> str | None:
    tail_match = re.search(r"(?:尾号|末四位|后四位|卡尾号)\D*(\d{4})", text)
    if tail_match:
        return tail_match.group(1)

    digit_groups = re.findall(r"\d[\d\s*·.-]*\d", text)
    for group in reversed(digit_groups):
        digits = re.sub(r"\D", "", group)
        if len(digits) >= 4:
            return digits[-4:]
    return None


def normalize_account_name(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None

    bank = detect_bank_name(text)
    tail = extract_card_tail(text)
    if bank and tail:
        return f"{bank}（尾号 {tail}）"
    return text


def detect_merchant_platform(text: str) -> str | None:
    haystack = text.lower()
    for platform, keywords in PLATFORM_KEYWORDS:
        if any(keyword.lower() in haystack for keyword in keywords):
            return platform
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
字段：date_col, desc_col, amount_col, expense_col, income_col, account_col, channel_col, platform_col。
如果金额是单列正负数，用 amount_col；如果支出/收入分列，用 expense_col/income_col。
account_col 是实际扣款或入账账户，例如银行卡、信用卡、微信零钱、支付宝余额、花呗，列名可能表达为收付款方式。
channel_col 是支付通道或机构，例如微信、支付宝、银行渠道，不要和 account_col 混淆。
platform_col 是消费平台或商户应用，例如美团、饿了么、滴滴、淘宝。"""
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


def text_values_for_score(df: pd.DataFrame, col) -> list[str]:
    values = []
    for value in df[col].head(20):
        if pd.isna(value):
            continue
        text = str(value).strip()
        if text and text.lower() != "nan":
            values.append(text)
    return values


def is_account_identifier(text: str) -> bool:
    compact = re.sub(r"\D", "", text)
    if re.fullmatch(r"1\d{10}", compact):
        return True
    if len(compact) >= 8 and len(compact) == len(re.sub(r"\s", "", text)):
        return True
    return False


def account_value_score(text: str) -> float:
    score = 0.0
    if any(keyword in text for keyword in ACCOUNT_VALUE_KEYWORDS):
        score += 3.0
    if detect_bank_name(text):
        score += 2.5
    if extract_card_tail(text):
        score += 1.0
    if is_account_identifier(text):
        score -= 4.0
    return score


def account_column_score(df: pd.DataFrame, col) -> float:
    name = str(col).lower()
    score = 0.0
    if any(hint.lower() in name for hint in ACCOUNT_NAME_HINTS):
        score += 1.0
    if any(hint.lower() in name for hint in ACCOUNT_ID_HINTS):
        score -= 2.0

    values = text_values_for_score(df, col)
    if not values:
        return score - 1.0

    value_scores = [account_value_score(value) for value in values]
    return score + sum(value_scores) / len(value_scores)


def refine_account_column(df: pd.DataFrame, result: dict) -> dict:
    excluded = {
        result.get("date_col"),
        result.get("desc_col"),
        result.get("amount_col"),
        result.get("expense_col"),
        result.get("income_col"),
        result.get("platform_col"),
    }
    candidates = [col for col in df.columns if col not in excluded]
    if not candidates:
        return result

    best_col = max(candidates, key=lambda col: account_column_score(df, col))
    best_score = account_column_score(df, best_col)
    current_col = result.get("account_col")
    current_score = account_column_score(df, current_col) if current_col in df.columns else -99

    if best_score > current_score + 1.5 and best_score > 0:
        result["account_col"] = best_col
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
    platform_candidates = ["消费平台", "商户平台", "平台", "应用", "app", "platform"]

    result = {
        "date_col": None,
        "desc_col": None,
        "amount_col": None,
        "expense_col": None,
        "income_col": None,
        "account_col": None,
        "channel_col": None,
        "platform_col": None,
    }

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

    for cand in platform_candidates:
        if cand in cols_lower:
            result["platform_col"] = cols_lower[cand]
            break

    result = refine_account_column(df, ai_detect_columns(df, result))

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
            account = normalize_account_name(str(value))
            if account:
                return account
    return normalize_account_name(fallback)


def row_channel(row, cols: dict, fallback: str | None) -> str | None:
    if cols.get("channel_col") is not None:
        value = row[cols["channel_col"]]
        if not pd.isna(value):
            text = str(value).strip()
            if text and text.lower() != "nan":
                return text
    return fallback


def row_platform(row, cols: dict, desc: str) -> str | None:
    if cols.get("platform_col") is not None:
        value = row[cols["platform_col"]]
        if not pd.isna(value):
            text = str(value).strip()
            if text and text.lower() != "nan":
                return text
    return detect_merchant_platform(desc)


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
        platform_val = row_platform(row, cols, desc_val)

        if pd.isna(date_val) or not desc_val or amount_val is None or pd.isna(amount_val):
            continue

        transactions.append({
            "date": str(date_val),
            "description": desc_val,
            "amount": amount_val,
            "account_name": account_val,
            "payment_channel": channel_val,
            "merchant_platform": platform_val,
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
