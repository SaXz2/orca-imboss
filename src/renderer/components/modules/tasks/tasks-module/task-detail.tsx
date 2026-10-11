import { getLocale, t } from "@shared/l10n";
import {
  EMPTY_REACTIONS,
  TASK_CLOSE_REASONS,
  type Task,
  type TaskCloseReason,
  type TaskEvent,
  type TaskEventKind,
  type TaskReactions,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Field } from "../../../field";
import {
  IconBack,
  IconBookmark,
  IconClosed,
  IconFollow,
  IconLike,
  IconPencil,
  IconReopen,
  IconSend,
  IconTrash,
} from "../../../icons";
import { Modal } from "../../../modal";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import { formatMessageTime } from "../../chat/relative-time";
import {
  actorName,
  CLOSE_REASON_KEYS,
  COLUMNS,
  COMPOSER_KINDS,
  describeEvent,
  EVENT_KIND_KEYS,
  labelColor,
} from "./task-meta";

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

/**
 * Task detail: the task's own fields plus its thread — an append-only timeline
 * of discussion (comments, demands, rejections, approvals) and lifecycle
 * events, with feedback (like / save / follow) and close / reopen.
 */
export function TaskDetail({
  taskId,
  employees,
  onBack,
  onEdit,
  onChanged,
}: {
  taskId: number;
  employees: EmployeeList;
  onBack: () => void;
  onEdit: (task: Task) => void;
  onChanged: () => Promise<void>;
}): React.JSX.Element {
  const [task, setTask] = useState<Task | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [reactions, setReactions] = useState<TaskReactions>({
    ...EMPTY_REACTIONS,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<TaskEventKind>("comment");
  const [sending, setSending] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const thread = await imb.tasks.thread(taskId);
      setTask(thread.task);
      setEvents(thread.events);
      setReactions(thread.reactions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const statusLabel = useMemo(() => {
    if (!task) return "";
    const column = COLUMNS.find((c) => c.status === task.status);
    return column ? t(column.labelKey) : task.status;
  }, [task]);

  const react = async (
    reaction: "like" | "bookmark" | "follow",
  ): Promise<void> => {
    try {
      const rollup = await imb.tasks.react(taskId, reaction);
      setReactions(rollup);
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

  const close = async (reason: TaskCloseReason): Promise<void> => {
    try {
      setCloseOpen(false);
      const next = await imb.tasks.close(taskId, reason);
      setTask(next);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reopen = async (): Promise<void> => {
    try {
      const next = await imb.tasks.reopen(taskId);
      setTask(next);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (): Promise<void> => {
    try {
      setDeleteOpen(false);
      await imb.tasks.remove(taskId);
      await onChanged();
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading && !task) {
    return <div className="imb-task-detail" />;
  }
  if (!task) {
    return (
      <div className="imb-task-detail">
        <div className="imb-task-detail-bar">
          <button type="button" className="imb-task-back" onClick={onBack}>
            <IconBack />
            {t("Back to board")}
          </button>
        </div>
        <div className="imb-board-empty">{t("This task no longer exists.")}</div>
      </div>
    );
  }

  const closed = task.status === "closed";

  return (
    <div className="imb-task-detail">
      <div className="imb-task-detail-bar">
        <button type="button" className="imb-task-back" onClick={onBack}>
          <IconBack />
          {t("Back to board")}
        </button>
        <div className="imb-task-detail-bar-actions">
          <Button variant="secondary" onClick={() => onEdit(task)}>
            <IconPencil className="imb-icon imb-xs" />
            {t("Edit")}
          </Button>
          {closed ? (
            <Button variant="secondary" onClick={() => void reopen()}>
              <IconReopen className="imb-icon imb-xs" />
              {t("Reopen")}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setCloseOpen(true)}>
              <IconClosed className="imb-icon imb-xs" />
              {t("Close task")}
            </Button>
          )}
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <IconTrash className="imb-icon imb-xs" />
            {t("Delete")}
          </Button>
        </div>
      </div>

      <div className="imb-task-detail-scroll">
        <div className="imb-task-detail-pane">
          <div className="imb-task-detail-title">
            <span className="imb-gh-ref">#{task.id}</span>
            <h2>{task.title}</h2>
            <span
              className={cls(
                "imb-task-status-chip",
                `imb-is-${task.status}`,
              )}
            >
              {statusLabel}
              {closed && task.closeReason
                ? ` · ${t(CLOSE_REASON_KEYS[task.closeReason])}`
                : ""}
            </span>
          </div>

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

          {task.detail.trim().length > 0 && (
            <p className="imb-task-detail-body">{task.detail}</p>
          )}

          <div className="imb-task-meta-grid">
            {task.category && (
              <MetaRow label={t("Category")}>
                <span
                  className="imb-gh-label"
                  style={{
                    color: labelColor(task.category),
                    borderColor: labelColor(task.category),
                    background: `color-mix(in srgb, ${labelColor(task.category)} 12%, transparent)`,
                  }}
                >
                  {task.category}
                </span>
              </MetaRow>
            )}
            {task.flow && (
              <MetaRow label={t("Flow")}>
                <span className="imb-task-meta-text">{task.flow}</span>
              </MetaRow>
            )}
            <MetaRow label={t("Assignees")}>
              {task.assignees.length === 0 ? (
                <span className="imb-task-meta-text">{t("Unassigned")}</span>
              ) : (
                <span className="imb-task-meta-people">
                  {task.assignees.map((id) => (
                    <span key={id} className="imb-task-meta-person">
                      <EmployeeAvatar employeeId={id} size={18} />
                      {actorName(`employee:${id}`, employees, t("You"))}
                    </span>
                  ))}
                </span>
              )}
            </MetaRow>
            <MetaRow label={t("Updated")}>
              <span className="imb-task-meta-text">
                {formatMessageTime(task.updatedAt, getLocale())}
              </span>
            </MetaRow>
          </div>

          <div className="imb-task-timeline">
            <div className="imb-task-timeline-head">{t("Timeline")}</div>
            {events.length === 0 ? (
              <div className="imb-board-empty">{t("No activity yet")}</div>
            ) : (
              events.map((event) => (
                <TimelineEntry
                  key={event.id}
                  event={event}
                  employees={employees}
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
        </div>
      </div>

      <Modal
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title={t("Close task")}
        actions={
          <Button variant="secondary" onClick={() => setCloseOpen(false)}>
            {t("Cancel")}
          </Button>
        }
      >
        <div className="imb-task-close-reasons">
          {TASK_CLOSE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="imb-task-close-reason"
              onClick={() => void close(reason)}
            >
              {t(CLOSE_REASON_KEYS[reason])}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete task")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p className="imb-module-note">
          {t("This permanently deletes the task and its timeline.")}
        </p>
      </Modal>
    </div>
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

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="imb-task-meta-row">
      <span className="imb-task-meta-label">{label}</span>
      <span className="imb-task-meta-value">{children}</span>
    </div>
  );
}

function TimelineEntry({
  event,
  employees,
}: {
  event: TaskEvent;
  employees: EmployeeList;
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
          {summary && <span className="imb-tl-sys-extra">{summary}</span>}
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
        <p className="imb-tl-text">{event.body}</p>
      </div>
    </div>
  );
}
