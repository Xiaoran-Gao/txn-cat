import json
import re
import urllib.request
import ollama
from functools import lru_cache
from config import OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT, MAX_CORRECTION_EXAMPLES
from database import db_connection

# ──────────────────────────────────────────────
# Agent System Prompts
# ──────────────────────────────────────────────

NORMALIZER_PROMPT = """你是一个银行交易描述清洗助手。从交易描述中提取标准化的商户名称。

规则：
- 描述文本已经过初步清洗（去除了交易ID、日期等数字噪音）
- 提取核心商户名称，保留品牌名和关键业务词（如"外卖""便利店""加油站"）
- 如果是退款类交易（包含"退款""退货""退费"），保留退款关键词
- 如果描述已经很简洁清晰，直接返回原文
- 只返回清洗后的商户名称，不要任何解释或其他内容"""

CATEGORIZER_PROMPT = """你是一个银行交易分类助手。根据商户名称和金额，将交易归类到下面的二级分类体系中。

可选分类：
{category_tree}

{corrections}

{refund_context}

规则：
- 仔细分析商户名称的含义
- 不确定时选择"其他 > 其他"，不要随意猜测
- 只返回JSON对象，包含"category"和"subcategory"字段，不要输出其他内容"""

REVIEWER_PROMPT = """你是一个交易分类审核助手。审核以下分类结果是否合理。

交易信息：
- 原始描述：{raw_description}
- 商户名称：{merchant_name}
- 交易金额：{amount}
- 当前分类：{category} > {subcategory}

可选分类：
{category_tree}

请判断分类是否合理：
- 如果合理，返回 {{"approved": true}}
- 如果不合理，返回 {{"approved": false, "category": "...", "subcategory": "...", "reason": "..."}}

只返回JSON对象，不要其他内容。"""

UNIFIED_CLASSIFY_PROMPT = """你是一个本地账单交易分类助手。根据交易描述和金额，完成商户名提取和交易分类。

分类表：
{category_choices}

{corrections}

{refund_context}

规则：
- merchant_name 输出清晰的商户/交易对方名称，不要解释。
- category_id 必须选择箭头左侧的一级分类 ID，不能使用箭头右侧的二级分类 ID。
- subcategory_id 必须选择该一级分类箭头右侧的二级分类 ID；不确定时使用对应一级分类下的"其他"子类，如果没有则为 null。
- 金额小于 0 通常表示收入或退款，请结合描述判断。
- 只返回 JSON，不要输出 Markdown 或解释。

JSON 格式：
{{"merchant_name":"...","category_id":1,"subcategory_id":2}}"""


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
    with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT) as res:
        response = json.loads(res.read().decode("utf-8"))
    return response["message"]["content"].strip()


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
            """SELECT ce.description, c1.name as cat_name, c2.name as sub_name
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
            lines.append(f'- "{ex["description"]}" → {ex["cat_name"]} > {sub}')
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
            """SELECT cleaned_description, amount, c1.name as cat_name, c2.name as sub_name
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
                """SELECT cleaned_description, amount, c1.name as cat_name, c2.name as sub_name
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
            lines.append(f'- "{c["cleaned_description"]}" ¥{c["amount"]:.2f} → {c["cat_name"]}{sub}')
        return "\n".join(lines)


# ──────────────────────────────────────────────
# Agents
# ──────────────────────────────────────────────

def agent_normalize(description: str) -> dict:
    """Agent 1: Normalize transaction description into a clean merchant name."""
    try:
        merchant_name = _call_llm(NORMALIZER_PROMPT, f'交易描述："{description}"')
        return {"merchant_name": merchant_name or description, "success": True}
    except Exception as e:
        return {"merchant_name": description, "success": False, "error": str(e)}


def agent_categorize(merchant_name: str, amount: float, raw_description: str) -> dict:
    """Agent 2: Categorize the transaction based on the cleaned merchant name."""
    category_tree = _build_category_tree()
    corrections = _build_corrections()
    refund_context = _find_refund_candidates(raw_description, amount)

    system_prompt = CATEGORIZER_PROMPT.format(
        category_tree=category_tree,
        corrections=corrections,
        refund_context=refund_context,
    )

    try:
        content = _call_llm(
            system_prompt,
            f'商户名称："{merchant_name}"\n交易金额：{amount}',
        )
        result = _extract_json(content)

        if not result:
            return {"category": None, "subcategory": None, "success": False, "error": "No JSON in response"}

        return {
            "category_name": result.get("category", ""),
            "subcategory_name": result.get("subcategory", ""),
            "success": True,
        }
    except Exception as e:
        return {"category": None, "subcategory": None, "success": False, "error": str(e)}


def agent_review(
    raw_description: str,
    merchant_name: str,
    amount: float,
    category_name: str,
    subcategory_name: str,
) -> dict:
    """Agent 3: Review the categorization and correct if necessary."""
    category_tree = _build_category_tree()

    system_prompt = REVIEWER_PROMPT.format(
        raw_description=raw_description,
        merchant_name=merchant_name,
        amount=amount,
        category=category_name or "未分类",
        subcategory=subcategory_name or "无",
        category_tree=category_tree,
    )

    try:
        content = _call_llm(system_prompt, "请审核以上分类结果。", temperature=0.2)
        result = _extract_json(content)

        if not result:
            return {"approved": True}  # Default to approving if we can't parse

        return result
    except Exception:
        return {"approved": True}  # Default to approving on error


# ──────────────────────────────────────────────
# Workflow Orchestrator
# ──────────────────────────────────────────────

def categorize_transaction(description: str, amount: float) -> dict:
    """Classify one transaction with a single Ollama call."""
    category_choices = _build_category_choices()
    corrections = _build_corrections()
    refund_context = _find_refund_candidates(description, amount)
    system_prompt = UNIFIED_CLASSIFY_PROMPT.format(
        category_choices=category_choices,
        corrections=corrections,
        refund_context=refund_context,
    )

    try:
        content = _call_llm(
            system_prompt,
            f'交易描述："{description}"\n交易金额：{amount}',
            temperature=0,
            num_predict=96,
            json_mode=True,
        )
        result = _extract_json(content)
        if not result:
            return {"category_id": None, "subcategory_id": None, "error": "No JSON in response"}
    except Exception as e:
        return {"category_id": None, "subcategory_id": None, "error": str(e)}

    merchant_name = result.get("merchant_name") or description
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
            "merchant_name": merchant_name,
        }

    return {
        "category_id": parent_id,
        "subcategory_id": sub_id,
        "merchant_name": merchant_name,
    }


def categorize_batch(txn_ids: list[int], progress_callback=None) -> dict:
    total = len(txn_ids)
    categorized = 0
    failed = 0
    last_error = None

    def emit_progress(processed: int) -> None:
        if progress_callback:
            progress_callback({
                "total": total,
                "processed": processed,
                "categorized": categorized,
                "failed": failed,
                "error": last_error,
            })

    with db_connection() as conn:
        rows = conn.execute(
            """SELECT id, cleaned_description, raw_description, amount
               FROM transactions
               WHERE id IN ({})""".format(",".join("?" for _ in txn_ids)),
            txn_ids,
        ).fetchall()

        for start in range(0, len(rows), 20):
            chunk = rows[start:start + 20]
            try:
                results = categorize_many_with_llm(chunk)
            except Exception as exc:
                last_error = str(exc)
                results = []
            if not results:
                results = []
                retry_errors = []
                for txn in chunk:
                    single = categorize_transaction(
                        txn["cleaned_description"] or txn["raw_description"],
                        txn["amount"],
                    )
                    if single.get("category_id"):
                        results.append({"id": txn["id"], **single})
                    else:
                        retry_errors.append(single.get("error", "Unknown single-item classification error"))
                if retry_errors:
                    last_error = retry_errors[-1]
                else:
                    last_error = None
            by_id = {int(r.get("id")): r for r in results if r.get("id") is not None}

            for txn in chunk:
                result = by_id.get(txn["id"])
                if not result:
                    failed += 1
                    emit_progress(categorized + failed)
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
                    failed += 1
                    emit_progress(categorized + failed)
                    continue

                merchant = result.get("merchant_name") or txn["cleaned_description"] or txn["raw_description"]
                conn.execute(
                    """UPDATE transactions
                       SET category_id = ?, subcategory_id = ?, is_categorized = 1, cleaned_description = ?
                       WHERE id = ?""",
                    (category_id, subcategory_id, merchant, txn["id"]),
                )
                categorized += 1
                emit_progress(categorized + failed)

    return {"total": total, "categorized": categorized, "failed": failed, "error": last_error}


def categorize_many_with_llm(rows) -> list[dict]:
    category_choices = _build_category_choices()
    corrections = _build_corrections()
    items = [
        {
            "id": r["id"],
            "description": r["cleaned_description"] or r["raw_description"],
            "amount": r["amount"],
        }
        for r in rows
    ]
    system_prompt = f"""你是一个本地账单批量分类助手。根据每条交易描述和金额，输出商户名、一级分类ID、二级分类ID。

分类表：
{category_choices}

用户纠正记录：
{corrections}

规则：
- 每个输入 id 必须返回一条结果。
- category_id 必须选择箭头左侧的一级分类 ID，不能使用箭头右侧的二级分类 ID。
- subcategory_id 必须选择该一级分类箭头右侧的二级分类 ID；不确定时使用对应一级分类下的"其他"子类，如果没有则为 null。
- 只返回 JSON 对象，不要 Markdown 或解释。

JSON 格式：
{{"results":[{{"id":1,"merchant_name":"...","category_id":1,"subcategory_id":2}}]}}"""
    content = _call_llm(
        system_prompt,
        json.dumps(items, ensure_ascii=False),
        temperature=0,
        num_predict=max(256, min(1536, len(items) * 96)),
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
