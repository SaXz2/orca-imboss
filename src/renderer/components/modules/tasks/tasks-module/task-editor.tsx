import { t } from "@shared/l10n";
import type { TaskInput, TaskStatus } from "@shared/types";
import { useEffect, useState } from "react";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";

/** The editable fields of a task, accepted from either a board card or the
 * detail view's loaded task. */
export interface EditableTask {
  id: number;
  title: string;
  detail: string;
  category: string;
  flow: string;
  status: TaskStatus;
  assignees: number[];
}

/** Statuses offered by the editor; "closed" is reserved for the close action. */
const EDITOR_STATUSES: Array<{ status: TaskStatus; labelKey: string }> = [
  { status: "pending", labelKey: "Pending" },
  { status: "running", labelKey: "In progress" },
  { status: "done", labelKey: "Done" },
];

/** Edit a task's own fields (the thread lives in the detail / steps view). */
export function TaskEditor({
  open,
  task,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  task: EditableTask | null;
  onClose: () => void;
  onSave: (input: TaskInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}): React.JSX.Element | null {
  const { data } = useApp();
  const employees = data.employees.items;

  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [category, setCategory] = useState("");
  const [flow, setFlow] = useState("");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [assignees, setAssignees] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || task === null) return;
    setTitle(task.title);
    setDetail(task.detail);
    setCategory(task.category);
    setFlow(task.flow);
    setStatus(task.status === "closed" ? "pending" : task.status);
    setAssignees([...task.assignees]);
    setError(null);
  }, [open, task]);

  if (!open || task === null) return null;

  const toggleAssignee = (id: number): void => {
    setAssignees((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async (): Promise<void> => {
    if (!title.trim()) {
      setError(t("Please enter a task title."));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        detail,
        category: category.trim(),
        flow: flow.trim(),
        status,
        assignees,
      });
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
      size="lg"
      title={t("Edit task")}
      sub={t("Group, assign and set the flow of a task.")}
      error={error}
      actions={
        <>
          <Button
            variant="danger"
            onClick={() => void onDelete(task.id)}
            disabled={saving}
          >
            {t("Delete")}
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? t("Saving…") : t("Confirm")}
          </Button>
        </>
      }
    >
      <div className="imb-task-editor">
        <Field label={t("Title")} htmlFor="task-title">
          <Input
            id="task-title"
            value={title}
            maxLength={200}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <div className="imb-task-editor-row">
          <Field label={t("Category")} htmlFor="task-category">
            <Input
              id="task-category"
              value={category}
              maxLength={60}
              placeholder={t("e.g. Project A")}
              onChange={(e) => setCategory(e.target.value)}
            />
          </Field>
          <Field label={t("Status")} htmlFor="task-status">
            <Select
              id="task-status"
              value={status}
              options={EDITOR_STATUSES.map((option) => ({
                value: option.status,
                label: t(option.labelKey),
              }))}
              onChange={(value) => setStatus(value as TaskStatus)}
            />
          </Field>
        </div>

        <Field label={t("Flow")} htmlFor="task-flow">
          <Input
            id="task-flow"
            value={flow}
            maxLength={200}
            placeholder={t("e.g. research → draft → review")}
            onChange={(e) => setFlow(e.target.value)}
          />
        </Field>

        <Field label={t("Assignees")} htmlFor="task-assignees">
          <div className="imb-task-assignees" id="task-assignees">
            {employees.map((employee) => {
              const on = assignees.includes(employee.id);
              return (
                <button
                  key={employee.id}
                  type="button"
                  className={cls("imb-task-assignee", on && "imb-is-on")}
                  onClick={() => toggleAssignee(employee.id)}
                >
                  <EmployeeAvatar employeeId={employee.id} size={20} />
                  <span>
                    {employee.name || employee.role || `#${employee.id}`}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={t("Details")} htmlFor="task-detail">
          <Textarea
            id="task-detail"
            value={detail}
            rows={4}
            minHeight={72}
            maxHeight={200}
            onChange={(e) => setDetail(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
