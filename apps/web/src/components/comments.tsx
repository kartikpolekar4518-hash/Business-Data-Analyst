// Team collaboration: a comment thread and an activity feed, both attachable to a
// report, a dataset, or a saved view. Presentation only — every figure a comment
// discusses still comes from the deterministic engine; nothing here computes one.
import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Trash2, History } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Textarea, Skeleton, EmptyState, ErrorState, useToast } from "./ui";
import { timeAgo } from "../lib/utils";

export type EntityType = "report" | "dataset" | "saved_view";

interface Mention { id: string; name: string }
interface Comment {
  id: string; body: string; createdAt: string;
  authorId: string; authorName: string; mentions: Mention[];
}
interface Member { id: string; name: string; email: string }
interface ActivityEntry {
  id: string; action: string; detail: string | null; createdAt: string;
  entityType: string | null; entityId: string | null; actorName: string | null;
}

const initials = (name: string) => name.trim()[0]?.toUpperCase() ?? "?";

// A stable colour per person so the same author reads as the same person down the
// thread, without storing an avatar anywhere.
// Flat, muted, and distinguishable — identity is the meaning here, so the hue
// earns its place; the gradient did not.
const TONES = [
  "bg-[#2C5179]", "bg-[#3F6B52]", "bg-[#8A6A2B]",
  "bg-[#8C4A46]", "bg-[#5A4C7A]", "bg-[#3D6470]",
];
function toneFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneFor(id)} font-mono text-label text-canvas`}
    >
      {initials(name)}
    </div>
  );
}

// Renders "@Name" runs in bold when they match someone the comment actually
// mentioned. Matching against the stored ids rather than any @-looking text means a
// literal "@2pm" in a sentence is left alone.
function Body({ text, mentions }: { text: string; mentions: Mention[] }) {
  if (!mentions.length) return <>{text}</>;
  const names = [...mentions].map((m) => m.name).sort((a, b) => b.length - a.length);
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(@(?:${escaped.join("|")}))`, "g"));
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("@") && names.includes(p.slice(1))
          ? <span key={i} className="font-semibold text-accent">{p}</span>
          : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function CommentThread({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  const key = ["comments", entityType, entityId];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ comments: Comment[] }>(`/comments?entityType=${entityType}&entityId=${entityId}`),
  });
  // Everyone in the org can be mentioned, so the picker is the member list.
  const members = useQuery({ queryKey: ["users"], queryFn: () => api.get<{ users: Member[] }>("/users") });

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return (members.data?.users ?? []).filter((m) => m.name.toLowerCase().includes(q)).slice(0, 5);
  }, [mentionQuery, members.data]);

  // Track the word being typed after an "@" so the picker can offer names.
  function onDraftChange(value: string) {
    setDraft(value);
    const upToCaret = value.slice(0, boxRef.current?.selectionStart ?? value.length);
    const m = /@([\w ]{0,30})$/.exec(upToCaret);
    setMentionQuery(m ? m[1] : null);
  }

  function pick(member: Member) {
    const caret = boxRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(/@([\w ]{0,30})$/, `@${member.name} `);
    setDraft(before + draft.slice(caret));
    setMentionQuery(null);
    boxRef.current?.focus();
  }

  // The ids are resolved from the text at submit time: a name typed by hand counts
  // the same as one picked from the list, and deleting the text un-mentions someone.
  function mentionedIds(text: string): string[] {
    return (members.data?.users ?? []).filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try {
      await api.post("/comments", { entityType, entityId, body, mentionedUserIds: mentionedIds(body) });
      setDraft("");
      setMentionQuery(null);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch { toast("Could not post your comment", "error"); }
    finally { setSaving(false); }
  }

  async function remove(id: string) {
    try {
      await api.del(`/comments/${id}`);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch { toast("Could not delete the comment", "error"); }
  }

  const comments = data?.comments ?? [];

  return (
    <div className="space-y-4 text-body">
      {isLoading ? (
        <div className="space-y-3">{[0, 1].map((i) => (
          <div key={i} className="flex gap-3"><Skeleton className="h-7 w-7 rounded-md" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-4 w-full" /></div></div>
        ))}</div>
      ) : isError ? (
        <ErrorState message="We couldn't load the comments. Check your connection and try again." retry={() => refetch()} />
      ) : !comments.length ? (
        <EmptyState icon={MessageSquare} title="No comments yet" description="Start the conversation — everyone in your organisation can see and reply." />
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar id={c.authorId} name={c.authorName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{c.authorName}</span>
                  <span className="text-body-sm text-ink-faint">{timeAgo(c.createdAt)}</span>
                  {(c.authorId === user?.id || can("ADMIN")) && (
                    <button
                      onClick={() => remove(c.id)}
                      aria-label="Delete comment"
                      className="ml-auto rounded p-1 text-ink-faint transition-colors hover:bg-sunken hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-soft">
                  <Body text={c.body} mentions={c.mentions} />
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="relative">
        <Textarea
          ref={boxRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Add a comment. Type @ to mention a teammate."
          rows={3}
          aria-label="Add a comment"
        />
        {mentionQuery !== null && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label="Mention a teammate"
            className="absolute bottom-full z-20 mb-1 w-64 overflow-hidden rounded-xl border border-rule bg-surface p-1 shadow-dropdown"
          >
            {suggestions.map((m) => (
              <li key={m.id}>
                <button
                  role="option"
                  aria-selected="false"
                  onClick={() => pick(m)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sunken"
                >
                  <Avatar id={m.id} name={m.name} />
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex justify-end">
          <Button onClick={submit} loading={saving} disabled={!draft.trim()}>
            <Send className="h-4 w-4" />Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

// Plain-English wording for the actions the trail records. Anything unrecognised
// falls back to the raw action rather than being hidden — an entry nobody can read
// is still better than an entry nobody can see.
const ACTIONS: Record<string, string> = {
  "comment.posted": "commented",
  "comment.deleted": "deleted a comment",
  "report.generated": "generated a report",
  "report.shared": "created a share link",
  "report.shareRevoked": "revoked a share link",
  "dataset.uploaded": "uploaded data",
  "dataset.cleaned": "cleaned the data",
  "dataset.combined": "added more data",
  "dataset.sampleLoaded": "loaded the sample data",
  "connection.synced": "synced data",
  "view.saved": "saved a view",
  "recipe.saved": "saved a cleaning recipe",
  "recipe.deleted": "deleted a cleaning recipe",
  "metric.created": "added a custom metric",
  "metric.deleted": "removed a custom metric",
  "relation.created": "connected two files",
  "relation.deleted": "disconnected two files",
  "connection.created": "added a data connection",
  "user.invited": "invited someone",
  "user.role-changed": "changed a role",
  "user.removed": "removed someone",
  "billing.planChanged": "changed the plan",
  "org.created": "created the workspace",
};

export function ActivityFeed({ entityType, entityId, limit }: { entityType?: EntityType; entityId?: string; limit?: number }) {
  const scoped = entityType && entityId;
  const query = new URLSearchParams();
  if (scoped) { query.set("entityType", entityType!); query.set("entityId", entityId!); }
  if (limit) query.set("limit", String(limit));
  const qs = query.toString();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["activity", entityType ?? "all", entityId ?? "all", limit ?? 50],
    queryFn: () => api.get<{ activity: ActivityEntry[] }>(`/activity${qs ? `?${qs}` : ""}`),
  });

  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => (
      <div key={i} className="flex gap-3"><Skeleton className="h-7 w-7 rounded-md" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-24" /></div></div>
    ))}</div>;
  }
  if (isError) return <ErrorState message="We couldn't load the activity. Check your connection and try again." retry={() => refetch()} />;

  const entries = data?.activity ?? [];
  if (!entries.length) {
    return <EmptyState icon={History} title="Nothing yet" description={scoped ? "Activity on this item will appear here." : "Uploads, reports, and comments will appear here as your team works."} />;
  }

  return (
    <ul className="space-y-3 text-body">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <Avatar id={e.id} name={e.actorName ?? "System"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{e.actorName ?? "System"}</span>
              <span className="text-ink-faint">{ACTIONS[e.action] ?? e.action}</span>
              <span className="ml-auto shrink-0 text-body-sm text-ink-faint">{timeAgo(e.createdAt)}</span>
            </div>
            {e.detail && <p className="truncate text-body-sm text-ink-faint">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
