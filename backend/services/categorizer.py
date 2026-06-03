import json
import re
import ollama
from config import OLLAMA_BASE_URL, OLLAMA_MODEL, MAX_CORRECTION_EXAMPLES
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


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _call_llm(system_prompt: str, user_prompt: str, temperature: float = 0.1) -> str:
    client = ollama.Client(host=OLLAMA_BASE_URL)
    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        options={"temperature": temperature},
    )
    return response["message"]["content"].strip()


def _extract_json(text: str) -> dict | None:
    """Extract and parse JSON from LLM response."""
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```", "", text)
    json_match = re.search(r"\{[^{}]*\}", text)
    if not json_match:
        return None
    try:
        return json.loads(json_match.group(0))
    except json.JSONDecodeError:
        return None


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
    """Run the full 3-agent categorization pipeline."""

    # Step 1: Normalize the description
    norm_result = agent_normalize(description)
    if not norm_result["success"]:
        return {"category_id": None, "subcategory_id": None, "error": f"Normalizer: {norm_result.get('error')}"}

    merchant_name = norm_result["merchant_name"]

    # Step 2: Categorize the clean merchant name
    cat_result = agent_categorize(merchant_name, amount, description)
    if not cat_result["success"]:
        return {"category_id": None, "subcategory_id": None, "error": f"Categorizer: {cat_result.get('error')}"}

    category_name = cat_result.get("category_name", "")
    subcategory_name = cat_result.get("subcategory_name", "")

    # Step 3: Review and refine
    review_result = agent_review(
        description, merchant_name, amount, category_name, subcategory_name
    )

    if not review_result.get("approved", True):
        # Reviewer suggested a correction — use it
        category_name = review_result.get("category", category_name)
        subcategory_name = review_result.get("subcategory", subcategory_name)

    # Resolve names to IDs
    parent_id = _get_category_id(category_name)
    sub_id = _get_category_id(subcategory_name, parent_id) if parent_id else None

    if parent_id is None:
        return {
            "category_id": None,
            "subcategory_id": None,
            "error": f"Category not found: {category_name}",
            "merchant_name": merchant_name,
            "reviewed": not review_result.get("approved", True),
        }

    return {
        "category_id": parent_id,
        "subcategory_id": sub_id,
        "merchant_name": merchant_name,
        "reviewed": not review_result.get("approved", True),
    }


def categorize_batch(txn_ids: list[int]) -> dict:
    total = len(txn_ids)
    categorized = 0
    failed = 0

    with db_connection() as conn:
        for txn_id in txn_ids:
            txn = conn.execute(
                "SELECT cleaned_description, raw_description, amount FROM transactions WHERE id = ?",
                (txn_id,),
            ).fetchone()
            if not txn:
                failed += 1
                continue

            # Use cleaned_description as input — rule-based normalizer already stripped
            # mechanical noise so the LLM Normalizer can focus on semantic extraction
            desc = txn["cleaned_description"] or txn["raw_description"]

            result = categorize_transaction(desc, txn["amount"])

            if result.get("category_id"):
                # If the normalizer produced a better merchant name, update cleaned_description
                merchant = result.get("merchant_name")
                if merchant and merchant != txn["cleaned_description"]:
                    conn.execute(
                        "UPDATE transactions SET category_id = ?, subcategory_id = ?, is_categorized = 1, cleaned_description = ? WHERE id = ?",
                        (result["category_id"], result.get("subcategory_id"), merchant, txn_id),
                    )
                else:
                    conn.execute(
                        "UPDATE transactions SET category_id = ?, subcategory_id = ?, is_categorized = 1 WHERE id = ?",
                        (result["category_id"], result.get("subcategory_id"), txn_id),
                    )
                categorized += 1
            else:
                failed += 1

    return {"total": total, "categorized": categorized, "failed": failed}


def check_ollama() -> bool:
    try:
        client = ollama.Client(host=OLLAMA_BASE_URL)
        client.list()
        return True
    except Exception:
        return False
