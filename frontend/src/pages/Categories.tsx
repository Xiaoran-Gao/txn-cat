import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { Category } from "../types";

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showAdd, setShowAdd] = useState<{ parent_id?: number } | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const load = () => {
    api.listCategories().then(setCategories).catch(() => showT("加载失败", "error"));
  };

  useEffect(() => { load(); }, []);

  const showT = (msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (cat: Category) => {
    if (!confirm(`删除"${cat.name}"？其下的交易将变为未分类。`)) return;
    await api.deleteCategory(cat.id);
    showT("已删除");
    load();
  };

  const handleSave = async (name: string, parentId?: number, editId?: number) => {
    if (editId) {
      await api.updateCategory(editId, { name });
    } else {
      await api.createCategory({ name, parent_id: parentId });
    }
    showT("已保存");
    setShowAdd(null);
    setEditing(null);
    load();
  };

  return (
    <div>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="page-header">
        <h1>分类管理</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd({})}>添加大类</button>
      </div>
      <div className="card category-tree">
        {categories.map((cat) => (
          <div key={cat.id} className="cat-item">
            <div className="cat-parent" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{cat.name}</span>
              <div className="inline-actions">
                <button className="btn btn-sm btn-secondary" onClick={() => setShowAdd({ parent_id: cat.id })}>+子类</button>
                <button className="btn btn-sm btn-secondary" onClick={() => setEditing(cat)}>✏️</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cat)}>🗑</button>
              </div>
            </div>
            <div className="cat-subs">
              {cat.children?.map((sub) => (
                <div key={sub.id} className="cat-sub">
                  <span>↳ {sub.name}</span>
                  <div className="inline-actions">
                    <button className="btn btn-sm btn-secondary" onClick={() => setEditing(sub)}>✏️</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(sub)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showAdd && (
        <CategoryForm
          title={showAdd.parent_id ? "添加子分类" : "添加大类"}
          onSave={(name) => handleSave(name, showAdd.parent_id)}
          onClose={() => setShowAdd(null)}
        />
      )}
      {editing && (
        <CategoryForm
          title="编辑分类"
          initialName={editing.name}
          onSave={(name) => handleSave(name, undefined, editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryForm({ title, initialName, onSave, onClose }: { title: string; initialName?: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName || "");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="form-group"><label>名称</label><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => name.trim() && onSave(name.trim())}>保存</button>
        </div>
      </div>
    </div>
  );
}
