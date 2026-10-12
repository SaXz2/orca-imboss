import { employeeColor } from "@shared/constants/employee-colors";
import { t } from "@shared/l10n";
import type { BoardCard, MessageStep, StepStatus } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { employeeLabel } from "../../../../employee-label";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconArchive, IconBack, IconChat, IconEmployees } from "../../../icons";
import { COLUMNS } from "./task-meta";

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
}: {
  card: BoardCard;
  employees: EmployeeList;
  onBack: () => void;
  onArchive: (card: BoardCard) => void;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
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
        </div>
      </div>
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
