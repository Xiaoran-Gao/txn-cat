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
