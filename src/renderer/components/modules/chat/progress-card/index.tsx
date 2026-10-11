import { t } from "@shared/l10n";
import type { MessageStep, StepStatus } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { resolveEmployeeLabel } from "../../../../employee-label";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconPencil } from "../../../icons";
import { StepEditModal } from "./step-edit-modal";
import "./index.css";

/** Translation key per step status; rendered through `t()` for locale switches. */
const STEP_LABEL_KEYS: Record<StepStatus, string> = {
  pending: "Pending",
  busy: "In progress",
  done: "Done",
  interrupted: "Interrupted",
};

export interface ProgressCardProps {
  title: string;
  steps: MessageStep[];
  chatId?: number;
  messageId?: number;
  isLatest?: boolean;
  onOpenSession?: (employeeId: number) => void;
}

export function ProgressCard({
  title,
  steps,
  chatId,
  messageId,
  isLatest = true,
  onOpenSession,
}: ProgressCardProps): React.JSX.Element {
  const { data } = useApp();
  const [interrupting, setInterrupting] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editStep, setEditStep] = useState<MessageStep | null>(null);
  const employees = data.employees.items;
  const hasBusyStep = isLatest && steps.some((s) => s.status === "busy");

  const handleInterrupt = async (): Promise<void> => {
    if (!chatId || interrupting) return;
    setInterrupting(true);
    try {
      await imb.chat.interrupt(chatId);
    } finally {
      setInterrupting(false);
    }
  };

  const handleSaveStep = async (
    targetIndex: number,
    patch: { name: string; role: string; employeeId?: number },
    redispatch: boolean,
  ): Promise<void> => {
    if (chatId === undefined || messageId === undefined) return;
    await imb.chat.rewriteStep(
      chatId,
      messageId,
      targetIndex,
      patch,
      redispatch,
    );
  };

  return (
    <div className={cls("imb-progress-card", isLatest && "imb-is-latest")}>
      <div className="imb-progress-header">
        <div className="imb-progress-card-title">{title}</div>
        {hasBusyStep && chatId !== undefined && isLatest && (
          <button
            type="button"
            className="imb-progress-interrupt-btn"
            disabled={interrupting}
            onClick={() => void handleInterrupt()}
            title={t("Interrupt active task")}
            aria-label={t("Interrupt active task")}
          >
            {interrupting ? t("Stopping…") : t("Interrupt")}
          </button>
        )}
      </div>
      {steps.map((step, index) => {
        const employeeLabelInfo = resolveEmployeeLabel(
          step.name,
          employees,
          step.employeeId,
        );
        const resolvedEmployee = employees.find(
          (e) =>
            (step.employeeId !== undefined && e.id === step.employeeId) ||
            (e.name && e.name.trim() === step.name.trim()) ||
            (e.role && e.role.trim() === step.role.trim()),
        );
        const employeeId = step.employeeId ?? resolvedEmployee?.id ?? null;
        const canOpen = employeeId !== null && onOpenSession !== undefined;

        return (
          <div key={`${step.name}-${index}`} className="imb-progress-row">
            <div className="imb-progress-actor">
              {canOpen ? (
                <button
                  type="button"
                  className="imb-progress-avatar-btn"
                  title={t("Open session for ${name}", {
                    name: employeeLabelInfo.label,
                  })}
                  aria-label={t("Open session for ${name}", {
                    name: employeeLabelInfo.label,
                  })}
                  onClick={() => onOpenSession(employeeId)}
                >
                  <EmployeeAvatar employeeId={employeeId} size={24} />
                </button>
              ) : (
                <div className="imb-progress-avatar-static">
                  <EmployeeAvatar employeeId={employeeId} size={24} />
                </div>
              )}
              <span className="imb-pname">
                {employeeLabelInfo.label}
                {employeeLabelInfo.badge && (
                  <span className="imb-pname-id">
                    {employeeLabelInfo.badge}
                  </span>
                )}
                {step.role && step.role.trim() !== employeeLabelInfo.label && (
                  <span className="imb-pname-role"> · {step.role}</span>
                )}
              </span>
            </div>
            <div className="imb-progress-status-wrap">
              <span
                className={cls("imb-progress-tag", `imb-${step.status}`)}
              >
                <span className="imb-status-dot" aria-hidden="true" />
                {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
              </span>
              {isLatest && chatId !== undefined && messageId !== undefined && (
                <button
                  type="button"
                  className="imb-progress-edit-btn"
                  title={t("Rewrite step")}
                  aria-label={t("Rewrite step")}
                  onClick={() => {
                    setEditIndex(index);
                    setEditStep(step);
                  }}
                >
                  <IconPencil />
                </button>
              )}
            </div>
          </div>
        );
      })}

      <StepEditModal
        open={editIndex !== null && editStep !== null}
        step={editStep}
        stepIndex={editIndex}
        onClose={() => {
          setEditIndex(null);
          setEditStep(null);
        }}
        onSave={handleSaveStep}
      />
    </div>
  );
}
