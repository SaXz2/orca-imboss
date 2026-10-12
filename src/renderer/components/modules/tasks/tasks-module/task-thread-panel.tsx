import { getLocale, t } from "@shared/l10n";
import {
  type TaskCloseReason,
  type TaskEvent,
  type TaskEventKind,
  type TaskRef,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Field } from "../../../field";
import { IconSend, IconTrash } from "../../../icons";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import { MentionPopup } from "../../chat/chat-input-bar/mention-popup";
import { formatMessageTime } from "../../chat/relative-time";
import {
  actorName,
  CLOSE_REASON_KEYS,
  COMPOSER_KINDS,
  describeEvent,
  EVENT_KIND_KEYS,
} from "./task-meta";

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

/**
 * A task's thread: feedback (like / save / follow), the reference lists, the
 * append-only timeline (discussion plus lifecycle events) and the composer.
 * Shared by the manual-task detail view and the progress-card steps view, so
 * every board card can be discussed the same way.
 */
export function TaskThreadPanel({
  taskId,
  employees,
  onChanged,
  onOpenTask,
}: {
  taskId: number;
  employees: EmployeeList;
  onChanged: () => Promise<void>;
  onOpenTask: (id: number) => void;
}): React.JSX.Element {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [references, setReferences] = useState<{
    out: TaskRef[];
    in: TaskRef[];
  }>({ out: [], in: [] });
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<TaskEventKind>("comment");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [candidates, setCandidates] = useState<
    Array<{ id: number; title: string }>
  >([]);

  // `@` mention picker — the same component and keyboard model as the chat
  // composer, so a mention behaves identically in both places.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionCaret, setMentionCaret] = useState({ start: 0, end: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const mentionCandidates = useMemo(() => {
    if (!mentionOpen) return [];
    const query = mentionQuery.toLowerCase().trim();
    const list = employees.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
    }));
    if (query.length === 0) return list;
    return list.filter(
      (e) =>
        (e.name ?? "").toLowerCase().includes(query) ||
        (e.role ?? "").toLowerCase().includes(query) ||
        String(e.id).includes(query),
    );
  }, [mentionOpen, mentionQuery, employees]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const thread = await imb.tasks.thread(taskId);
      setEvents(thread.events);
      setReferences(thread.references);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async (): Promise<void> => {
    const text = body.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      await imb.tasks.comment(taskId, { body: text, kind });
      setBody("");
      setKind("comment");
      setMentionOpen(false);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const removeComment = async (eventId: number): Promise<void> => {
    try {
      await imb.tasks.deleteComment(taskId, eventId);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const checkMentionTrigger = (value: string, cursor: number): void => {
    const before = value.slice(0, cursor);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (match) {
      setMentionQuery(match[1]);
      const atStart = match.index + (match[0].startsWith("@") ? 0 : 1);
      setMentionCaret({ start: atStart, end: cursor });
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  };

  /** Insert `@<id> <name>` — the raw form the model parses (body contains @ID). */
  const insertMention = (employee: {
    id: number;
    name?: string;
    role?: string;
  }): void => {
    const label = employee.name || employee.role || `#${employee.id}`;
    const tag = `@${employee.id} ${label} `;
    const next =
      body.slice(0, mentionCaret.start) + tag + body.slice(mentionCaret.end);
    setBody(next);
    setMentionOpen(false);
    setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const pos = mentionCaret.start + tag.length;
      textarea.setSelectionRange(pos, pos);
    }, 0);
  };

  const onComposerKeyDown = (event: React.KeyboardEvent): void => {
    if (mentionOpen && mentionCandidates.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionCandidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const chosen = mentionCandidates[mentionIndex] ?? mentionCandidates[0];
        if (chosen) insertMention(chosen);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  };

  /** Pick another task to link this one to (a manual cross-reference). */
  const openLink = async (): Promise<void> => {
    try {
      const cards = await imb.tasks.board();
      const seen = new Set<number>();
      const list: Array<{ id: number; title: string }> = [];
      for (const card of cards) {
        const id = card.threadId;
        if (id === null || id === taskId || seen.has(id)) continue;
        seen.add(id);
        list.push({ id, title: card.title });
      }
      setCandidates(list);
      setLinkQuery("");
      setLinkOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const link = async (toId: number): Promise<void> => {
    try {
      setLinkOpen(false);
      await imb.tasks.link(taskId, toId);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const filteredCandidates = candidates.filter((c) =>
    linkQuery.trim().length === 0
      ? true
      : c.title.toLowerCase().includes(linkQuery.trim().toLowerCase()),
  );

  return (
    <>
      <div className="imb-task-refs">
        <div className="imb-task-refs-head">
          <span className="imb-task-timeline-head">{t("References")}</span>
          <button
            type="button"
            className="imb-task-feedback-btn"
            onClick={() => void openLink()}
          >
            {t("Link task")}
          </button>
        </div>
        {references.out.length > 0 && (
          <div className="imb-task-ref-row">
            <span className="imb-task-ref-label">{t("Mentions")}</span>
            <span className="imb-task-ref-list">
              {references.out.map((ref) => (
                <RefChip key={ref.id} taskRef={ref} onOpen={onOpenTask} />
              ))}
            </span>
          </div>
        )}
        {references.in.length > 0 && (
          <div className="imb-task-ref-row">
            <span className="imb-task-ref-label">{t("Referenced by")}</span>
            <span className="imb-task-ref-list">
              {references.in.map((ref) => (
                <RefChip key={ref.id} taskRef={ref} onOpen={onOpenTask} />
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="imb-task-timeline">
        <div className="imb-task-timeline-head">{t("Discussion")}</div>
        {events.length === 0 ? (
          <div className="imb-board-empty">{t("No activity yet")}</div>
        ) : (
          events.map((event) => (
            <TimelineEntry
              key={event.id}
              event={event}
              employees={employees}
              onOpenTask={onOpenTask}
              onDelete={removeComment}
            />
          ))
        )}
      </div>

      <div className="imb-task-composer">
        <div className="imb-task-composer-field">
          <MentionPopup
            open={mentionOpen}
            employees={mentionCandidates}
            selectedIndex={mentionIndex}
            onSelect={insertMention}
            onHoverIndex={setMentionIndex}
          />
          <Field label={t("Add to the discussion")}>
            <Textarea
              ref={textareaRef}
              value={body}
              rows={3}
              minHeight={64}
              maxHeight={220}
              placeholder={t("Write a comment… (@ID to involve someone)")}
              onChange={(e) => {
                setBody(e.target.value);
                checkMentionTrigger(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length,
                );
              }}
              onKeyDown={onComposerKeyDown}
            />
          </Field>
        </div>
        <div className="imb-task-composer-foot">
          <Select
            value={kind}
            options={COMPOSER_KINDS.map((k) => ({
              value: k,
              label: t(EVENT_KIND_KEYS[k]),
            }))}
            onChange={(value) => setKind(value as TaskEventKind)}
          />
          <Button
            variant="primary"
            disabled={sending || body.trim().length === 0}
            onClick={() => void send()}
          >
            <IconSend className="imb-icon imb-xs" />
            {t("Post")}
          </Button>
        </div>
      </div>

      {error !== null && <p className="imb-error-text">{error}</p>}

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t("Link task")}
      >
        <div className="imb-link-picker">
          <Input
            value={linkQuery}
            placeholder={t("Search tasks")}
            autoFocus
            onChange={(e) => setLinkQuery(e.target.value)}
          />
          <div className="imb-link-list">
            {filteredCandidates.length === 0 ? (
              <div className="imb-mention-empty">{t("No tasks")}</div>
            ) : (
              filteredCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className="imb-mention-item"
                  onClick={() => void link(candidate.id)}
                >
                  <div className="imb-mention-info">
                    <div className="imb-mention-row-head">
                      <span className="imb-mention-name">{candidate.title}</span>
                      <span className="imb-mention-badge">
                        #{candidate.id}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

/** Renders `#123` task references inside free text as clickable links. */
function RefText({
  text,
  onOpen,
}: {
  text: string;
  onOpen: (id: number) => void;
}): React.JSX.Element {
  return (
    <>
      {text.split(/(#\d+)/g).map((part, index) => {
        const match = /^#(\d+)$/.exec(part);
        if (!match) return <span key={index}>{part}</span>;
        return (
          <button
            key={index}
            type="button"
            className="imb-ref-link"
            onClick={() => onOpen(Number(match[1]))}
          >
            {part}
          </button>
        );
      })}
    </>
  );
}

/** A chip for one referenced task (opens it). */
export function RefChip({
  taskRef,
  onOpen,
}: {
  taskRef: TaskRef;
  onOpen: (id: number) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-task-ref-chip", `imb-is-${taskRef.status}`)}
      onClick={() => onOpen(taskRef.id)}
      title={taskRef.title}
    >
      <span className="imb-gh-ref">#{taskRef.id}</span>
      <span className="imb-task-ref-title">{taskRef.title}</span>
    </button>
  );
}

function TimelineEntry({
  event,
  employees,
  onOpenTask,
  onDelete,
}: {
  event: TaskEvent;
  employees: EmployeeList;
  onOpenTask: (id: number) => void;
  onDelete: (eventId: number) => Promise<void>;
}): React.JSX.Element {
  const authored = EVENT_KIND_KEYS[event.kind];
  const time = formatMessageTime(event.createdAt, getLocale());

  if (event.actor === "system") {
    let summary = describeEvent(event, employees);
    if (event.kind === "closed") {
      const reason = event.meta["closeReason"];
      summary =
        typeof reason === "string" && reason in CLOSE_REASON_KEYS
          ? t(CLOSE_REASON_KEYS[reason as TaskCloseReason])
          : "";
    }
    return (
      <div className="imb-tl-row imb-tl-system">
        <span className="imb-tl-dot" aria-hidden="true" />
        <span className="imb-tl-sys-text">
          <span className="imb-tl-kind">{t(authored)}</span>
          {summary && (
            <span className="imb-tl-sys-extra">
              {event.kind === "referenced" ? (
                <RefText text={summary} onOpen={onOpenTask} />
              ) : (
                summary
              )}
            </span>
          )}
        </span>
        <span className="imb-tl-time">{time}</span>
      </div>
    );
  }

  const isUser = event.actor === "user";
  const employeeId = isUser ? null : Number(event.actor.split(":")[1]);

  return (
    <div className="imb-tl-row imb-tl-authored">
      <span className="imb-tl-avatar">
        {employeeId !== null && Number.isFinite(employeeId) ? (
          <EmployeeAvatar employeeId={employeeId} size={22} />
        ) : (
          <span className="imb-tl-you">{t("You").slice(0, 1)}</span>
        )}
      </span>
      <div className="imb-tl-body">
        <div className="imb-tl-head">
          <span className="imb-tl-author">
            {actorName(event.actor, employees, t("You"))}
          </span>
          <span className="imb-tl-kind">{t(authored)}</span>
          <span className="imb-tl-time">{time}</span>
          <button
            type="button"
            className="imb-tl-del"
            title={t("Delete")}
            aria-label={t("Delete")}
            onClick={() => void onDelete(event.id)}
          >
            <IconTrash />
          </button>
        </div>
        <p className="imb-tl-text">
          <RefText text={event.body} onOpen={onOpenTask} />
        </p>
      </div>
    </div>
  );
}
