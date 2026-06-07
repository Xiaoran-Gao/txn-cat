import re
import ollama
from config import OLLAMA_BASE_URL, OLLAMA_MODEL
from database import db_connection

NL_QUERY_SYSTEM_PROMPT = """你是一个SQLite查询助手。根据用户的自然语言问题，生成一个SQLite查询语句。

数据库schema如下：
- transactions(id, date DATE, raw_description TEXT, cleaned_description TEXT, amount REAL, currency TEXT, category_id INTEGER, subcategory_id INTEGER, classification_confidence INTEGER, classification_review_status TEXT, classification_review_reason TEXT, source TEXT, is_categorized INTEGER, created_at TIMESTAMP)
- categories(id, name, parent_id)  -- parent_id IS NULL 表示大类，NOT NULL 表示子类
- merchant_mappings(id, pattern, display_name, is_regex)
- correction_examples(id, description, category_id, subcategory_id, created_at)

重要规则：
- 只生成SELECT语句，绝对禁止INSERT/UPDATE/DELETE/DROP/ALTER/CREATE等写操作。
- 金额字段amount：正值表示支出，负值表示收入。用户问"花了多少钱/支出"时用 amount > 0，问"收入"时用 amount < 0。
- 日期字段date格式为'YYYY-MM-DD'，可用strftime函数。
- 获取大类名称：categories WHERE parent_id IS NULL
- 获取子类名称：categories WHERE parent_id IS NOT NULL
- 只返回SQL语句，一行，不要有其他文字，不要用markdown代码块包裹。"""


def execute_nl_query(question: str) -> dict:
    """Convert natural language to SQL, execute it, and return results."""

    # Generate SQL via LLM
    client = ollama.Client(host=OLLAMA_BASE_URL)
    response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": NL_QUERY_SYSTEM_PROMPT},
            {"role": "user", "content": f"用户问题：{question}"},
        ],
        options={"temperature": 0.1},
    )

    sql = response["message"]["content"].strip()
    sql = re.sub(r"^```(?:sql)?\s*", "", sql)
    sql = re.sub(r"\s*```$", "", sql)
    sql = sql.strip().rstrip(";")

    # Validate it's read-only
    dangerous = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "ATTACH", "DETACH"]
    sql_upper = sql.upper()
    for keyword in dangerous:
        if keyword in sql_upper:
            return {
                "answer": f"查询被拒绝：SQL包含禁止的操作 ({keyword})。请重新提问。",
                "sql": sql,
                "data": None,
            }

    # Execute query
    try:
        with db_connection() as conn:
            rows = conn.execute(sql).fetchall()
            data = [dict(r) for r in rows]
    except Exception as e:
        return {
            "answer": f"查询执行出错：{str(e)}",
            "sql": sql,
            "data": None,
        }

    # Generate human-readable answer via LLM
    answer_response = client.chat(
        model=OLLAMA_MODEL,
        messages=[
            {"role": "system", "content": "你是一个个人财务助手。根据用户的自然语言问题和数据库查询结果，用简洁的中文回答用户。如果数据为空，诚实告知。金额保留两位小数，加上货币符号¥。"},
            {"role": "user", "content": f"用户问题：{question}\n\n查询SQL：{sql}\n\n查询结果：{data}"},
        ],
        options={"temperature": 0.3},
    )

    return {
        "answer": answer_response["message"]["content"].strip(),
        "sql": sql,
        "data": data,
    }
