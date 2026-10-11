import { t } from "@shared/l10n";
import type { MessageStep } from "@shared/types";
import { useEffect, useState } from "react";
import { useApp } from "../../../../../app-store";
import { Button } from "../../../../button";
import { Field } from "../../../../field";
import { Input } from "../../../../input";
import { Modal } from "../../../../modal";
import { Select } from "../../../../select";
import "./index.css";

export interface StepEditModalProps {
  open: boolean;
  step: MessageStep | null;
  stepIndex: number | null;
  onClose: () => void;
  onSave: (
    stepIndex: number,
    patch: { name: string; role: string; employeeId?: number },
    redispatch: boolean,
  ) => Promise<void>;
}

/**
 * 进度卡片任务步骤改写与重新流转编辑弹窗，提供步骤名、角色与责任员工的修订。
 */
export function StepEditModal({
  open,
  step,
  stepIndex,
  onClose,
  onSave,
}: StepEditModalProps): React.JSX.Element | null {
  const { data } = useApp();
  const employees = data.employees.items;

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [employeeIdStr, setEmployeeIdStr] = useState("");
  const [redispatch, setRedispatch] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && step) {
      setName(step.name);
      setRole(step.role);
      setEmployeeIdStr(
        step.employeeId !== undefined ? String(step.employeeId) : "",
      );
      setRedispatch(true);
      setError(null);
    }
  }, [open, step]);

  if (!open || !step || stepIndex === null) return null;

  const employeeOptions = [
    { value: "", label: t("Default (Assistant / Unassigned)") },
    ...employees.map((e) => ({
      value: String(e.id),
      label: `${e.name || e.role || `#${e.id}`} (#${e.id})`,
    })),
  ];

  const handleConfirm = async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t("Please enter a step name."));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const targetEmpId = employeeIdStr ? parseInt(employeeIdStr, 10) : undefined;
      await onSave(
        stepIndex,
        {
          name: trimmedName,
          role: role.trim(),
          ...(typeof targetEmpId === "number" && !isNaN(targetEmpId)
            ? { employeeId: targetEmpId }
            : {}),
        },
        redispatch,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("Rewrite task step")}
      sub={t("Edit step instructions and optionally re-dispatch to the team.")}
      error={error}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={saving}
          >
            {saving ? t("Saving…") : t("Confirm")}
          </Button>
        </>
      }
    >
      <div className="imb-step-edit-body">
        <Field label={t("Task / Step name")} htmlFor="step-edit-name">
          <Input
            id="step-edit-name"
            value={name}
            maxLength={256}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t("Role")} htmlFor="step-edit-role">
          <Input
            id="step-edit-role"
            value={role}
            maxLength={256}
            onChange={(e) => setRole(e.target.value)}
          />
        </Field>

        <Field label={t("Assigned employee")} htmlFor="step-edit-employee">
          <Select
            id="step-edit-employee"
            value={employeeIdStr}
            options={employeeOptions}
            onChange={setEmployeeIdStr}
          />
        </Field>

        <label className="imb-step-edit-check">
          <input
            type="checkbox"
            checked={redispatch}
            onChange={(e) => setRedispatch(e.target.checked)}
          />
          <span>{t("Re-dispatch to employee and run immediately")}</span>
        </label>
      </div>
    </Modal>
  );
}
