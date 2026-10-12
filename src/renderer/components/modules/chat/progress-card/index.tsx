import { t } from "@shared/l10n";
import type { MessageStep, StepStatus } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { resolveEmployeeLabel } from "../../../../employee-label";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconCheck } from "../../../icons";
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
  isLatest?: boolean;
}

export function ProgressCard({
  title,
  steps,
  chatId,
  isLatest = true,
}: ProgressCardProps): React.JSX.Element {
  const { data } = useApp();
  const [interrupting, setInterrupting] = useState(false);
  const employees = data.employees.items;
  const hasBusyStep = isLatest && steps.some((s) => s.status === "busy");
  const doneCount = steps.filter((s) => s.status === "done").length;
  const totalCount = steps.length;

  const handleInterrupt = async (): Promise<void> => {
    if (!chatId || interrupting) return;
    setInterrupting(true);
    try {
      await imb.chat.interrupt(chatId);
    } finally {
      setInterrupting(false);
    }
  };

  return (
    <div className={cls("imb-progress-card", isLatest && "imb-is-latest")}>
      <div className="imb-progress-header">
        <div className="imb-progress-card-title">{title}</div>
        <div className="imb-progress-meta">
          {totalCount > 0 && (
            <span className="imb-progress-count">
              {doneCount}/{totalCount}
            </span>
          )}
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
      </div>
      {totalCount > 0 && (
        <div
          className="imb-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={doneCount}
        >
          <div
            className="imb-progress-bar-fill"
            style={{ width: `${(doneCount / totalCount) * 100}%` }}
          />
        </div>
      )}
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

        return (
          <div key={`${step.name}-${index}`} className="imb-progress-row">
            <div className="imb-progress-actor">
              <div className="imb-progress-avatar-static">
                <EmployeeAvatar employeeId={employeeId} size={24} />
              </div>
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
                {step.status === "done" ? (
                  <IconCheck className="imb-icon imb-xs imb-progress-tag-icon" />
                ) : (
                  <span className="imb-status-dot" aria-hidden="true" />
                )}
                {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
