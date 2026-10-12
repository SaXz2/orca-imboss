import { getLocale, t } from "@shared/l10n";
import {
  TASK_CLOSE_REASONS,
  type Task,
  type TaskCloseReason,
} from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import {
  IconBack,
  IconClosed,
  IconPencil,
  IconReopen,
  IconTrash,
} from "../../../icons";
import { Modal } from "../../../modal";
import { formatMessageTime } from "../../chat/relative-time";
import {
  actorName,
  CLOSE_REASON_KEYS,
  COLUMNS,
  labelColor,
} from "./task-meta";
import { TaskThreadPanel } from "./task-thread-panel";

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

/**
 * Task detail for a hand-written task: its fields plus its thread (discussion,
 * feedback, references, close / reopen).
 */
export function TaskDetail({
  taskId,
  employees,
  onBack,
  onEdit,
  onChanged,
  onOpenTask,
}: {
  taskId: number;
  employees: EmployeeList;
  onBack: () => void;
  onEdit: (task: Task) => void;
  onChanged: () => Promise<void>;
  onOpenTask: (id: number) => void;
}): React.JSX.Element {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setTask(await imb.tasks.get(taskId));
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

  const close = async (reason: TaskCloseReason): Promise<void> => {
    try {
      setCloseOpen(false);
      setTask(await imb.tasks.close(taskId, reason));
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reopen = async (): Promise<void> => {
    try {
      setTask(await imb.tasks.reopen(taskId));
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
  const statusLabel = (() => {
    const column = COLUMNS.find((c) => c.status === task.status);
    return column ? t(column.labelKey) : task.status;
  })();

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
            <span className={cls("imb-task-status-chip", `imb-is-${task.status}`)}>
              {statusLabel}
              {closed && task.closeReason
                ? ` · ${t(CLOSE_REASON_KEYS[task.closeReason])}`
                : ""}
            </span>
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

          <TaskThreadPanel
            taskId={task.id}
            employees={employees}
            onChanged={onChanged}
            onOpenTask={onOpenTask}
          />

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
