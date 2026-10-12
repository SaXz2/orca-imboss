import { getLocale, t } from "@shared/l10n";
import {
  EMPTY_REACTIONS,
  type TaskCloseReason,
  type TaskEvent,
  type TaskEventKind,
  type TaskReactions,
  type TaskRef,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Field } from "../../../field";
import {
  IconBookmark,
  IconFollow,
  IconLike,
  IconSend,
} from "../../../icons";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
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
  const [reactions, setReactions] = useState<TaskReactions>({
    ...EMPTY_REACTIONS,
  });
  const [references, setReferences] = useState<{
    out: TaskRef[];
    in: TaskRef[];
  }>({ out: [], in: [] });
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<TaskEventKind>("comment");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const thread = await imb.tasks.thread(taskId);
      setEvents(thread.events);
      setReactions(thread.reactions);
      setReferences(thread.references);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const react = async (
    reaction: "like" | "bookmark" | "follow",
  ): Promise<void> => {
    try {
      setReactions(await imb.tasks.react(taskId, reaction));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async (): Promise<void> => {
    const text = body.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      await imb.tasks.comment(taskId, { body: text, kind });
      setBody("");
      setKind("comment");
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="imb-task-feedback">
        <FeedbackButton
          icon={<IconLike />}
          label={t("Like")}
          count={reactions.like}
          on={reactions.liked}
          onClick={() => void react("like")}
        />
        <FeedbackButton
          icon={<IconBookmark />}
          label={t("Save")}
          count={reactions.bookmark}
          on={reactions.bookmarked}
          onClick={() => void react("bookmark")}
        />
        <FeedbackButton
          icon={<IconFollow />}
          label={t("Follow")}
          count={reactions.follow}
          on={reactions.following}
          onClick={() => void react("follow")}
        />
      </div>

      {(references.out.length > 0 || references.in.length > 0) && (
        <div className="imb-task-refs">
          <div className="imb-task-timeline-head">{t("References")}</div>
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
      )}

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
            />
          ))
        )}
      </div>

      <div className="imb-task-composer">
        <Field label={t("Add to the discussion")}>
          <Textarea
            value={body}
            rows={3}
            minHeight={64}
            maxHeight={220}
            placeholder={t("Write a comment…")}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void send();
              }
            }}
          />
        </Field>
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

function FeedbackButton({
  icon,
  label,
  count,
  on,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-task-feedback-btn", on && "imb-is-on")}
      onClick={onClick}
      aria-pressed={on}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && <span className="imb-task-feedback-count">{count}</span>}
    </button>
  );
}

function TimelineEntry({
  event,
  employees,
  onOpenTask,
}: {
  event: TaskEvent;
  employees: EmployeeList;
  onOpenTask: (id: number) => void;
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
        </div>
        <p className="imb-tl-text">
          <RefText text={event.body} onOpen={onOpenTask} />
        </p>
      </div>
    </div>
  );
}
