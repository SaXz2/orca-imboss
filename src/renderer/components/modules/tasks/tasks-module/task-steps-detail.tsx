import { employeeColor } from "@shared/constants/employee-colors";
import { t } from "@shared/l10n";
import {
  TASK_CLOSE_REASONS,
  type BoardCard,
  type MessageStep,
  type StepStatus,
  type TaskCloseReason,
} from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { employeeLabel } from "../../../../employee-label";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import {
  IconArchive,
  IconBack,
  IconChat,
  IconClosed,
  IconEmployees,
  IconReopen,
} from "../../../icons";
import { Modal } from "../../../modal";
import { CLOSE_REASON_KEYS, COLUMNS } from "./task-meta";
import { TaskThreadPanel } from "./task-thread-panel";

/** Translation key per step status; rendered through `t()` for locale switches. */
const STEP_LABEL_KEYS: Record<StepStatus, string> = {
  pending: "Pending",
  busy: "In progress",
  done: "Done",
  interrupted: "Interrupted",
};

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

/**
 * A task's per-person sub-tasks. One progress task is split into the concrete
 * work each employee owns; clicking a name opens that employee's session for
 * this chat, where their reasoning and actions for the task are recorded.
 */
export function TaskStepsDetail({
  card,
  employees,
  onBack,
  onArchive,
  onChanged,
  onOpenTask,
}: {
  card: BoardCard;
  employees: EmployeeList;
  onBack: () => void;
  onArchive: (card: BoardCard) => void;
  onChanged: () => Promise<void>;
  onOpenTask: (id: number) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every board card owns a task (materialised when the board is listed).
  const threadId = card.threadId;
  const closed = card.status === "closed";
  const statusLabel =
    COLUMNS.find((column) => column.status === card.status)?.labelKey ??
    "Pending";
  const doneCount = card.steps.filter((step) => step.status === "done").length;
  // A separate working group is what makes a task readable end to end.
  const hasWorkChat =
    card.workChatId !== null && card.workChatId !== card.chatId;

  const openSession = (employeeId: number): void => {
    const chatId = card.workChatId ?? card.chatId;
    if (chatId === null) return;
    void appStore.openAgentSession(employeeId, chatId);
  };

  /**
   * Open the task's conversation the way the chat list does: select it in the
   * chat module instead of pushing a new entry into the sidebar.
   */
  const openChat = (): void => {
    if (card.chatId === null) return;
    appStore.focusChatId = card.chatId;
    appStore.module = "chat";
  };

  /** Open the task's working group chat, where the whole result is recorded. */
  const openWorkChat = async (): Promise<void> => {
    if (card.workChatId === null || busy) return;
    setBusy(true);
    try {
      const summary = await imb.chats.summary(card.workChatId);
      if (summary) appStore.openChat(summary);
    } finally {
      setBusy(false);
    }
  };

  const closeTask = async (reason: TaskCloseReason): Promise<void> => {
    if (threadId === null) return;
    try {
      setCloseOpen(false);
      await imb.tasks.close(threadId, reason);
      // Closing dismisses the card from the board; it stays recoverable in the
      // archive, where restoring it also reopens the task.
      onArchive(card);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reopen = async (): Promise<void> => {
    if (threadId === null) return;
    try {
      await imb.tasks.reopen(threadId);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="imb-task-detail">
      <div className="imb-task-detail-bar">
        <button type="button" className="imb-task-back" onClick={onBack}>
          <IconBack />
          {t("Back to board")}
        </button>

        <div className="imb-detail-actions">
          {card.chatId !== null && (
            <button
              type="button"
              className="imb-detail-action"
              onClick={openChat}
            >
              <IconChat />
              {t("Open chat")}
            </button>
          )}
          {hasWorkChat && (
            <button
              type="button"
              className="imb-detail-action"
              disabled={busy}
              onClick={() => void openWorkChat()}
            >
              <IconEmployees />
              {t("Open task group")}
            </button>
          )}
          {threadId !== null &&
            (closed ? (
              <button
                type="button"
                className="imb-detail-action"
                onClick={() => void reopen()}
              >
                <IconReopen />
                {t("Reopen")}
              </button>
            ) : (
              <button
                type="button"
                className="imb-detail-action"
                onClick={() => setCloseOpen(true)}
              >
                <IconClosed />
                {t("Close task")}
              </button>
            ))}
          <button
            type="button"
            className="imb-detail-action"
            onClick={() => onArchive(card)}
          >
            <IconArchive />
            {t("Archive")}
          </button>
        </div>
      </div>

      <div className="imb-task-detail-scroll">
        <div className="imb-task-detail-pane">
          <div className="imb-task-detail-title">
            <h2>{card.title}</h2>
            <span className={cls("imb-task-status-chip", `imb-is-${card.status}`)}>
              {t(statusLabel)}
            </span>
          </div>

          <div className="imb-task-steps-head">
            {t("Steps")}
            <span className="imb-task-steps-count">
              {t("${done} of ${total} steps", {
                done: String(doneCount),
                total: String(card.steps.length),
              })}
            </span>
          </div>

          {card.steps.length === 0 ? (
            <div className="imb-board-empty">{t("No steps yet")}</div>
          ) : (
            <div className="imb-task-steps">
              {card.steps.map((step, index) => (
                <StepRow
                  key={`${step.name}-${index}`}
                  step={step}
                  employees={employees}
                  onOpen={openSession}
                />
              ))}
            </div>
          )}

          {threadId !== null && (
            <TaskThreadPanel
              taskId={threadId}
              employees={employees}
              onChanged={onChanged}
              onOpenTask={onOpenTask}
            />
          )}

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
              onClick={() => void closeTask(reason)}
            >
              {t(CLOSE_REASON_KEYS[reason])}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function StepRow({
  step,
  employees,
  onOpen,
}: {
  step: MessageStep;
  employees: EmployeeList;
  onOpen: (employeeId: number) => void;
}): React.JSX.Element {
  const employee =
    step.employeeId !== undefined
      ? employees.find((e) => e.id === step.employeeId)
      : employees.find(
          (e) =>
            (e.name && e.name.trim() === step.name.trim()) ||
            (e.role && e.role.trim() === step.role.trim()),
        );
  const employeeId = step.employeeId ?? employee?.id ?? null;
  const label = employee ? employeeLabel(employee) : step.name;

  return (
    <div className="imb-task-step">
      <EmployeeAvatar employeeId={employeeId} size={26} />

      <div className="imb-task-step-id">
        {employeeId !== null ? (
          <button
            type="button"
            className="imb-task-step-name"
            style={{ color: employeeColor(employeeId) }}
            title={t("See what ${name} did on this task", { name: label })}
            onClick={() => onOpen(employeeId)}
          >
            {label}
          </button>
        ) : (
          <span className="imb-task-step-name">{label}</span>
        )}
        {step.role.trim().length > 0 && (
          <span className="imb-task-step-role">{step.role}</span>
        )}
      </div>

      <span className={cls("imb-progress-tag", `imb-${step.status}`)}>
        <span className="imb-status-dot" aria-hidden="true" />
        {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
      </span>
    </div>
  );
}
