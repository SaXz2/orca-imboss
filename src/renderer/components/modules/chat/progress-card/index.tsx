import { t } from "@shared/l10n";
import type { MessageStep, StepStatus } from "@shared/types";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import "./index.css";

/** Translation key per step status; rendered through `t()` for locale switches. */
const STEP_LABEL_KEYS: Record<StepStatus, string> = {
  pending: "Pending",
  busy: "In progress",
  done: "Done",
};

export interface ProgressCardProps {
  title: string;
  steps: MessageStep[];
  chatId?: number;
  onOpenSession?: (employeeId: number) => void;
}

export function ProgressCard({
  title,
  steps,
  onOpenSession,
}: ProgressCardProps): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;

  return (
    <div className="imb-progress-card">
      <div className="imb-progress-card-title">{title}</div>
      {steps.map((step, index) => {
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
                  title={t("Open session for ${name}", { name: step.name })}
                  aria-label={t("Open session for ${name}", { name: step.name })}
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
                {step.name}
                {step.role && (
                  <span className="imb-pname-role"> · {step.role}</span>
                )}
              </span>
            </div>
            <span className={cls("imb-progress-tag", `imb-${step.status}`)}>
              <span className="imb-status-dot" aria-hidden="true" />
              {t(STEP_LABEL_KEYS[step.status] ?? step.status)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
