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


HEADER_TERMS = (
    "交易日期", "日期", "date", "transaction date", "posting date", "记账日期", "交易时间",
    "付款时间", "交易创建时间", "创建时间", "完成时间",
    "交易说明", "交易描述", "description", "merchant", "商户名称", "交易对方", "摘要", "用途",
    "商品", "商品名称", "交易类型", "备注",
    "金额", "交易金额", "amount", "发生额", "人民币金额", "支出", "收入", "收/支", "收支",
)

COLUMN_CANDIDATES = {
    "date_col": [
        "交易日期", "日期", "date", "transaction date", "posting date", "记账日期",
        "交易时间", "付款时间", "交易创建时间", "创建时间", "完成时间",
    ],
    "desc_col": [
        "交易说明", "交易描述", "description", "merchant", "商户名称", "交易对方",
        "摘要", "用途", "交易类型", "说明",
    ],
    "product_col": [
        "商品信息", "商品名称", "商品", "商品说明", "订单信息", "订单详情", "购买商品",
        "服务内容", "项目", "备注", "附言", "用途说明", "product", "item", "goods",
    ],
    "amount_col": ["金额", "交易金额", "amount", "发生额", "人民币金额", "交易额", "金额元"],
    "expense_col": ["支出", "支出金额", "借方金额", "付款金额", "消费金额"],
    "income_col": ["收入", "收入金额", "贷方金额", "收款金额", "入账金额"],
    "direction_col": ["收/支", "收支", "收入/支出", "支出/收入", "资金流向", "借贷标志"],
    "account_col": [
        "账户", "账号", "卡号", "银行卡号", "交易账户", "付款账户", "收款账户",
        "支付方式", "付款方式", "收款方式", "account", "card",
    ],
    "channel_col": ["支付渠道", "渠道", "交易渠道", "来源", "source", "channel"],
    "platform_col": ["消费平台", "商户平台", "平台", "应用", "app", "platform"],
}


def detect_csv_header(lines: list[str]) -> tuple[int, str]:
    best: tuple[int, str, int] | None = None

    for idx, line in enumerate(lines[:120]):
        delimiter = max(CSV_DELIMITERS, key=line.count)
        delimiter_count = line.count(delimiter)
        if delimiter_count < 2:
            continue

        normalized = line.lower()
        term_hits = sum(1 for term in HEADER_TERMS if term.lower() in normalized)
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


def read_excel_with_header_detection(file: BinaryIO, filename: str) -> pd.DataFrame:
    """Read Excel exports that may include bank/account preamble rows."""
    engine = "xlrd" if filename.lower().endswith(".xls") else "openpyxl"
    try:
        sheets = pd.read_excel(file, engine=engine, header=None, sheet_name=None)
    except ImportError as exc:
        raise ValueError("Reading .xls files requires xlrd. Please install backend requirements again.") from exc
    except ValueError as exc:
        if filename.lower().endswith(".xls"):
            raise ValueError("Could not read .xls file. Please re-export as .xlsx or install xlrd support.") from exc
        raise

    raw = select_transaction_sheet(sheets)
    if raw.empty:
        raise ValueError("Excel file is empty")

    header_idx = detect_excel_header(raw)
    account_name = detect_account_from_preamble(excel_preamble_lines(raw, header_idx))
    header = raw.iloc[header_idx].map(clean_excel_header)
    df = raw.iloc[header_idx + 1:].copy()
    df.columns = dedupe_columns(header)
    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    df.attrs["account_name"] = account_name
    df.attrs["payment_channel"] = detect_payment_channel(
        filename,
        "\n".join(excel_preamble_lines(raw, min(len(raw), header_idx + 20))),
    )
    return df


def select_transaction_sheet(sheets: dict[str, pd.DataFrame]) -> pd.DataFrame:
    candidates = [(name, sheet, excel_header_candidate(sheet)) for name, sheet in sheets.items() if not sheet.empty]
    if not candidates:
        raise ValueError("Excel file is empty")

    _, sheet, best = max(candidates, key=lambda item: item[2][1])
    if best[2] < 2:
        ai_sheet_name = ai_select_transaction_sheet(sheets)
        if ai_sheet_name in sheets and not sheets[ai_sheet_name].empty:
            return sheets[ai_sheet_name]
    return sheet


def clean_excel_header(value) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if text.endswith(".0"):
        return text[:-2]
    return text


def dedupe_columns(columns) -> list[str]:
    seen: dict[str, int] = {}
    result = []
    for idx, col in enumerate(columns):
        name = str(col).strip() or f"Unnamed {idx + 1}"
        seen[name] = seen.get(name, 0) + 1
        result.append(name if seen[name] == 1 else f"{name}.{seen[name] - 1}")
    return result


def excel_preamble_lines(raw: pd.DataFrame, end_idx: int) -> list[str]:
    lines = []
    for _, row in raw.iloc[:end_idx].iterrows():
        values = [str(value).strip() for value in row if not pd.isna(value) and str(value).strip()]
        if values:
            lines.append("，".join(values))
    return lines


def detect_excel_header(raw: pd.DataFrame) -> int:
    header_idx, _, semantic_hits = excel_header_candidate(raw)
    if semantic_hits >= 2:
        return header_idx

    ai_header_idx = ai_detect_excel_header(raw)
    if ai_header_idx is not None:
        return ai_header_idx

    for idx, row in raw.head(120).iterrows():
        if row.notna().sum() >= 3:
            return idx

    raise ValueError("Could not find a transaction table in Excel")


def excel_header_candidate(raw: pd.DataFrame) -> tuple[int, int, int]:
    best: tuple[int, int, int] | None = None
    for idx, row in raw.head(120).iterrows():
        values = [str(value).strip() for value in row if not pd.isna(value) and str(value).strip()]
        if len(values) < 2:
            continue
        normalized = " ".join(values).lower()
        term_hits = sum(1 for term in HEADER_TERMS if term.lower() in normalized)
        semantic_hits = semantic_header_hits(values)
        score = semantic_hits * 20 + term_hits * 5 + len(values)
        if best is None or score > best[1]:
            best = (idx, score, semantic_hits)
            if semantic_hits >= 3:
                break

    return best or (0, 0, 0)


def normalize_column_name(value) -> str:
    text = "" if pd.isna(value) else str(value).lower().strip()
    return re.sub(r"[\s\u3000,，:：()（）【】\[\]{}<>《》/\\_\-.]+", "", text)


def column_matches(col, candidates: list[str]) -> bool:
    normalized_col = normalize_column_name(col)
    if not normalized_col:
        return False
    for candidate in candidates:
        normalized_candidate = normalize_column_name(candidate)
        if not normalized_candidate:
            continue
        if normalized_col == normalized_candidate:
            return True
        if normalized_candidate in normalized_col:
            return True
    return False


def semantic_header_hits(values: list[str]) -> int:
    groups = ("date_col", "desc_col", "product_col", "amount_col", "expense_col", "income_col", "direction_col")
    hits = 0
    for group in groups:
        if any(column_matches(value, COLUMN_CANDIDATES[group]) for value in values):
            hits += 1
    return hits


def ai_select_transaction_sheet(sheets: dict[str, pd.DataFrame]) -> str | None:
    sheet_summaries = []
    for name, sheet in sheets.items():
        if sheet.empty:
            continue
        rows = excel_rows_for_llm(sheet, limit=12)
        sheet_summaries.append({
            "sheet_name": name,
            "row_count": len(sheet),
            "sample_rows": rows,
        })

    if not sheet_summaries:
        return None

    system_prompt = """你是账单 Excel 工作表识别助手。根据每个 sheet 的前几行，判断哪一个 sheet 最可能包含交易明细表。
只返回 JSON，不要解释。字段：
- sheet_name: 原始 sheet 名称或 null

交易明细表通常包含日期/时间、交易对方/商户/商品/摘要、金额/收入/支出/收支方向等列。说明页、统计页、导出说明页不要选。"""
    user_prompt = json.dumps({"sheets": sheet_summaries}, ensure_ascii=False)
    result = call_ollama_json(system_prompt, user_prompt, timeout=20)
    if not result:
        return None

    sheet_name = result.get("sheet_name")
    return sheet_name if sheet_name in sheets else None


def ai_detect_excel_header(raw: pd.DataFrame) -> int | None:
    rows = excel_rows_for_llm(raw, limit=60)
    if not rows:
        return None

    system_prompt = """你是账单 Excel 表头识别助手。根据前若干行判断交易明细表的表头行。
只返回 JSON，不要解释。字段：
- header_row_index: 表头所在行的 0-based 行号，找不到则为 null

表头行通常包含日期/时间、交易对方/商户/商品/摘要、金额/收入/支出/收支方向等列名。
不要把导出说明、账户信息、统计汇总、空行判断为表头。"""
    user_prompt = json.dumps({"rows": rows}, ensure_ascii=False)
    result = call_ollama_json(system_prompt, user_prompt, timeout=20)
    if not result:
        return None

    header_idx = result.get("header_row_index")
    if not isinstance(header_idx, int) or header_idx < 0 or header_idx >= len(raw):
        return None

    row = raw.iloc[header_idx]
    if row.notna().sum() < 2:
        return None
    return header_idx


def excel_rows_for_llm(raw: pd.DataFrame, limit: int) -> list[dict]:
    rows = []
    for idx, row in raw.head(limit).iterrows():
        values = [str(value).strip() for value in row if not pd.isna(value) and str(value).strip()]
        if values:
            rows.append({"row_index": int(idx), "values": values[:20]})
    return rows


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
字段：date_col, desc_col, product_col, amount_col, expense_col, income_col, direction_col, account_col, channel_col, platform_col。
如果金额是单列正负数，用 amount_col；如果支出/收入分列，用 expense_col/income_col。
direction_col 是金额方向列，例如“收/支”“收入/支出”“资金流向”，值可能是“收入”“支出”“+”“-”。
desc_col 是商户、交易对方、交易说明这类主描述。
product_col 是商品、商品名称、订单信息、服务内容、备注中更具体说明买了什么/用了什么服务的列。不要和 desc_col 选同一列，除非只有一个相关文本列。
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
        result.get("product_col"),
        result.get("amount_col"),
        result.get("expense_col"),
        result.get("income_col"),
        result.get("direction_col"),
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
    result = {
        "date_col": None,
        "desc_col": None,
        "product_col": None,
        "amount_col": None,
        "expense_col": None,
        "income_col": None,
        "direction_col": None,
        "account_col": None,
        "channel_col": None,
        "platform_col": None,
    }

    for key, candidates in COLUMN_CANDIDATES.items():
        result[key] = first_matching_column(df, candidates)

    result = refine_account_column(df, ai_detect_columns(df, result))

    # Fallback: use position-based guessing
    if result["date_col"] is None and len(df.columns) > 0:
        result["date_col"] = df.columns[0]
    if result["desc_col"] is None and len(df.columns) > 1:
        result["desc_col"] = df.columns[1]
    if result["desc_col"] is None and result["product_col"] is not None:
        result["desc_col"] = result["product_col"]
    if result["product_col"] == result["desc_col"]:
        result["product_col"] = None
    if result["amount_col"] is None and result["expense_col"] is None and result["income_col"] is None and len(df.columns) > 2:
        result["amount_col"] = df.columns[2]

    return result


def first_matching_column(df: pd.DataFrame, candidates: list[str]):
    exact_matches = {normalize_column_name(col): col for col in df.columns}
    for candidate in candidates:
        col = exact_matches.get(normalize_column_name(candidate))
        if col is not None:
            return col

    for col in df.columns:
        if column_matches(col, candidates):
            return col
    return None


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
        amount = parse_money(row[cols["amount_col"]])
        if amount is None:
            return None
        direction = row_direction(row, cols)
        if direction == "income":
            return -abs(amount)
        if direction == "expense":
            return abs(amount)
        return amount

    expense = parse_money(row[cols["expense_col"]]) if cols.get("expense_col") is not None else None
    income = parse_money(row[cols["income_col"]]) if cols.get("income_col") is not None else None
    if expense is not None and expense != 0:
        return abs(expense)
    if income is not None and income != 0:
        return -abs(income)
    return None


def row_direction(row, cols: dict) -> str | None:
    if cols.get("direction_col") is None:
        return None

    value = row[cols["direction_col"]]
    if pd.isna(value):
        return None

    text = str(value).strip().lower()
    if not text or text == "nan":
        return None

    if any(keyword in text for keyword in ("收入", "收款", "入账", "贷方", "credit")) or text.startswith("+"):
        return "income"
    if any(keyword in text for keyword in ("支出", "付款", "消费", "借方", "debit")) or text.startswith("-"):
        return "expense"
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


def row_text(row, col) -> str | None:
    if col is None:
        return None
    value = row[col]
    if pd.isna(value):
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def parse_excel(file: BinaryIO, filename: str) -> list[dict]:
    """Parse an Excel or CSV file and return a list of transaction dicts."""
    if filename.lower().endswith(".csv"):
        df = read_csv_with_fallback(file, filename)
    else:
        df = read_excel_with_header_detection(file, filename)

    cols = detect_columns(df)

    if not cols["date_col"] or not cols["desc_col"] or not (cols["amount_col"] or cols["expense_col"] or cols["income_col"]):
        raise ValueError("Could not detect required columns: date, description, amount")

    df[cols["date_col"]] = pd.to_datetime(df[cols["date_col"]], errors="coerce").dt.date
    account_fallback = df.attrs.get("account_name")
    channel_fallback = df.attrs.get("payment_channel")

    transactions = []
    for _, row in df.iterrows():
        date_val = row[cols["date_col"]]
        desc_val = row_text(row, cols["desc_col"]) or ""
        product_val = row_text(row, cols.get("product_col"))
        amount_val = row_amount(row, cols)
        account_val = row_account(row, cols, account_fallback)
        channel_val = row_channel(row, cols, channel_fallback)
        platform_val = row_platform(
            row,
            cols,
            " ".join(value for value in (desc_val, product_val or "") if value),
        )

        if pd.isna(date_val) or not desc_val or amount_val is None or pd.isna(amount_val):
            continue

        transactions.append({
            "date": str(date_val),
            "description": desc_val,
            "product_info": product_val,
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
        df = read_excel_with_header_detection(file, filename)

    cols = detect_columns(df)
    return {
        "columns": list(df.columns),
        "detected": cols,
        "preview": df.head(5).to_dict(orient="records"),
    }
