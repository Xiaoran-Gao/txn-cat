import { useState, useEffect, useCallback, type KeyboardEvent, type MouseEvent } from "react";
import { api } from "../api/client";
import type { Category } from "../types";
import { ChevronDown, ChevronRight, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";

export default function Categories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [activeId, setActiveId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState<{ parent_id?: number } | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const showT = useCallback((msg: string, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(() => {
    api.listCategories()
      .then((data) => {
        setCategories(data);
      })
      .catch(() => showT("加载失败", "error"));
  }, [showT]);

  useEffect(() => { load(); }, [load]);

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

  const toggleExpanded = (cat: Category) => {
    setActiveId(cat.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(cat.id)) next.delete(cat.id);
      else next.add(cat.id);
      return next;
    });
  };

  const stopAction = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const handleNodeKeyDown = (event: KeyboardEvent, cat: Category) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExpanded(cat);
  };

  return (
    <div className="surface">
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      <div className="page-header app-hero">
        <div>
          <h1>分类管理</h1>
          <p>维护你的消费分类树，让 AI 分类和问答都更贴近真实习惯。</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd({})}><Plus size={16} />添加大类</button>
      </div>
      <div className="category-summary">
        <div>
          <FolderTree size={20} />
          <span>分类结构</span>
        </div>
        <strong>{categories.length}</strong>
        <span>个一级分类</span>
        <strong>{categories.reduce((sum, cat) => sum + (cat.children?.length || 0), 0)}</strong>
        <span>个子分类</span>
      </div>
      <div className="category-layout">
      <div className="category-tree">
        {categories.length === 0 ? (
          <div className="category-empty-state">
            <FolderTree size={28} />
            <strong>暂无分类</strong>
            <span>先添加一个大类，之后可以在树里继续补子类。</span>
            <button className="btn btn-primary" onClick={() => setShowAdd({})}><Plus size={16} />添加大类</button>
          </div>
        ) : categories.map((cat) => {
          const isExpanded = expandedIds.has(cat.id);
          const childCount = cat.children?.length || 0;
          return (
            <div key={cat.id} className={`cat-item ${activeId === cat.id ? "active" : ""} ${isExpanded ? "expanded" : ""}`}>
              <div
                className="cat-parent tree-node-btn"
                role="button"
                tabIndex={0}
                onClick={() => toggleExpanded(cat)}
                onKeyDown={(event) => handleNodeKeyDown(event, cat)}
              >
                <span className={`tree-toggle ${childCount === 0 ? "empty" : ""}`}>
                  {childCount > 0 ? (isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />) : null}
                </span>
                <span className="tree-node-main">
                  <strong>{cat.name}</strong>
                  <em>{childCount} 个子类</em>
                </span>
                <span className="inline-actions" onClick={stopAction}>
                  <button className="btn btn-sm btn-secondary" onClick={() => { setActiveId(cat.id); setShowAdd({ parent_id: cat.id }); }}><Plus size={13} />子类</button>
                  <button className="icon-btn" onClick={() => { setActiveId(cat.id); setEditing(cat); }} title="编辑"><Pencil size={14} /></button>
                  <button className="icon-btn danger" onClick={() => handleDelete(cat)} title="删除"><Trash2 size={14} /></button>
                </span>
              </div>
              {isExpanded && (
                <div className="cat-subs">
                  {childCount === 0 ? (
                    <button className="cat-sub empty-sub" onClick={() => setShowAdd({ parent_id: cat.id })}><Plus size={14} />添加第一个子类</button>
                  ) : cat.children?.map((sub) => (
                    <div key={sub.id} className={`cat-sub ${activeId === sub.id ? "active" : ""}`} onClick={() => setActiveId(sub.id)}>
                      <span>{sub.name}</span>
                      <div className="inline-actions">
                        <button className="icon-btn" onClick={() => { setActiveId(sub.id); setEditing(sub); }} title="编辑"><Pencil size={14} /></button>
                        <button className="icon-btn danger" onClick={() => handleDelete(sub)} title="删除"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
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
