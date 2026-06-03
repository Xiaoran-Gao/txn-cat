import { useState, useRef, useEffect } from "react";
import { api } from "../api/client";

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  data?: Record<string, any>[] | null;
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
    <div>
      <div className="page-header"><h1>智能问答</h1></div>
      <div className="chat-container">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <p style={{ fontSize: 32 }}>💬</p>
              <p>用自然语言询问你的消费情况</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
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
          {loading && <div className="chat-msg assistant">思考中...</div>}
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
          <button className="btn btn-primary" onClick={() => send(input)} disabled={loading}>发送</button>
        </div>
      </div>
    </div>
  );
}
