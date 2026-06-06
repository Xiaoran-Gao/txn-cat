import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";
import { Bot, DatabaseZap, Send, Sparkles, User } from "lucide-react";
import type { NLQueryResult } from "../types";

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: NLQueryResult["data"];
}

const EXAMPLE_QUESTIONS = [
  "上个月我的总支出是多少？",
  "餐饮美食上个月花了多少钱？",
  "今年支出最高的三个月份是哪些？",
  "交通出行最近6个月的支出趋势如何？",
  "这个月有没有特别大额的交易？",
  "我最常用的外卖平台是什么？",
];

export default function NLQuery() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const result = await api.query(question);
      setMessages((prev) => [...prev, {
        role: "assistant",
        content: result.answer,
        sql: result.sql,
        data: result.data,
      }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "查询出错，请检查Ollama是否运行。" }]);
    }
    setLoading(false);
  };

  return (
    <div className="surface">
      <div className="page-header app-hero">
        <div>
          <h1>智能问答</h1>
          <p>把中文问题转换成安全的只读 SQL，并把答案还给你。</p>
        </div>
        <div className="hero-chip"><DatabaseZap size={16} /> Read-only SQL</div>
      </div>
      <div className="chat-container modern-chat">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="empty-icon"><Sparkles size={28} /></div>
              <p>用自然语言询问你的消费情况</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="message-icon">{m.role === "user" ? <User size={15} /> : <Bot size={15} />}</div>
              <div>{m.content}</div>
              {m.sql && <div className="sql">{m.sql}</div>}
              {m.data && m.data.length > 0 && (
                <div className="data-table">
                  <table style={{ width: "100%", marginTop: 8 }}>
                    <thead><tr>{Object.keys(m.data[0]).map((k) => <th key={k}>{k}</th>)}</tr></thead>
                    <tbody>
                      {m.data.slice(0, 10).map((row, ri) => (
                        <tr key={ri}>{Object.values(row).map((v, vi) => <td key={vi}>{String(v)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {loading && <div className="chat-msg assistant"><div className="message-icon"><Bot size={15} /></div>思考中...</div>}
          <div ref={endRef} />
        </div>
        <div className="suggestions">
          {EXAMPLE_QUESTIONS.map((q) => (
            <button key={q} onClick={() => send(q)}>{q}</button>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            placeholder="输入问题，例如：上个月我在外卖上花了多少钱？"
          />
          <button className="icon-submit" onClick={() => send(input)} disabled={loading} title="发送"><Send size={18} /></button>
        </div>
      </div>
    </div>
  );
}
