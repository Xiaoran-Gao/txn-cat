import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  CreditCard as CreditCardIcon,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "../api/client";
import type { CreditCard, CreditCardInput, CreditCardReminder } from "../types";

type Toast = { msg: string; type: "success" | "error" };

const DEFAULT_FORM: CreditCardInput = {
  name: "",
  issuer: "",
  account_name: "",
  statement_day: 10,
  due_day: 20,
  reminder_days: 3,
  is_active: true,
};

export default function CreditCards() {
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [reminders, setReminders] = useState<CreditCardReminder[]>([]);
  const [accountOptions, setAccountOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CreditCard | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((msg: string, type: Toast["type"] = "success") => {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cardRows = await api.listCreditCards();
      setCards(cardRows);
    } catch {
      setCards([]);
    }

    try {
      const reminderRows = await api.creditCardReminders();
      setReminders(reminderRows);
    } catch {
      setReminders([]);
    }

    try {
      const options = await api.creditCardAccountOptions();
      setAccountOptions(options.available_accounts);
    } catch {
      setAccountOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  const reminderByCardId = useMemo(() => {
    return new Map(reminders.map((item) => [item.card.id, item]));
  }, [reminders]);

  const stats = useMemo(() => {
    const activeCards = cards.filter((card) => card.is_active).length;
    const overdue = reminders.filter((item) => item.status === "overdue").length;
    const dueSoon = reminders.filter((item) => item.status === "due_soon").length;
    const totalRemaining = reminders.reduce((sum, item) => sum + item.remaining_amount, 0);
    return { activeCards, overdue, dueSoon, totalRemaining };
  }, [cards, reminders]);

  const handleSave = async (data: CreditCardInput) => {
    setSaving(true);
    try {
      if (editing) {
        await api.updateCreditCard(editing.id, data);
        showToast("信用卡已更新");
      } else {
        await api.createCreditCard(data);
        showToast("信用卡已添加");
      }
      setEditing(null);
      setShowAdd(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (card: CreditCard) => {
    if (!confirm(`确定删除「${card.name}」？`)) return;
    try {
      await api.deleteCreditCard(card.id);
      showToast("已删除");
      await load();
    } catch {
      showToast("删除失败", "error");
    }
  };

  const handleMarkPaid = async (reminder: CreditCardReminder) => {
    try {
      await api.markCreditCardStatement(reminder.card.id, {
        statement_date: reminder.statement_date,
        marked_paid: true,
      });
      showToast("已标记本期已还");
      await load();
    } catch {
      showToast("标记失败", "error");
    }
  };

  return (
    <div className="credit-card-page">
      {toast ? <div className={`toast ${toast.type}`}>{toast.msg}</div> : null}

      <div className="page-command-row">
        <div>
          <h1>信用卡管理</h1>
          <p>管理账单日、还款日和应用内还款提醒，金额均为基于本地流水的预估。</p>
        </div>
        <div className="command-actions">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} size={16} />
            刷新
          </button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={16} />
            新增信用卡
          </button>
        </div>
      </div>

      <section className="stat-card-grid">
        <StatCard label="启用卡片" value={`${stats.activeCards} 张`} meta={`共 ${cards.length} 张`} icon={<CreditCardIcon size={14} />} tone="cyan" />
        <StatCard label="即将到期" value={`${stats.dueSoon} 张`} meta="3 天内需处理" icon={<Bell size={14} />} tone="orange" />
        <StatCard label="已逾期" value={`${stats.overdue} 张`} meta="建议优先核对" icon={<AlertTriangle size={14} />} tone="violet" />
        <StatCard label="预估待还" value={formatCurrency(stats.totalRemaining)} meta="按本地交易估算" icon={<Landmark size={14} />} tone="green" />
      </section>

      <section className="glass-panel credit-card-panel">
        <div className="panel-title">
          <CreditCardIcon size={18} />
          <span>还款提醒</span>
        </div>
        {loading ? (
          <div className="empty-state">正在加载信用卡提醒...</div>
        ) : cards.length ? (
          <div className="credit-card-list">
            {cards.map((card) => (
              <CreditCardRow
                key={card.id}
                card={card}
                reminder={reminderByCardId.get(card.id) || null}
                onEdit={() => setEditing(card)}
                onDelete={() => handleDelete(card)}
                onMarkPaid={handleMarkPaid}
              />
            ))}
          </div>
        ) : (
          <div className="empty-state">还没有信用卡。添加第一张卡后，就可以看到还款日提醒。</div>
        )}
      </section>

      {(showAdd || editing) ? (
        <CreditCardModal
          card={editing}
          accountOptions={accountOptions}
          usedAccountNames={cards.map((card) => card.account_name)}
          saving={saving}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}

function CreditCardRow({
  card,
  reminder,
  onEdit,
  onDelete,
  onMarkPaid,
}: {
  card: CreditCard;
  reminder: CreditCardReminder | null;
  onEdit: () => void;
  onDelete: () => void;
  onMarkPaid: (reminder: CreditCardReminder) => void;
}) {
  const status = card.is_active && reminder ? reminder.status : "disabled";
  return (
    <article className={`credit-card-row status-${status}`}>
      <div className="credit-card-main">
        <div className="credit-card-icon">
          <CreditCardIcon size={20} />
        </div>
        <div>
          <div className="credit-card-title-line">
            <strong>{card.name}</strong>
            <span className={`status-pill status-${status}`}>{card.is_active && reminder ? reminder.status_label : "已停用"}</span>
          </div>
          <p>{card.issuer || "未填写发卡行"} · {card.account_name}</p>
          <div className="credit-card-date-line">
            <span><CalendarDays size={14} /> 每月 {card.statement_day} 日出账</span>
            <span>每月 {card.due_day} 日还款</span>
            {reminder ? <span>本期账单日 {formatDate(reminder.statement_date)}</span> : null}
          </div>
        </div>
      </div>

      <div className="credit-card-money">
        <span>预估应还</span>
        <strong>{reminder ? formatCurrency(reminder.remaining_amount) : "未启用"}</strong>
        {reminder ? (
          <em>
            到期 {formatDate(reminder.due_date)}
            {reminder.days_until_due >= 0 ? ` · 还有 ${reminder.days_until_due} 天` : ` · 已过 ${Math.abs(reminder.days_until_due)} 天`}
          </em>
        ) : (
          <em>停用卡不生成提醒</em>
        )}
      </div>

      <div className="credit-card-actions">
        {reminder && reminder.status !== "paid" && reminder.status !== "no_bill" ? (
          <button className="btn btn-secondary" onClick={() => onMarkPaid(reminder)}>
            <CheckCircle2 size={16} />
            标记已还
          </button>
        ) : null}
        <button className="icon-btn" onClick={onEdit} title="编辑">
          <Pencil size={16} />
        </button>
        <button className="icon-btn danger" onClick={onDelete} title="删除">
          <Trash2 size={16} />
        </button>
      </div>
    </article>
  );
}

function CreditCardModal({
  card,
  accountOptions,
  usedAccountNames,
  saving,
  onClose,
  onSave,
}: {
  card: CreditCard | null;
  accountOptions: string[];
  usedAccountNames: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (data: CreditCardInput) => void;
}) {
  const selectableAccounts = useMemo(() => {
    const used = new Set(usedAccountNames);
    if (card) used.delete(card.account_name);
    const options = accountOptions.filter((account) => !used.has(account));
    if (card && !options.includes(card.account_name)) options.unshift(card.account_name);
    return options;
  }, [accountOptions, card, usedAccountNames]);

  const [form, setForm] = useState<CreditCardInput>(() => card ? {
    name: card.name,
    issuer: card.issuer || "",
    account_name: card.account_name,
    statement_day: card.statement_day,
    due_day: card.due_day,
    reminder_days: card.reminder_days,
    is_active: card.is_active,
  } : DEFAULT_FORM);

  const setField = <K extends keyof CreditCardInput>(key: K, value: CreditCardInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave({
      ...form,
      name: form.name.trim(),
      issuer: form.issuer?.trim() || null,
      account_name: form.account_name.trim(),
      statement_day: Number(form.statement_day),
      due_day: Number(form.due_day),
      reminder_days: Number(form.reminder_days ?? 3),
      is_active: form.is_active ?? true,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal credit-card-modal" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
        <h2>{card ? "编辑信用卡" : "新增信用卡"}</h2>
        <div className="form-grid two-col">
          <div className="form-group">
            <label>卡片名称</label>
            <input value={form.name} onChange={(event) => setField("name", event.target.value)} required placeholder="例如 招行经典白" />
          </div>
          <div className="form-group">
            <label>发卡行</label>
            <input value={form.issuer || ""} onChange={(event) => setField("issuer", event.target.value)} placeholder="例如 招商银行" />
          </div>
        </div>
        <div className="form-group">
          <label>匹配账户名</label>
          {selectableAccounts.length ? (
            <select
              value={selectableAccounts.includes(form.account_name) ? form.account_name : ""}
              onChange={(event) => setField("account_name", event.target.value)}
              required
            >
              <option value="">选择未添加的交易账户</option>
              {selectableAccounts.map((account) => <option key={account} value={account}>{account}</option>)}
            </select>
          ) : (
            <input
              className="account-name-fallback"
              value={form.account_name}
              onChange={(event) => setField("account_name", event.target.value)}
              required
              placeholder="暂无未添加账户，可手动填写账户名"
            />
          )}
        </div>
        <div className="form-grid three-col">
          <div className="form-group">
            <label>账单日</label>
            <input type="number" min={1} max={31} value={form.statement_day} onChange={(event) => setField("statement_day", Number(event.target.value))} required />
          </div>
          <div className="form-group">
            <label>还款日</label>
            <input type="number" min={1} max={31} value={form.due_day} onChange={(event) => setField("due_day", Number(event.target.value))} required />
          </div>
          <div className="form-group">
            <label>提前提醒</label>
            <input type="number" min={0} value={form.reminder_days ?? 3} onChange={(event) => setField("reminder_days", Number(event.target.value))} required />
          </div>
        </div>
        <label className="checkbox-line">
          <input type="checkbox" checked={form.is_active ?? true} onChange={(event) => setField("is_active", event.target.checked)} />
          启用还款提醒
        </label>
        <div className="form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <RefreshCw className="spin" size={16} /> : <CheckCircle2 size={16} />}
            保存
          </button>
        </div>
      </form>
    </div>
  );
}

function StatCard({ label, value, meta, icon, tone }: { label: string; value: string; meta: string; icon: ReactNode; tone: string }) {
  return (
    <div className={`stat-card ${tone}`}>
      <div>
        <span>{icon}{label}</span>
        <strong>{value}</strong>
        <em>{meta}</em>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return `¥${value.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function formatDate(value: string) {
  return value.slice(5).replace("-", "/");
}
