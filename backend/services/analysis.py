from database import db_connection
from services.categorizer import _call_llm


MONTHLY_SUMMARY_SYSTEM_PROMPT = """你是一个个人消费分析助手。

下面是已经由代码计算好的消费分析结果。
请注意：

1. 不要重新计算任何数字。
2. 不要编造输入中不存在的信息。
3. 只引用给定 JSON 中的事实。
4. 输出要简洁、自然，适合普通用户阅读。
5. 不要使用太重的金融术语。

请按照以下结构输出：

1. 总体消费情况
2. 主要消费类别变化
3. 商户 / 平台消费习惯
4. 异常交易提醒
5. 下月建议
"""


def get_monthly_summary(month: str) -> dict:
    """Get spending summary for a given month (YYYY-MM)."""
    with db_connection() as conn:
        # Total spend (positive amounts)
        spend_row = conn.execute(
            """SELECT COALESCE(SUM(amount), 0) as total_spend, COUNT(*) as txn_count
               FROM transactions
               WHERE strftime('%Y-%m', date) = ? AND amount > 0""",
            (month,),
        ).fetchone()

        # Total income (negative amounts treated as income)
        income_row = conn.execute(
            """SELECT COALESCE(SUM(ABS(amount)), 0) as total_income
               FROM transactions
               WHERE strftime('%Y-%m', date) = ? AND amount < 0""",
            (month,),
        ).fetchone()

        # Top category for the month
        top_cat = conn.execute(
            """SELECT c.name
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE strftime('%Y-%m', t.date) = ? AND t.amount > 0
               GROUP BY t.category_id
               ORDER BY SUM(t.amount) DESC
               LIMIT 1""",
            (month,),
        ).fetchone()

        # Previous month for MoM calculation
        year, m = month.split("-")
        prev_month = f"{int(year) - 1}-12" if m == "01" else f"{year}-{int(m) - 1:02d}"
        prev_spend = conn.execute(
            """SELECT COALESCE(SUM(amount), 0) as total
               FROM transactions
               WHERE strftime('%Y-%m', date) = ? AND amount > 0""",
            (prev_month,),
        ).fetchone()

        mom_change = None
        if prev_spend["total"] > 0:
            mom_change = round(
                (spend_row["total_spend"] - prev_spend["total"]) / prev_spend["total"] * 100, 1
            )

        return {
            "month": month,
            "total_spend": round(spend_row["total_spend"], 2),
            "total_income": round(income_row["total_income"], 2),
            "transaction_count": spend_row["txn_count"],
            "mom_change_pct": mom_change,
            "top_category": top_cat["name"] if top_cat else None,
        }


def generate_monthly_narrative(analytics: dict) -> dict:
    """Turn precomputed monthly analytics JSON into a concise local LLM narrative."""
    import json

    if not isinstance(analytics, dict):
        return {"summary": "", "source": "fallback"}

    payload = json.dumps(analytics, ensure_ascii=False, indent=2)
    prompt = f"输入数据：\n{payload}"
    try:
        summary = _call_llm(
            MONTHLY_SUMMARY_SYSTEM_PROMPT,
            prompt,
            temperature=0.2,
            num_predict=700,
            json_mode=False,
        )
    except Exception:
        return {"summary": "", "source": "fallback"}

    return {"summary": summary.strip(), "source": "llm" if summary.strip() else "fallback"}


def get_trends(months: int = 12) -> list[dict]:
    """Compute per-category spending trends over the last N months."""
    with db_connection() as conn:
        categories = conn.execute(
            "SELECT id, name FROM categories WHERE parent_id IS NULL ORDER BY id"
        ).fetchall()

        trends = []
        for cat in categories:
            rows = conn.execute(
                """SELECT strftime('%Y-%m', date) as month, SUM(amount) as total
                   FROM transactions
                   WHERE category_id = ? AND amount > 0
                     AND date >= date('now', ? || ' months')
                   GROUP BY month
                   ORDER BY month""",
                (cat["id"], f"-{months}"),
            ).fetchall()

            if len(rows) < 3:
                trends.append({
                    "category_id": cat["id"],
                    "category_name": cat["name"],
                    "trend_pct": 0,
                    "trend_label": "数据不足",
                })
                continue

            # Simple linear regression on monthly totals
            amounts = [r["total"] for r in rows]
            n = len(amounts)
            x_avg = (n - 1) / 2
            y_avg = sum(amounts) / n

            num = sum((i - x_avg) * (amounts[i] - y_avg) for i in range(n))
            den = sum((i - x_avg) ** 2 for i in range(n))

            if den == 0 or y_avg == 0:
                trend_pct = 0
            else:
                slope = num / den
                trend_pct = round(slope / y_avg * 100 * n, 1)

            if trend_pct > 5:
                label = f"上升 {trend_pct}%"
            elif trend_pct < -5:
                label = f"下降 {abs(trend_pct)}%"
            else:
                label = "稳定"

            trends.append({
                "category_id": cat["id"],
                "category_name": cat["name"],
                "trend_pct": trend_pct,
                "trend_label": label,
            })

        return sorted(trends, key=lambda t: t["trend_pct"], reverse=True)


def get_anomalies(month: str) -> list[dict]:
    """Detect anomalies for a given month."""
    anomalies = []

    with db_connection() as conn:
        # Category-level anomaly: spend > 2σ above 3-month moving average
        categories = conn.execute(
            "SELECT id, name FROM categories WHERE parent_id IS NULL"
        ).fetchall()

        for cat in categories:
            year, m = month.split("-")
            prev_months = []
            ym = int(year) * 12 + int(m) - 1
            for i in range(1, 4):
                py = (ym - i) // 12
                pm = (ym - i) % 12 + 1
                prev_months.append(f"{py}-{pm:02d}")

            past_totals = []
            for pm in prev_months:
                row = conn.execute(
                    """SELECT COALESCE(SUM(amount), 0) as total
                       FROM transactions
                       WHERE strftime('%Y-%m', date) = ? AND category_id = ? AND amount > 0""",
                    (pm, cat["id"]),
                ).fetchone()
                past_totals.append(row["total"])

            current = conn.execute(
                """SELECT COALESCE(SUM(amount), 0) as total
                   FROM transactions
                   WHERE strftime('%Y-%m', date) = ? AND category_id = ? AND amount > 0""",
                (month, cat["id"]),
            ).fetchone()

            avg = sum(past_totals) / 3
            var = sum((x - avg) ** 2 for x in past_totals) / 3
            std = var ** 0.5

            if std > 0 and current["total"] > avg + 2 * std:
                anomalies.append({
                    "type": "category_spike",
                    "category_name": cat["name"],
                    "amount": round(current["total"], 2),
                    "expected": round(avg, 2),
                    "detail": f'{cat["name"]}本月支出 {current["total"]:.2f}，显著高于近3月均值 {avg:.2f}',
                })

        # Transaction-level anomaly: IQR method within each subcategory
        subcats = conn.execute(
            "SELECT id, name FROM categories WHERE parent_id IS NOT NULL"
        ).fetchall()

        for sc in subcats:
            txn_rows = conn.execute(
                """SELECT id, display_description, amount
                   FROM transactions
                   WHERE subcategory_id = ? AND amount > 0
                     AND date >= date('now', '-6 months')""",
                (sc["id"],),
            ).fetchall()

            if len(txn_rows) < 5:
                continue

            amounts = sorted(r["amount"] for r in txn_rows)
            q1 = amounts[len(amounts) // 4]
            q3 = amounts[3 * len(amounts) // 4]
            iqr = q3 - q1
            upper = q3 + 1.5 * iqr

            for r in txn_rows:
                if r["amount"] > upper:
                    anomalies.append({
                        "type": "unusual_transaction",
                        "category_name": sc["name"],
                        "transaction_id": r["id"],
                        "description": r["display_description"],
                        "amount": round(r["amount"], 2),
                        "detail": f'交易"{r["display_description"]}"金额 {r["amount"]:.2f} 在"{sc["name"]}"中异常偏高',
                    })

    return anomalies[:20]


def get_monthly_spend(months: int = 12) -> list[dict]:
    """Get monthly spend by category for trend charts."""
    with db_connection() as conn:
        rows = conn.execute(
            """SELECT strftime('%Y-%m', date) as month,
                      c.name as category_name,
                      SUM(t.amount) as total
               FROM transactions t
               JOIN categories c ON t.category_id = c.id
               WHERE t.amount > 0
                 AND date >= date('now', ? || ' months')
               GROUP BY month, category_name
               ORDER BY month""",
            (f"-{months}",),
        ).fetchall()

        data = {}
        categories_set = set()
        for r in rows:
            categories_set.add(r["category_name"])
            if r["month"] not in data:
                data[r["month"]] = {}
            data[r["month"]][r["category_name"]] = round(r["total"], 2)

        return {
            "categories": sorted(categories_set),
            "data": [
                {"month": month, **cats} for month, cats in sorted(data.items())
            ],
        }
