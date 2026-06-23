import re


# Common noise patterns in Chinese bank transaction descriptions.
# These are purely mechanical removals — no semantic replacement.
# The LLM classifier handles semantic display-description generation downstream.
NOISE_PATTERNS = [
    r"\d{8,}",                        # long digit sequences (transaction IDs, ref numbers)
    r"\d{4}-\d{2}-\d{2}",            # dates
    r"消费$",                          # suffix: 消费
    r"支出$",                          # suffix: 支出
    r"快捷支付",                        # 快捷支付
    r"网上支付",                        # 网上支付
    r"银联在线支付",                     # 银联在线支付
    r"二维码支付",                       # 二维码支付
    r"扫码支付",                        # 扫码支付
    r"跨行转账",                        # 跨行转账
    r"转账$",                          # 转账 (only at end — avoid removing mid-description)
    r"代扣",                           # 代扣
    r"\(消费\)",                       # (消费)
    r"（消费）",                        # （消费）
    r"\s+",                           # collapse whitespace
]


def normalize_description(raw: str) -> str:
    """Pre-clean a raw transaction description by stripping mechanical noise.
    This is a fast, deterministic pre-filter. The LLM Normalizer agent
    handles the remaining semantic extraction during categorization."""

    cleaned = raw.strip()

    for pattern in NOISE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned)

    cleaned = cleaned.strip()

    # Remove leading/trailing punctuation and separators left by stripped noise
    cleaned = re.sub(r"^[,，。、\s\-—]+", "", cleaned)
    cleaned = re.sub(r"[,，。、\s\-—]+$", "", cleaned)

    return cleaned or raw


def normalize_product_info(raw: str | None) -> str | None:
    """Clean product/order detail while preserving the useful purchase signal."""
    if raw is None:
        return None

    text = str(raw).strip()
    if not text or text.lower() == "nan":
        return None

    cleaned = text
    product_noise = [
        r"订单号[:：]?\s*[\w\-]+",
        r"交易单号[:：]?\s*[\w\-]+",
        r"流水号[:：]?\s*[\w\-]+",
        r"\b\d{10,}\b",
        r"\d{4}-\d{1,2}-\d{1,2}",
        r"\d{1,2}月\d{1,2}日",
        r"\d{1,2}:\d{2}(?::\d{2})?",
        r"\s+",
    ]
    for pattern in product_noise:
        cleaned = re.sub(pattern, " ", cleaned)

    cleaned = re.sub(r"^[,，。、\s\-—:：]+", "", cleaned)
    cleaned = re.sub(r"[,，。、\s\-—:：]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    return cleaned or None


def canonical_merchant(
    raw_description: str | None,
    display_description: str | None = None,
    product_info: str | None = None,
) -> str | None:
    """Return a stable merchant key for aggregation without changing display text."""
    candidates = _merchant_candidates(raw_description, display_description, product_info)
    if not candidates:
        return None

    for candidate in candidates:
        merchant = _merchant_candidate(candidate)
        if merchant:
            return merchant
    return None


def _merchant_candidates(*values: str | None) -> list[str]:
    candidates = []
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if not text or text.lower() == "nan":
            continue
        parts = re.split(r"\s+", text)
        candidates.extend(part for part in parts if part)
    return sorted(candidates, key=_merchant_candidate_score, reverse=True)


def _merchant_candidate_score(text: str) -> tuple[int, int]:
    score = 0
    if re.search(r"(医院|诊所|药房|药店|餐厅|饭店|咖啡|超市|便利店|商场|百货|酒店|影院)$", text):
        score += 4
    if re.search(r"[（(].*?[）)]", text):
        score += 2
    if any(marker in text for marker in ("·", "&", "＆", "/", "-")):
        score += 1
    if re.search(r"(公司|集团|有限责任公司|股份有限公司|有限公司)$", text):
        score -= 2
    if re.search(r"(订单|单号|流水|支付|缴费|充值|转账|还款|退款|付款|收款|扫码)", text):
        score -= 3
    if re.fullmatch(r"[\d\W_]+", text):
        score -= 10
    return score, min(len(text), 30)


def _merchant_candidate(text: str) -> str | None:
    cleaned = normalize_description(text)
    cleaned = re.sub(r"[（(].*?[）)]", "", cleaned)
    cleaned = re.split(r"[·&＆/]", cleaned, maxsplit=1)[0]
    cleaned = re.sub(r"[-_—].*$", "", cleaned)
    cleaned = re.sub(r"\d+$", "", cleaned)
    cleaned = re.sub(
        r"(有限责任公司|股份有限公司|有限公司|分公司|门店|店铺|餐厅|快餐|餐饮|外卖|扫码付|付款|收款)$",
        "",
        cleaned,
    )
    cleaned = re.sub(r"\s+", "", cleaned)
    cleaned = cleaned.strip(" ,，。、:：;；-—_")
    return cleaned or None
