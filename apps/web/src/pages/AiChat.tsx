import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, Sparkles, User, Plus, History, MessageSquare } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { Card, CardBody, Button, Input, Badge } from "../components/ui";
import { BarRankChart, TrendChart } from "../components/charts";
import { num, timeAgo, cn } from "../lib/utils";
import type { ChatMessage } from "../lib/types";

interface ConversationSummary { id: string; title: string; createdAt: string; _count: { messages: number } }
interface StoredMessage { id: string; role: string; content: string; data: ChatMessage | null }

const SUGGESTIONS = [
  "Show the top 10 customers",
  "Which month had the highest sales?",
  "Predict next month's revenue",
  "Which products are declining?",
  "Show inventory risk",
  "What region is growing fastest?",
];

interface Turn { role: "user" | "assistant"; text: string; result?: ChatMessage; }

export default function AiChat() {
  const qc = useQueryClient();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<{ conversations: ConversationSummary[] }>("/ai/conversations") });

  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [turns, loading]);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setTurns((t) => [...t, { role: "user", text: question }]); setInput(""); setLoading(true);
    try {
      const r = await api.post<{ conversationId: string; message: ChatMessage }>("/ai/chat", { message: question, conversationId });
      setConversationId(r.conversationId);
      setTurns((t) => [...t, { role: "assistant", text: r.message.explanation, result: r.message }]);
      qc.invalidateQueries({ queryKey: ["conversations"] }); // history + dashboard checklist
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", text: e instanceof ApiError ? e.message : "Something went wrong. Upload a dataset first." }]);
    } finally { setLoading(false); }
  }

  function newChat() {
    setConversationId(undefined); setTurns([]); setHistoryOpen(false);
  }

  async function openConversation(id: string) {
    setHistoryOpen(false);
    try {
      const { conversation } = await api.get<{ conversation: { messages: StoredMessage[] } }>(`/ai/conversations/${id}`);
      setConversationId(id);
      setTurns(conversation.messages.map((m) => m.role === "user"
        ? { role: "user", text: m.content }
        : { role: "assistant", text: m.content, result: m.data ?? undefined }));
    } catch { /* stale/deleted conversation — leave current view */ }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">Chat with your Data</h1><p className="text-sm text-slate-500">Ask questions in plain English. Answers are computed directly from your dataset.</p></div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative">
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen}>
              <History className="h-4 w-4" /> History
            </Button>
            {historyOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHistoryOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 top-full z-50 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-white p-1.5 shadow-dropdown dark:border-slate-700 dark:bg-slate-800">
                  {conversations.data?.conversations.length ? conversations.data.conversations.map((c) => (
                    <button key={c.id} onClick={() => openConversation(c.id)} className={cn("flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100 dark:hover:bg-slate-700", c.id === conversationId && "bg-slate-100 dark:bg-slate-700")}>
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-700 dark:text-slate-200">{c.title}</span><span className="text-xs text-slate-400">{timeAgo(c.createdAt)} · {c._count.messages} messages</span></span>
                    </button>
                  )) : <p className="px-3 py-4 text-center text-xs text-slate-400">No past conversations yet</p>}
                </div>
              </>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={newChat}><Plus className="h-4 w-4" /> New chat</Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        {turns.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 dark:border-slate-700">
            <div className="mb-3 flex items-center gap-2 text-slate-500"><Sparkles className="h-4 w-4" />Try asking:</div>
            <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm hover:border-brand-400 hover:text-brand-600 dark:border-slate-700">{s}</button>)}</div>
          </div>
        )}
        {turns.map((t, i) => t.role === "user" ? (
          <div key={i} className="flex justify-end gap-2">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2 text-sm text-white">{t.text}</div>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700"><User className="h-4 w-4" /></div>
          </div>
        ) : (
          <div key={i} className="flex gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-950"><Sparkles className="h-4 w-4" /></div>
            <div className="max-w-[85%] space-y-3">
              <div className="rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm shadow-sm dark:bg-slate-900">
                <p>{t.text}</p>
                {t.result && t.result.confidence > 0 && <div className="mt-2"><Badge tone={t.result.confidence >= 0.7 ? "green" : t.result.confidence >= 0.4 ? "amber" : "slate"}>Confidence {Math.round(t.result.confidence * 100)}%</Badge></div>}
              </div>
              {t.result?.metrics && t.result.metrics.length > 0 && !t.result.chart && (
                <div className="flex flex-wrap gap-2">{t.result.metrics.map((m) => <div key={m.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"><div className="text-xs text-slate-500">{m.label}</div><div className="font-semibold">{num(m.value)}</div></div>)}</div>
              )}
              {t.result?.chart && (
                <Card><CardBody>{t.result.chart.type === "bar" ? <BarRankChart data={t.result.chart.data} /> : <TrendChart data={t.result.chart.data} />}</CardBody></Card>
              )}
              {t.result?.table && (
                <Card><CardBody className="overflow-x-auto p-0">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-left dark:border-slate-800 dark:bg-slate-800/50"><tr>{t.result.table.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{t.result.table.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className="px-3 py-1.5">{typeof cell === "number" ? num(cell) : String(cell)}</td>)}</tr>)}</tbody>
                  </table>
                </CardBody></Card>
              )}
            </div>
          </div>
        ))}
        {loading && <div className="flex gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-950"><Sparkles className="h-4 w-4 animate-pulse" /></div><div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-400 shadow-sm dark:bg-slate-900">Analyzing…</div></div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your data…" className="flex-1" />
        <Button type="submit" loading={loading} disabled={!input.trim()} aria-label="Send question"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
