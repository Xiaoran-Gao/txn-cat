from fastapi import APIRouter, HTTPException
from database import db_connection
from models import CategoryCreate, CategoryUpdate

router = APIRouter()


@router.get("")
def list_categories():
    with db_connection() as conn:
        parents = conn.execute(
            "SELECT id, name, parent_id FROM categories WHERE parent_id IS NULL ORDER BY id"
        ).fetchall()
        result = []
        for p in parents:
            subs = conn.execute(
                "SELECT id, name, parent_id FROM categories WHERE parent_id = ? ORDER BY id",
                (p["id"],),
            ).fetchall()
            result.append({
                "id": p["id"],
                "name": p["name"],
                "parent_id": None,
                "children": [{"id": s["id"], "name": s["name"], "parent_id": s["parent_id"]} for s in subs],
            })
        return result


@router.post("")
def create_category(cat: CategoryCreate):
    with db_connection() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO categories (name, parent_id) VALUES (?, ?)",
                (cat.name, cat.parent_id),
            )
            return {"id": cur.lastrowid}
        except Exception:
            raise HTTPException(400, "Category already exists or invalid parent")


@router.put("/{cat_id}")
def update_category(cat_id: int, cat: CategoryUpdate):
    with db_connection() as conn:
        conn.execute("UPDATE categories SET name = ? WHERE id = ?", (cat.name, cat_id))
    return {"status": "ok"}


@router.delete("/{cat_id}")
def delete_category(cat_id: int, reassign_to: int | None = None):
    with db_connection() as conn:
        if reassign_to:
            conn.execute(
                "UPDATE transactions SET category_id = ? WHERE category_id = ?",
                (reassign_to, cat_id),
            )
            conn.execute(
                "UPDATE transactions SET subcategory_id = NULL WHERE subcategory_id = ?",
                (cat_id,),
            )
        conn.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    return {"status": "ok"}
