import { type ReactNode, useEffect, useRef, useState } from "react";
import { GripVertical, MoreHorizontal, Maximize2, Copy, Trash2, Scaling, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";
import { formatKpiValue, type KpiFormat } from "../lib/kpi";
import { DUR, EASE } from "../lib/motion";
import { Dropdown, DropdownItem, Modal, Button } from "./ui";

// A configurable widget grid: drag to reorder, cycle size, duplicate, remove,
// fullscreen, add from a palette — persisted per user in localStorage.

export type WidgetSize = "sm" | "md" | "lg";
export type WidgetItem = { id: string; type: string; title: string; size: WidgetSize };

const SPAN: Record<WidgetSize, string> = { sm: "lg:col-span-1", md: "lg:col-span-2", lg: "lg:col-span-4" };
const NEXT: Record<WidgetSize, WidgetSize> = { sm: "md", md: "lg", lg: "sm" };

const isWidget = (x: unknown): x is WidgetItem =>
  !!x && typeof x === "object" &&
  typeof (x as WidgetItem).id === "string" && typeof (x as WidgetItem).type === "string" &&
  typeof (x as WidgetItem).title === "string" && (x as WidgetItem).size in SPAN;

// Guard against malformed or stale-schema payloads — a partial item would render
// undefined grid spans and blank bodies with no recovery but a manual reset.
function load(key: string, initial: WidgetItem[]): WidgetItem[] {
  try {
    const s = localStorage.getItem(key);
    if (s) { const parsed = JSON.parse(s); if (Array.isArray(parsed) && parsed.every(isWidget)) return parsed; }
  } catch { /* fall through */ }
  return initial;
}
const uid = (type: string) => `${type}-${Date.now()}-${Math.round(Math.random() * 1e4)}`;

export function WidgetGrid({
  storageKey,
  initial,
  renderBody,
  palette,
}: {
  storageKey: string;
  initial: WidgetItem[];
  renderBody: (item: WidgetItem) => ReactNode;
  palette?: { type: string; title: string; size?: WidgetSize }[];
}) {
  const [items, setItems] = useState<WidgetItem[]>(() => load(storageKey, initial));
  const [fullscreen, setFullscreen] = useState<WidgetItem | null>(null);
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(items)); }, [items, storageKey]);

  const update = (id: string, patch: Partial<WidgetItem>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const remove = (id: string) => setItems((xs) => xs.filter((x) => x.id !== id));
  const duplicate = (item: WidgetItem) => setItems((xs) => { const i = xs.findIndex((x) => x.id === item.id); const copy = { ...item, id: uid(item.type) }; return [...xs.slice(0, i + 1), copy, ...xs.slice(i + 1)]; });
  const add = (p: { type: string; title: string; size?: WidgetSize }) => setItems((xs) => [...xs, { id: uid(p.type), type: p.type, title: p.title, size: p.size ?? "md" }]);
  const reset = () => setItems(initial);

  const onDragOver = (overId: string) => {
    const from = dragId.current;
    if (!from || from === overId) return;
    setItems((xs) => {
      const fromI = xs.findIndex((x) => x.id === from);
      const overI = xs.findIndex((x) => x.id === overId);
      if (fromI < 0 || overI < 0) return xs;
      const next = [...xs];
      const [moved] = next.splice(fromI, 1);
      next.splice(overI, 0, moved);
      return next;
    });
  };

  return (
    <div>
      {(palette || items.length !== initial.length) && (
        <div className="mb-4 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={reset}>Reset layout</Button>
          {palette && (
            <Dropdown
              align="right"
              trigger={<Button variant="outline" size="sm"><Plus className="h-4 w-4" />Add widget</Button>}
            >
              {(close) => (
                <div className="w-52">
                  {palette.map((p) => <DropdownItem key={p.type + p.title} onClick={() => { add(p); close(); }}>{p.title}</DropdownItem>)}
                </div>
              )}
            </Dropdown>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => { dragId.current = item.id; setDragging(item.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => { dragId.current = null; setDragging(null); }}
            onDragOver={(e) => { e.preventDefault(); onDragOver(item.id); }}
            className={cn(
              "flex flex-col overflow-hidden rounded-xl border border-border bg-white transition-shadow dark:border-white/[0.06] dark:bg-slate-900/70",
              SPAN[item.size],
              dragging === item.id && "opacity-60 ring-2 ring-brand-500",
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 dark:border-white/[0.06]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="cursor-grab text-slate-300 active:cursor-grabbing dark:text-slate-600" aria-hidden><GripVertical className="h-4 w-4" /></span>
                <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h3>
              </div>
              <Dropdown
                align="right"
                trigger={<button className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10" aria-label="Widget actions"><MoreHorizontal className="h-4 w-4" /></button>}
              >
                {(close) => (
                  <div className="w-44">
                    <DropdownItem icon={Scaling} onClick={() => { update(item.id, { size: NEXT[item.size] }); close(); }}>Resize ({item.size} → {NEXT[item.size]})</DropdownItem>
                    <DropdownItem icon={Maximize2} onClick={() => { setFullscreen(item); close(); }}>Fullscreen</DropdownItem>
                    <DropdownItem icon={Copy} onClick={() => { duplicate(item); close(); }}>Duplicate</DropdownItem>
                    <DropdownItem icon={Trash2} danger onClick={() => { remove(item.id); close(); }}>Remove</DropdownItem>
                  </div>
                )}
              </Dropdown>
            </div>
            <div className="flex-1 p-4">{renderBody(item)}</div>
          </div>
        ))}
      </div>

      <Modal open={!!fullscreen} onClose={() => setFullscreen(null)} title={fullscreen?.title ?? ""}>
        <div className="min-w-[min(80vw,900px)]">{fullscreen && renderBody(fullscreen)}</div>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────
// Goal card — progress toward a target
// ─────────────────────────────────────────────
export const GoalCard = ({ label, current, target, format = "number" }: { label: string; current: number; target: number; format?: KpiFormat }) => {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const done = pct >= 100;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className={cn("text-sm font-semibold tabular-nums", done ? "text-emerald-600 dark:text-emerald-400" : "text-slate-900 dark:text-white")}>{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <motion.div
          className="h-full rounded-full"
          style={{ background: done ? "#34d399" : "linear-gradient(90deg, #598cff, #3366f5)" }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: DUR.slow, ease: EASE }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[12px] text-slate-500 dark:text-slate-400 tabular-nums">
        <span>{formatKpiValue(current, format)}</span>
        <span>Target {formatKpiValue(target, format)}</span>
      </div>
    </div>
  );
};
