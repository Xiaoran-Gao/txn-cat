import json
import re
import time
import urllib.request
from urllib.error import HTTPError, URLError
import ollama
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from functools import lru_cache
from threading import BoundedSemaphore
from config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT,
    OLLAMA_BATCH_SIZE,
    OLLAMA_RETRY_BATCH_SIZE,
    OLLAMA_BATCH_WORKERS,
    OLLAMA_MAX_PARALLEL,
    OLLAMA_REVIEW_LOW_CONFIDENCE,
    OLLAMA_REVIEW_SAMPLE_RATE,
    OLLAMA_MAX_RETRIES,
    MAX_CORRECTION_EXAMPLES,
)
from database import db_connection

_OLLAMA_CALL_SEMAPHORE = BoundedSemaphore(max(1, OLLAMA_MAX_PARALLEL))
PRODUCT_GROUP_SIMILARITY_THRESHOLD = 0.6

UNIFIED_CLASSIFY_PROMPT = """你是一个本地账单交易分类助手。请根据交易描述、商品/服务信息、商户/品牌、平台/支付渠道、金额方向，生成稳定的展示描述并完成分类。

分类表：
{category_choices}

{corrections}

退款/历史上下文：
{refund_context}

分类总原则：
- 优先做“消费用途分析”，不要优先做渠道分析。
- 判断顺序：明确消费对象或用途 > 商户/品牌 > 交易方式 > 平台/支付渠道。
- 更具体的中文语义优先于更泛的语义。
- 商品/服务对象明确时按对象分类；外卖、网购、配送、扫码只是交易方式，只有对象或用途不明确时才作为兜底。
- 平台/支付渠道不能单独决定分类。
- 金额不能用于猜测消费用途，只能辅助判断收入、支出、退款方向。
- 与用户纠正记录、相似历史交易保持一致，除非当前交易有更明确的证据。

重点口径：
- 咖啡外卖、奶茶外卖、茶饮外卖、果茶外卖：核心对象是饮品，应归餐饮美食 > 咖啡饮品，不归外卖。
- 普通餐食外卖、餐品配送、无法识别具体食物类别的外卖：归餐饮美食 > 外卖。
- 餐厅到店、饭店扫码、堂食消费：归餐饮美食 > 餐馆。
- 药品配送、药店外卖、买药：核心对象是药品，应归医疗健康 > 药店，不归外卖。
- 网购有明确商品时按商品类，如手机归数码、衣服归服饰；商品不明确才归网购。
- 酒店/机票/打车/还款/手续费/话费/水电燃气等用途明确时按用途分类。
- 纯转账、红包、亲友收付款、AA、代付：无法判断具体用途时归其他 > 其他，并降低置信度；若描述明确指向房租/餐费/电影票等用途，则按具体用途分类。
- 退款优先继承原交易分类；找不到原交易且只知道是退款时，才归收入 > 退款。

display_description 规则：
- 输出稳定、可读、信息量适中的展示描述，优先保留可识别的商户/品牌/交易对方，去掉流水号、订单号、卡号尾号、支付渠道噪音。
- 如果只知道商户/交易对方，不要脑补用途，保留商户/交易对方。
- 如果商户/品牌和用途都明确，应输出“商户/品牌 + 简短用途/对象”，例如“招商银行信用卡还款”“滴滴出行打车”“携程酒店”“瑞幸咖啡饮品”。
- 不要只输出过泛的平台或用途，例如不要把“滴滴出行打车”简化为“打车”，也不要把“瑞幸咖啡外卖”简化为“外卖”。
- 同一商户同一商品/服务应尽量生成一致的 display_description；不要根据金额、时间、平台自行补全不存在的场景。

置信度规则：
- 消费对象或用途明确且分类唯一可给高置信度；只有商户/品牌给中等置信度；只有平台/支付渠道或纯转账无法判断用途时给低置信度。
- 与历史相似交易冲突时降低置信度。

输出要求：
- category_id 必须选择一级分类 ID，不能使用二级分类 ID。
- subcategory_id 必须属于该一级分类；不确定时选择该一级分类下的“其他”，没有合适一级分类时归其他 > 其他。
- confidence 输出 0-100 的整数，表示你对分类的把握，不要为了显得确定而虚高。
- 只返回 JSON，不要 Markdown，不要解释。

JSON 格式：
{{"display_description":"...","category_id":1,"subcategory_id":2,"confidence":88}}"""


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _call_llm(system_prompt: str, user_prompt: str, temperature: float = 0.1, num_predict: int = 256, json_mode: bool = False) -> str:
    model = get_ollama_model()
    if not model:
        clear_ollama_model_cache()
        model = get_ollama_model()
    if not model:
        raise RuntimeError(f"Ollama is unavailable or no local model is installed at {OLLAMA_BASE_URL}")

    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "stream": False,
        "keep_alive": "30m",
        "think": False,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }).encode("utf-8")
    body = json.loads(payload.decode("utf-8"))
    if json_mode:
        body["format"] = "json"
    payload = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    attempts = max(1, OLLAMA_MAX_RETRIES)
    with _OLLAMA_CALL_SEMAPHORE:
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as res:
                    response = json.loads(res.read().decode("utf-8"))
                return response["message"]["content"].strip()
            except HTTPError as exc:
                if exc.code not in (429, 500, 502, 503, 504) or attempt == attempts - 1:
                    detail = exc.read().decode("utf-8", errors="ignore").strip()
                    detail_text = f": {detail}" if detail else ""
                    raise RuntimeError(f"Ollama HTTP {exc.code}{detail_text}") from exc
                time.sleep(min(30, 3 * (attempt + 1)))
            except URLError as exc:
                if attempt == attempts - 1:
                    raise RuntimeError(f"Ollama connection failed: {exc.reason}") from exc
                time.sleep(min(30, 3 * (attempt + 1)))

    raise RuntimeError("Ollama request failed after retries")


def _extract_json(text: str) -> dict | None:
    """Extract and parse JSON from LLM response."""
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```", "", text)
    json_match = re.search(r"\{[^{}]*\}", text)
    if not json_match:
        return None
    try:
        data = json.loads(json_match.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _extract_json_array(text: str) -> list[dict] | None:
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```", "", text)
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
        if isinstance(parsed, dict):
            if parsed.get("id") is not None:
                return [parsed]
            for key in ("results", "items", "transactions", "classifications", "data"):
                value = parsed.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
            list_values = [value for value in parsed.values() if isinstance(value, list)]
            if len(list_values) == 1:
                return [item for item in list_values[0] if isinstance(item, dict)]
    except json.JSONDecodeError:
        pass
    json_match = re.search(r"\[[\s\S]*\]", text)
    if not json_match:
        return None
    try:
        data = json.loads(json_match.group(0))
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else None
    except json.JSONDecodeError:
        return None


def _short_response(text: str, limit: int = 240) -> str:
    compact = re.sub(r"\s+", " ", text or "").strip()
    return compact[:limit] + ("..." if len(compact) > limit else "")


def _clean_confidence(value) -> int | None:
    try:
        confidence = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(0, min(100, confidence))


def _row_get(row, key: str, default=None):
    if isinstance(row, dict):
        return row.get(key, default)
    try:
        return row[key]
    except (KeyError, IndexError):
        return default


def _clamp_batch_size(value: int, default: int, minimum: int, maximum: int) -> int:
    if value < minimum:
        return default
    return min(value, maximum)


def _clamp_sample_rate(value: float) -> float:
    if value < 0:
        return 0
    if value > 1:
        return 1
    return value


def _ollama_model_name(model) -> str | None:
    if isinstance(model, dict):
        return model.get("name") or model.get("model")
    return getattr(model, "name", None) or getattr(model, "model", None)


def list_ollama_models() -> list[str]:
    client = ollama.Client(host=OLLAMA_BASE_URL, timeout=10)
    models = client.list()
    raw_models = models.get("models", []) if isinstance(models, dict) else getattr(models, "models", [])
    return [name for item in raw_models if (name := _ollama_model_name(item))]


@lru_cache(maxsize=1)
def get_ollama_model() -> str | None:
    models = list_ollama_models()
    if OLLAMA_MODEL in models:
        return OLLAMA_MODEL
    return models[0] if models else None


def clear_ollama_model_cache() -> None:
    get_ollama_model.cache_clear()


def _build_category_tree() -> str:
    with db_connection() as conn:
        parents = conn.execute(
            "SELECT id, name FROM categories WHERE parent_id IS NULL ORDER BY id"
        ).fetchall()
        lines = []
        for p in parents:
            subs = conn.execute(
                "SELECT name FROM categories WHERE parent_id = ? ORDER BY id", (p["id"],)
            ).fetchall()
            sub_names = ", ".join(s["name"] for s in subs)
            lines.append(f"- {p['name']}: {sub_names}")
        return "\n".join(lines)


def _build_category_choices() -> str:
    with db_connection() as conn:
        parents = conn.execute(
            "SELECT id, name FROM categories WHERE parent_id IS NULL ORDER BY id"
        ).fetchall()
        lines = []
        for parent in parents:
            children = conn.execute(
                "SELECT id, name FROM categories WHERE parent_id = ? ORDER BY id",
                (parent["id"],),
            ).fetchall()
            child_text = ", ".join(f'{child["id"]}:{child["name"]}' for child in children)
            lines.append(f'{parent["id"]}:{parent["name"]} -> {child_text}')
        return "\n".join(lines)


def _valid_category_ids(category_id, subcategory_id) -> tuple[int | None, int | None]:
    try:
        category_id = int(category_id) if category_id is not None else None
    except (TypeError, ValueError):
        category_id = None
    try:
        subcategory_id = int(subcategory_id) if subcategory_id is not None else None
    except (TypeError, ValueError):
        subcategory_id = None

    if category_id is None:
        return None, None

    with db_connection() as conn:
        parent = conn.execute(
            "SELECT id FROM categories WHERE id = ? AND parent_id IS NULL",
            (category_id,),
        ).fetchone()
        if not parent:
            child_as_category = conn.execute(
                "SELECT id, parent_id FROM categories WHERE id = ? AND parent_id IS NOT NULL",
                (category_id,),
            ).fetchone()
            if not child_as_category:
                return None, None
            if subcategory_id is None or subcategory_id == category_id:
                return child_as_category["parent_id"], child_as_category["id"]
            sibling = conn.execute(
                "SELECT id FROM categories WHERE id = ? AND parent_id = ?",
                (subcategory_id, child_as_category["parent_id"]),
            ).fetchone()
            return child_as_category["parent_id"], (sibling["id"] if sibling else child_as_category["id"])
        if subcategory_id is None:
            return category_id, None
        child = conn.execute(
            "SELECT id FROM categories WHERE id = ? AND parent_id = ?",
            (subcategory_id, category_id),
        ).fetchone()
        return category_id, (child["id"] if child else None)


def _build_corrections() -> str:
    with db_connection() as conn:
        examples = conn.execute(
            """SELECT ce.raw_description, ce.display_description, c1.name as cat_name, c2.name as sub_name
               FROM correction_examples ce
               JOIN categories c1 ON ce.category_id = c1.id
               LEFT JOIN categories c2 ON ce.subcategory_id = c2.id
               ORDER BY ce.created_at DESC
               LIMIT ?""",
            (MAX_CORRECTION_EXAMPLES,),
        ).fetchall()
        if not examples:
            return "（暂无纠正记录）"
        lines = []
        for ex in examples:
            sub = ex["sub_name"] or "无"
            lines.append(f'- 原始"{ex["raw_description"]}" → 展示"{ex["display_description"]}" → {ex["cat_name"]} > {sub}')
        return "\n".join(lines)


def _get_category_id(name: str, parent_id: int | None = None) -> int | None:
    name = (name or "").strip()
    if not name:
        return None
    with db_connection() as conn:
        if parent_id:
            row = conn.execute(
                "SELECT id FROM categories WHERE name = ? AND parent_id = ?",
                (name, parent_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM categories WHERE name = ? AND parent_id IS NULL",
                (name,),
            ).fetchone()
        return row["id"] if row else None


def _resolve_category_ids(category_name: str, subcategory_name: str) -> tuple[int | None, int | None]:
    category_name = (category_name or "").strip()
    subcategory_name = (subcategory_name or "").strip()
    parent_id = _get_category_id(category_name)

    if parent_id and subcategory_name:
        sub_id = _get_category_id(subcategory_name, parent_id)
        if sub_id:
            return parent_id, sub_id

    if subcategory_name:
        with db_connection() as conn:
            row = conn.execute(
                """SELECT child.id as sub_id, child.parent_id
                   FROM categories child
                   WHERE child.name = ? AND child.parent_id IS NOT NULL""",
                (subcategory_name,),
            ).fetchone()
            if row:
                return row["parent_id"], row["sub_id"]

    if parent_id:
        return parent_id, None

    return None, None


def _find_refund_candidates(description: str, amount: float) -> str:
    refund_keywords = ["退款", "退货", "退费", "返还", "退款退货", "退票", "撤销", "冲正"]
    is_refund = amount < 0 or any(kw in description for kw in refund_keywords)

    if not is_refund:
        return ""

    target_amount = abs(amount) if amount < 0 else amount

    with db_connection() as conn:
        candidates = conn.execute(
            """SELECT display_description, amount, c1.name as cat_name, c2.name as sub_name
               FROM transactions t
               LEFT JOIN categories c1 ON t.category_id = c1.id
               LEFT JOIN categories c2 ON t.subcategory_id = c2.id
               WHERE t.amount > 0
                 AND t.is_categorized = 1
                 AND t.category_id IS NOT NULL
                 AND (
                   t.amount BETWEEN ? AND ?
                   OR ABS(t.amount - ?) < 0.02 * ?
                 )
               ORDER BY ABS(t.amount - ?), t.date DESC
               LIMIT 5""",
            (target_amount * 0.98, target_amount * 1.02, target_amount, target_amount, target_amount),
        ).fetchall()

        if not candidates:
            candidates = conn.execute(
                """SELECT display_description, amount, c1.name as cat_name, c2.name as sub_name
                   FROM transactions t
                   LEFT JOIN categories c1 ON t.category_id = c1.id
                   LEFT JOIN categories c2 ON t.subcategory_id = c2.id
                   WHERE t.amount > 0
                     AND t.is_categorized = 1
                     AND t.category_id IS NOT NULL
                     AND t.date >= date('now', '-30 days')
                   ORDER BY t.date DESC
                   LIMIT 20""",
            ).fetchall()

        if not candidates:
            return ""

        lines = ["该交易疑似为退款。以下是近期可能对应的原始交易（请根据金额和描述推断分类）："]
        for c in candidates:
            sub = f" > {c['sub_name']}" if c["sub_name"] else ""
            lines.append(f'- "{c["display_description"]}" ¥{c["amount"]:.2f} → {c["cat_name"]}{sub}')
        return "\n".join(lines)


# ──────────────────────────────────────────────
# Workflow Orchestrator
# ──────────────────────────────────────────────

def _llm_item_from_row(row) -> dict:
    item = {
        "id": row["id"],
        "description": row["display_description"] or row["raw_description"],
        "raw_description": row["raw_description"],
        "amount": row["amount"],
    }
    if _row_get(row, "merchant_platform"):
        item["merchant_platform"] = _row_get(row, "merchant_platform")
    if _row_get(row, "merchant_canonical"):
        item["merchant_canonical"] = _row_get(row, "merchant_canonical")
    if _row_get(row, "display_product_info") or _row_get(row, "raw_product_info"):
        item["product_info"] = _row_get(row, "display_product_info") or _row_get(row, "raw_product_info")
        item["raw_product_info"] = _row_get(row, "raw_product_info")
    if refund_context := _find_refund_candidates(row["raw_description"], row["amount"]):
        item["refund_context"] = refund_context
    return item


def _single_user_prompt(
    description: str,
    amount: float,
    raw_description: str | None = None,
    raw_product_info: str | None = None,
    display_product_info: str | None = None,
    merchant_platform: str | None = None,
    merchant_canonical: str | None = None,
) -> str:
    lines = [
        f'交易描述："{description}"',
        f'原始描述："{raw_description or description}"',
    ]
    if merchant_platform:
        lines.append(f'消费平台："{merchant_platform}"')
    if merchant_canonical:
        lines.append(f'规范商户/品牌："{merchant_canonical}"')
    product_info = display_product_info or raw_product_info
    if product_info:
        lines.append(f'商品/服务信息："{product_info}"')
    if raw_product_info and raw_product_info != product_info:
        lines.append(f'原始商品/服务信息："{raw_product_info}"')
    lines.append(f"交易金额：{amount}")
    return "\n".join(lines)


def categorize_transaction(
    description: str,
    amount: float,
    raw_description: str | None = None,
    raw_product_info: str | None = None,
    display_product_info: str | None = None,
    merchant_platform: str | None = None,
    merchant_canonical: str | None = None,
) -> dict:
    """Classify one transaction with a single Ollama call."""
    category_choices = _build_category_choices()
    corrections = _build_corrections()
    refund_context = _find_refund_candidates(raw_description or description, amount)
    system_prompt = UNIFIED_CLASSIFY_PROMPT.format(
        category_choices=category_choices,
        corrections=corrections,
        refund_context=refund_context,
    )

    try:
        content = _call_llm(
            system_prompt,
            _single_user_prompt(
                description,
                amount,
                raw_description,
                raw_product_info=raw_product_info,
                display_product_info=display_product_info,
                merchant_platform=merchant_platform,
                merchant_canonical=merchant_canonical,
            ),
            temperature=0,
            num_predict=96,
            json_mode=True,
        )
        result = _extract_json(content)
        if not result:
            return {"category_id": None, "subcategory_id": None, "error": "No JSON in response"}
    except Exception as e:
        return {"category_id": None, "subcategory_id": None, "error": str(e)}

    display_description = (result.get("display_description") or "").strip()
    if not display_description:
        return {
            "category_id": None,
            "subcategory_id": None,
            "error": f"LLM response missing display_description: {result}",
        }
    parent_id, sub_id = _valid_category_ids(result.get("category_id"), result.get("subcategory_id"))
    if parent_id is None:
        category_name = result.get("category", "")
        subcategory_name = result.get("subcategory", "")
        parent_id, sub_id = _resolve_category_ids(category_name, subcategory_name)

    if parent_id is None:
        return {
            "category_id": None,
            "subcategory_id": None,
            "error": f"Category not found in LLM response: {result}",
            "display_description": display_description,
        }

    final_result = {
        "id": 0,
        "category_id": parent_id,
        "subcategory_id": sub_id,
        "display_description": display_description,
        "classification_confidence": _clean_confidence(result.get("confidence")),
        "classification_review_status": "not_reviewed",
    }
    if _should_review(final_result, max(0, min(100, OLLAMA_REVIEW_LOW_CONFIDENCE)), 0):
        reviewed = review_classification_results(
            [{
                "id": 0,
                "display_description": description,
                "raw_description": raw_description or description,
                "raw_product_info": raw_product_info,
                "display_product_info": display_product_info,
                "merchant_platform": merchant_platform,
                "merchant_canonical": merchant_canonical,
                "amount": amount,
            }],
            [final_result],
            llm_context={"category_choices": category_choices, "corrections": corrections},
            low_confidence=max(0, min(100, OLLAMA_REVIEW_LOW_CONFIDENCE)),
            sample_rate=0,
        )
        if reviewed:
            final_result = reviewed[0]
    final_result.pop("id", None)
    return final_result


def _classification_update_values(row, result: dict) -> tuple:
    display_description = (
        row["display_description"]
        if row["display_description_source"] == "manual"
        else result.get("display_description")
    )
    display_description_source = (
        row["display_description_source"]
        if row["display_description_source"] == "manual"
        else result.get("display_description_source") or "llm"
    )
    return (
        result.get("category_id"),
        result.get("subcategory_id"),
        display_description,
        display_description_source,
        _clean_confidence(result.get("classification_confidence", result.get("confidence"))),
        result.get("classification_review_status") or "not_reviewed",
        result.get("classification_review_reason") or result.get("review_reason"),
        row["id"],
    )


def categorize_batch(txn_ids: list[int], progress_callback=None) -> dict:
    total = len(txn_ids)
    categorized = 0
    failed = 0
    last_error = None
    batch_size = _clamp_batch_size(OLLAMA_BATCH_SIZE, 32, 1, 80)
    retry_batch_size = _clamp_batch_size(OLLAMA_RETRY_BATCH_SIZE, 8, 1, 24)
    low_confidence = max(0, min(100, OLLAMA_REVIEW_LOW_CONFIDENCE))
    review_sample_rate = _clamp_sample_rate(OLLAMA_REVIEW_SAMPLE_RATE)
    llm_context = {
        "category_choices": _build_category_choices(),
        "corrections": _build_corrections(),
    }

    def emit_progress(processed: int, message: str | None = None) -> None:
        if progress_callback:
            progress_callback({
                "total": total,
                "processed": processed,
                "categorized": categorized,
                "failed": failed,
                "error": last_error,
                "message": message,
            })

    if not txn_ids:
        return {"total": 0, "categorized": 0, "failed": 0, "error": None}

    with db_connection() as conn:
        rows = conn.execute(
            """SELECT id, display_description, display_description_source, raw_description,
                      raw_product_info, display_product_info, merchant_platform,
                      merchant_canonical, amount
               FROM transactions
               WHERE id IN ({})""".format(",".join("?" for _ in txn_ids)),
            txn_ids,
        ).fetchall()

    fetched_ids = {int(row["id"]) for row in rows}
    missing_count = sum(1 for txn_id in txn_ids if int(txn_id) not in fetched_ids)
    if missing_count:
        failed += missing_count
        emit_progress(categorized + failed, f"跳过不存在的交易 {missing_count} 条")

    history_updates = []
    remaining_rows = []
    for row in rows:
        result = reuse_historical_classification(row, exclude_ids={int(row["id"])})
        if result:
            history_updates.append(_classification_update_values(row, result))
        else:
            remaining_rows.append(row)

    if history_updates:
        with db_connection() as conn:
            conn.executemany(
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
                history_updates,
            )
        categorized += len(history_updates)
        emit_progress(categorized + failed, f"已复用历史分类 {len(history_updates)} 条")

    if not remaining_rows:
        return {"total": total, "categorized": categorized, "failed": failed, "error": last_error}

    groups = _group_rows_for_classification(remaining_rows)
    representative_rows = [group["representative"] for group in groups]
    chunk_specs = []
    for start in range(0, len(representative_rows), batch_size):
        chunk = representative_rows[start:start + batch_size]
        chunk_specs.append((start, chunk, groups[start:start + len(chunk)]))

    worker_count = min(
        len(chunk_specs),
        _clamp_batch_size(OLLAMA_BATCH_WORKERS, 1, 1, 8),
    )

    def apply_chunk_result(chunk_result: dict) -> None:
        nonlocal categorized, failed, last_error
        updates = chunk_result.get("updates") or []
        chunk_failed = int(chunk_result.get("failed", 0))
        error = chunk_result.get("error")
        if updates:
            _persist_classification_updates(updates)
            categorized += len(updates)
        failed += chunk_failed
        if error:
            last_error = error
        emit_progress(categorized + failed)

    if worker_count <= 1:
        for start, chunk, chunk_groups in chunk_specs:
            emit_progress(
                categorized + failed,
                f"正在调用 LLM 分类 {start + 1}-{start + len(chunk)}/{len(representative_rows)} 个去重交易线索",
            )
            apply_chunk_result(
                _classify_group_chunk(
                    chunk,
                    chunk_groups,
                    retry_batch_size,
                    llm_context,
                    low_confidence,
                    review_sample_rate,
                )
            )
    else:
        emit_progress(
            categorized + failed,
            f"正在并行调用 LLM 分类 {len(chunk_specs)} 个批次，worker={worker_count}",
        )
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {}
            for _, chunk, chunk_groups in chunk_specs:
                future = executor.submit(
                    _classify_group_chunk,
                    chunk,
                    chunk_groups,
                    retry_batch_size,
                    llm_context,
                    low_confidence,
                    review_sample_rate,
                )
                futures[future] = sum(len(group["rows"]) for group in chunk_groups)
            for future in as_completed(futures):
                try:
                    apply_chunk_result(future.result())
                except Exception as exc:
                    last_error = str(exc)
                    failed += futures[future]
                    emit_progress(categorized + failed)

    return {"total": total, "categorized": categorized, "failed": failed, "error": last_error}


def _classify_group_chunk(
    chunk,
    chunk_groups,
    retry_batch_size: int,
    llm_context: dict,
    low_confidence: int,
    review_sample_rate: float,
) -> dict:
    last_error = None
    failed = 0

    try:
        results = categorize_many_with_llm(chunk, llm_context=llm_context)
    except Exception as exc:
        last_error = str(exc)
        results = []

    valid_results, retry_rows = _split_valid_batch_results(chunk, results)
    if retry_rows:
        retry_results = []
        retry_errors = []
        for retry_start in range(0, len(retry_rows), retry_batch_size):
            retry_chunk = retry_rows[retry_start:retry_start + retry_batch_size]
            try:
                retry_results.extend(
                    categorize_many_with_llm(
                        retry_chunk,
                        llm_context=llm_context,
                        strict=True,
                    )
                )
            except Exception as exc:
                retry_errors.append(str(exc))
        retry_valid, _ = _split_valid_batch_results(retry_rows, retry_results)
        valid_results.extend(retry_valid)
        if retry_errors:
            last_error = retry_errors[-1]

    if valid_results:
        review_count = sum(
            1 for result in valid_results
            if _should_review(result, low_confidence, review_sample_rate)
        )
        if review_count:
            try:
                valid_results = review_classification_results(
                    chunk,
                    valid_results,
                    llm_context=llm_context,
                    low_confidence=low_confidence,
                    sample_rate=review_sample_rate,
                )
            except Exception as exc:
                last_error = str(exc)

    by_id = {int(r.get("id")): r for r in valid_results if r.get("id") is not None}
    updates = []
    for index, txn in enumerate(chunk):
        result = by_id.get(txn["id"])
        group_rows = chunk_groups[index]["rows"]
        if not result:
            failed += len(group_rows)
            continue

        category_id, subcategory_id = _valid_category_ids(
            result.get("category_id"),
            result.get("subcategory_id"),
        )
        if not category_id:
            category_id, subcategory_id = _resolve_category_ids(
                result.get("category", ""),
                result.get("subcategory", ""),
            )
        if not category_id:
            failed += len(group_rows)
            continue

        for group_txn in group_rows:
            normalized_result = dict(result)
            normalized_result["category_id"] = category_id
            normalized_result["subcategory_id"] = subcategory_id
            updates.append(_classification_update_values(group_txn, normalized_result))

    return {"updates": updates, "failed": failed, "error": last_error}


def _persist_classification_updates(updates: list[tuple]) -> None:
    with db_connection() as conn:
        conn.executemany(
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
            updates,
        )


def _amount_direction(amount) -> str:
    try:
        value = float(amount)
    except (TypeError, ValueError):
        value = 0
    if value < 0:
        return "negative"
    if value > 0:
        return "positive"
    return "zero"


def _group_rows_for_classification(rows) -> list[dict]:
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        bucket_key = (
            _merchant_group_key(row),
            _description_group_key(row),
            _amount_direction(_row_get(row, "amount")),
        )
        product_key = _product_group_key(row)
        bucket = grouped.setdefault(bucket_key, [])
        group = _find_similar_product_group(bucket, product_key)
        if group is None:
            bucket.append({"representative": row, "rows": [row], "product_key": product_key})
        else:
            group["rows"].append(row)

    return [
        {"representative": group["representative"], "rows": group["rows"]}
        for bucket in grouped.values()
        for group in bucket
    ]


def _find_similar_product_group(groups: list[dict], product_key: str) -> dict | None:
    for group in groups:
        if _product_keys_similar(group["product_key"], product_key):
            return group
    return None


def _product_keys_similar(left: str, right: str) -> bool:
    if not left and not right:
        return True
    if not left or not right:
        return False
    if left == right:
        return True
    if len(left) < 4 or len(right) < 4:
        return False
    return SequenceMatcher(None, left, right).ratio() >= PRODUCT_GROUP_SIMILARITY_THRESHOLD


def _merchant_group_key(row) -> str:
    return (_row_get(row, "merchant_canonical") or "").strip()


def _description_group_key(row) -> str:
    if _merchant_group_key(row):
        return ""
    return (_row_get(row, "display_description") or _row_get(row, "raw_description") or "").strip()


def _product_group_key(row) -> str:
    product = (_row_get(row, "display_product_info") or _row_get(row, "raw_product_info") or "").strip()
    if not product:
        return ""

    text = product.lower()
    text = re.sub(r"(订单号|交易单号|流水号|商户订单号|支付单号)[:：]?\s*[\w\-]+", " ", text)
    text = re.sub(r"\d{1,2}月\d{1,2}日", " ", text)
    text = re.sub(r"\d{4}-\d{1,2}-\d{1,2}", " ", text)
    text = re.sub(r"\d{1,2}:\d{2}(?::\d{2})?", " ", text)
    text = re.sub(r"1\d{10}", " ", text)
    text = re.sub(r"\d+", " ", text)
    text = re.sub(r"[\s,，。、:：;；\-—_]+", " ", text).strip()
    return text[:40]


def reuse_historical_classification(row, exclude_ids: set[int] | None = None) -> dict | None:
    """Return a trusted historical classification for a similar transaction.

    The lookup is deliberately conservative: exact user corrections and exact
    prior transactions are safe to reuse, while merchant-level reuse also needs
    compatible product details so generic platforms do not dominate the result.
    """
    row = dict(row)
    exclude_ids = exclude_ids or set()

    correction = _history_from_correction(row)
    if correction:
        return correction

    exact = _history_from_exact_transaction(row, exclude_ids)
    if exact:
        return exact

    return _history_from_merchant_product(row, exclude_ids)


def _history_from_correction(row: dict) -> dict | None:
    raw_description = (row.get("raw_description") or "").strip()
    if not raw_description:
        return None

    with db_connection() as conn:
        match = conn.execute(
            """SELECT display_description, category_id, subcategory_id
               FROM correction_examples
               WHERE raw_description = ?
               ORDER BY created_at DESC
               LIMIT 1""",
            (raw_description,),
        ).fetchone()

    if not match:
        return None

    category_id, subcategory_id = _valid_category_ids(match["category_id"], match["subcategory_id"])
    if not category_id:
        return None

    return {
        "id": row.get("id"),
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "display_description": match["display_description"] or row.get("display_description") or raw_description,
        "classification_confidence": 100,
        "classification_review_status": "history_correction",
        "classification_review_reason": "命中用户纠正记录",
        "display_description_source": "history",
    }


def _history_from_exact_transaction(row: dict, exclude_ids: set[int]) -> dict | None:
    raw_description = (row.get("raw_description") or "").strip()
    if not raw_description:
        return None

    params: list = [
        raw_description,
        row.get("raw_product_info"),
        _amount_direction(row.get("amount")),
    ]
    exclude_sql, exclude_params = _exclude_ids_sql(exclude_ids)
    params.extend(exclude_params)

    with db_connection() as conn:
        match = conn.execute(
            f"""SELECT id, display_description, category_id, subcategory_id,
                       classification_confidence, classification_review_status
                FROM transactions
                WHERE raw_description = ?
                  AND COALESCE(raw_product_info, '') = COALESCE(?, '')
                  AND is_categorized = 1
                  AND category_id IS NOT NULL
                  AND CASE
                        WHEN amount < 0 THEN 'negative'
                        WHEN amount > 0 THEN 'positive'
                        ELSE 'zero'
                      END = ?
                  {exclude_sql}
                ORDER BY
                  CASE classification_review_status
                    WHEN 'manual' THEN 0
                    WHEN 'history_correction' THEN 1
                    WHEN 'review_corrected' THEN 2
                    WHEN 'review_approved' THEN 3
                    ELSE 4
                  END,
                  COALESCE(classification_confidence, 0) DESC,
                  date DESC,
                  id DESC
                LIMIT 1""",
            params,
        ).fetchone()

    if not match:
        return None
    return _history_result_from_match(row, match, "history_exact", "命中相同交易历史分类", default_confidence=96)


def _history_from_merchant_product(row: dict, exclude_ids: set[int]) -> dict | None:
    merchant = (row.get("merchant_canonical") or "").strip()
    if not merchant or len(merchant) < 2:
        return None

    product_key = _product_group_key(row)
    if not product_key:
        return None

    params: list = [merchant, _amount_direction(row.get("amount"))]
    exclude_sql, exclude_params = _exclude_ids_sql(exclude_ids)
    params.extend(exclude_params)

    with db_connection() as conn:
        candidates = conn.execute(
            f"""SELECT id, display_description, raw_product_info, display_product_info,
                       category_id, subcategory_id, classification_confidence,
                       classification_review_status
                FROM transactions
                WHERE merchant_canonical = ?
                  AND is_categorized = 1
                  AND category_id IS NOT NULL
                  AND CASE
                        WHEN amount < 0 THEN 'negative'
                        WHEN amount > 0 THEN 'positive'
                        ELSE 'zero'
                      END = ?
                  {exclude_sql}
                ORDER BY
                  CASE classification_review_status
                    WHEN 'manual' THEN 0
                    WHEN 'history_correction' THEN 1
                    WHEN 'review_corrected' THEN 2
                    WHEN 'review_approved' THEN 3
                    ELSE 4
                  END,
                  COALESCE(classification_confidence, 0) DESC,
                  date DESC,
                  id DESC
                LIMIT 20""",
            params,
        ).fetchall()

    best = None
    best_score = 0.0
    for candidate in candidates:
        candidate_key = _product_group_key(candidate)
        if not _product_keys_similar(product_key, candidate_key):
            continue
        score = SequenceMatcher(None, product_key, candidate_key).ratio()
        if score > best_score:
            best = candidate
            best_score = score

    if not best:
        return None
    return _history_result_from_match(row, best, "history_merchant_product", "命中同商户相似商品历史分类", default_confidence=90)


def _history_result_from_match(
    row: dict,
    match,
    status: str,
    reason: str,
    default_confidence: int,
) -> dict | None:
    category_id, subcategory_id = _valid_category_ids(match["category_id"], match["subcategory_id"])
    if not category_id:
        return None

    confidence = _clean_confidence(match["classification_confidence"])
    if confidence is None:
        confidence = default_confidence
    elif match["classification_review_status"] != "manual":
        confidence = min(confidence, default_confidence)

    return {
        "id": row.get("id"),
        "category_id": category_id,
        "subcategory_id": subcategory_id,
        "display_description": match["display_description"] or row.get("display_description") or row.get("raw_description"),
        "classification_confidence": confidence,
        "classification_review_status": status,
        "classification_review_reason": reason,
        "display_description_source": "history",
    }


def _exclude_ids_sql(exclude_ids: set[int]) -> tuple[str, list[int]]:
    clean_ids = sorted({int(value) for value in exclude_ids if value is not None})
    if not clean_ids:
        return "", []
    placeholders = ",".join("?" for _ in clean_ids)
    return f"AND id NOT IN ({placeholders})", clean_ids


def _split_valid_batch_results(rows, results: list[dict]) -> tuple[list[dict], list]:
    expected_by_id = {int(row["id"]): row for row in rows}
    valid_results = []
    seen_ids = set()
    for result in results or []:
        try:
            result_id = int(result.get("id"))
        except (TypeError, ValueError):
            continue
        if result_id not in expected_by_id or result_id in seen_ids:
            continue
        category_id, subcategory_id = _valid_category_ids(
            result.get("category_id"),
            result.get("subcategory_id"),
        )
        if not category_id:
            category_id, subcategory_id = _resolve_category_ids(
                result.get("category", ""),
                result.get("subcategory", ""),
            )
        if not category_id:
            continue
        display_description = (result.get("display_description") or "").strip()
        if not display_description:
            continue
        next_result = dict(result)
        next_result["display_description"] = display_description
        next_result["category_id"] = category_id
        next_result["subcategory_id"] = subcategory_id
        next_result["classification_confidence"] = _clean_confidence(
            result.get("classification_confidence", result.get("confidence"))
        )
        valid_results.append(next_result)
        seen_ids.add(result_id)
    retry_rows = [row for row in rows if int(row["id"]) not in seen_ids]
    return valid_results, retry_rows


def _should_review(result: dict, low_confidence: int, sample_rate: float) -> bool:
    confidence = _clean_confidence(result.get("classification_confidence", result.get("confidence")))
    if confidence is None or confidence < low_confidence:
        return True
    if sample_rate <= 0:
        return False
    try:
        result_id = int(result.get("id"))
    except (TypeError, ValueError):
        return False
    return (result_id % 100) < int(sample_rate * 100)


def review_classification_results(
    rows,
    results: list[dict],
    llm_context: dict | None = None,
    low_confidence: int = 75,
    sample_rate: float = 0.1,
) -> list[dict]:
    rows_by_id = {int(row["id"]): row for row in rows}
    results_by_id = {int(result["id"]): dict(result) for result in results if result.get("id") is not None}
    review_items = []
    for result in results_by_id.values():
        if not _should_review(result, low_confidence, sample_rate):
            result["classification_review_status"] = result.get("classification_review_status") or "not_reviewed"
            continue
        row = rows_by_id.get(int(result["id"]))
        if not row:
            continue
        review_items.append({
            "id": result["id"],
            "description": row["display_description"] or row["raw_description"],
            "raw_description": row["raw_description"],
            "merchant_platform": _row_get(row, "merchant_platform"),
            "product_info": _row_get(row, "display_product_info") or _row_get(row, "raw_product_info"),
            "raw_product_info": _row_get(row, "raw_product_info"),
            "amount": row["amount"],
            "display_description": result.get("display_description"),
            "category_id": result.get("category_id"),
            "subcategory_id": result.get("subcategory_id"),
            "confidence": _clean_confidence(result.get("classification_confidence", result.get("confidence"))),
        })

    if not review_items:
        return list(results_by_id.values())

    category_choices = (llm_context or {}).get("category_choices") or _build_category_choices()
    corrections = (llm_context or {}).get("corrections") or _build_corrections()
    system_prompt = f"""你是一个交易分类复核 agent。请审计候选分类，修正低置信或明显错误的分类。

分类表：
{category_choices}

用户纠正记录：
{corrections}

规则：
- 每个输入 id 必须返回一条结果。
- 优先做消费用途分析：先看明确消费对象或用途，其次参考商户/品牌，最后才参考交易方式、平台和支付渠道。
- 复核时重点检查是否被平台词误导，例如美团、京东、淘宝、微信、支付宝。
- 复核时重点检查是否把方式词当成最终消费对象，例如外卖、网购、配送；如果消费对象或用途更明确，应按更具体语义分类。
- 复核时重点检查是否和相似历史交易或人工纠正不一致。
- 复核时重点检查是否把退款简单归收入，而没有尝试继承原交易分类。
- 复核时重点检查是否把纯转账硬猜成消费；无法判断用途时应归其他 > 其他并降低置信度。
- 示例：咖啡/奶茶外卖应归咖啡饮品，普通餐食外卖可归外卖，药品配送应归医疗健康/药店，京东手机应归数码电器。
- 如果候选分类合理，approved=true，并返回原 category_id/subcategory_id。
- 如果候选分类不合理，approved=false，并返回修正后的 category_id/subcategory_id。
- category_id 必须选择一级分类 ID；subcategory_id 必须属于该一级分类，不能编造 ID。
- confidence 输出复核后的 0-100 整数。
- reason 用一句很短的中文说明复核判断。
- 只返回 JSON 对象，不要 Markdown 或解释。

JSON 格式：
{{"results":[{{"id":1,"approved":true,"category_id":1,"subcategory_id":2,"confidence":91,"reason":"候选分类合理"}}]}}"""
    content = _call_llm(
        system_prompt,
        json.dumps(review_items, ensure_ascii=False),
        temperature=0,
        num_predict=max(256, min(1536, len(review_items) * 96 + 128)),
        json_mode=True,
    )
    review_results = _extract_json_array(content)
    if review_results is None:
        raise ValueError(f"LLM reviewer did not return usable JSON: {_short_response(content)}")

    for review in review_results:
        try:
            result_id = int(review.get("id"))
        except (TypeError, ValueError):
            continue
        original = results_by_id.get(result_id)
        if not original:
            continue
        category_id, subcategory_id = _valid_category_ids(
            review.get("category_id"),
            review.get("subcategory_id"),
        )
        if not category_id:
            original["classification_review_status"] = "review_invalid"
            original["classification_review_reason"] = review.get("reason") or "复核结果分类 ID 无效"
            continue
        original["category_id"] = category_id
        original["subcategory_id"] = subcategory_id
        original["classification_confidence"] = _clean_confidence(review.get("confidence"))
        original["classification_review_status"] = "review_approved" if review.get("approved") else "review_corrected"
        original["classification_review_reason"] = review.get("reason")

    reviewed_ids = {
        int(item["id"])
        for item in review_items
        if item.get("id") is not None
    }
    for result_id in reviewed_ids:
        result = results_by_id.get(result_id)
        if result and not result.get("classification_review_status"):
            result["classification_review_status"] = "review_missing"
            result["classification_review_reason"] = "复核未返回该交易"

    return list(results_by_id.values())


def categorize_many_with_llm(rows, llm_context: dict | None = None, strict: bool = False) -> list[dict]:
    category_choices = (llm_context or {}).get("category_choices") or _build_category_choices()
    corrections = (llm_context or {}).get("corrections") or _build_corrections()
    items = [_llm_item_from_row(dict(r)) for r in rows]
    strict_rules = """
- 这是修复批次：必须只处理输入里给出的 id，不能遗漏任何一条。
- 如果上次结果无法确定，请重新用 LLM 判断；不要编造不存在的分类 ID。
""" if strict else ""
    system_prompt = f"""你是一个本地账单批量分类助手。根据每条交易描述、商品/服务信息和金额，输出清洗后的交易描述、一级分类ID、二级分类ID、置信度。

分类表：
{category_choices}

用户纠正记录：
{corrections}

规则：
- 每个输入 id 必须返回一条结果。
- 优先做“消费用途分析”，不要优先做渠道分析。
- 判断顺序：明确消费对象或用途 > 商户/品牌 > 交易方式 > 平台/支付渠道。
- 更具体的中文语义优先于更泛的语义。
- 商品/服务对象明确时按对象分类；外卖、网购、配送、扫码只是交易方式，只有对象或用途不明确时才作为兜底。
- 平台/支付渠道不能单独决定分类；金额不能用于猜测消费用途，只能辅助判断收入、支出、退款方向。
- 与用户纠正记录、相似历史交易保持一致，除非当前交易有更明确的证据。
- 咖啡外卖、奶茶外卖、茶饮外卖、果茶外卖：核心对象是饮品，应归餐饮美食 > 咖啡饮品，不归外卖。
- 普通餐食外卖、餐品配送、无法识别具体食物类别的外卖：归餐饮美食 > 外卖。
- 餐厅到店、饭店扫码、堂食消费：归餐饮美食 > 餐馆。
- 药品配送、药店外卖、买药：核心对象是药品，应归医疗健康 > 药店，不归外卖。
- 网购有明确商品时按商品类，如手机归数码、衣服归服饰；商品不明确才归网购。
- 酒店/机票/打车/还款/手续费/话费/水电燃气等用途明确时按用途分类。
- 纯转账、红包、亲友收付款、AA、代付：无法判断具体用途时归其他 > 其他，并降低置信度；若描述明确指向房租/餐费/电影票等用途，则按具体用途分类。
- display_description 要稳定、可读、信息量适中，优先保留可识别的商户/品牌/交易对方，去掉流水号/订单号/卡号尾号/支付渠道噪音。
- 如果只知道商户/交易对方，不要脑补用途，保留商户/交易对方。
- 如果商户/品牌和用途都明确，应输出“商户/品牌 + 简短用途/对象”，例如“招商银行信用卡还款”“滴滴出行打车”“携程酒店”“瑞幸咖啡饮品”。
- 不要只输出过泛的平台或用途，例如不要把“滴滴出行打车”简化为“打车”，也不要把“瑞幸咖啡外卖”简化为“外卖”。
- 同一商户同一商品/服务应尽量生成一致的 display_description；不要根据金额、时间、平台自行补全不存在的场景。
- category_id 必须选择箭头左侧的一级分类 ID，不能使用箭头右侧的二级分类 ID。
- subcategory_id 必须选择该一级分类箭头右侧的二级分类 ID；不确定时使用对应一级分类下的“其他”，没有合适一级分类时归其他 > 其他。
- 如果输入含 refund_context，优先参考候选原始交易来判断退款分类。
- 退款优先继承原交易分类；找不到原交易且只知道是退款时，才归收入 > 退款。
- confidence 输出 0-100 的整数，表示你对分类的把握，不要为了显得确定而虚高。
- 只返回 JSON 对象，不要 Markdown 或解释。
{strict_rules}

JSON 格式：
{{"results":[{{"id":1,"display_description":"...","category_id":1,"subcategory_id":2,"confidence":88}}]}}"""
    content = _call_llm(
        system_prompt,
        json.dumps(items, ensure_ascii=False),
        temperature=0,
        num_predict=max(256, min(2048, len(items) * 80 + 96)),
        json_mode=True,
    )
    results = _extract_json_array(content)
    if results is None:
        raise ValueError(f"LLM did not return usable classification JSON: {_short_response(content)}")
    return results


def check_ollama() -> bool:
    try:
        clear_ollama_model_cache()
        return get_ollama_model() is not None
    except Exception:
        return False
