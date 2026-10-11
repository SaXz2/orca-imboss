import { t } from "@shared/l10n";
import type { Task, TaskInput, TaskStatus } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { Button } from "../../../button";
import { EmployeeAvatar } from "../../../employee-avatar";
import { Field } from "../../../field";
import { IconPencil, IconPlus } from "../../../icons";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Select } from "../../../select";
import { Textarea } from "../../../textarea";
import "./index.css";

/** Kanban columns, in display order. */
const COLUMNS: Array<{ status: TaskStatus; labelKey: string }> = [
  { status: "pending", labelKey: "Pending" },
  { status: "running", labelKey: "In progress" },
  { status: "done", labelKey: "Done" },
];

const STATUS_OPTIONS = COLUMNS.map((c) => ({
  value: c.status,
  label: t(c.labelKey),
}));

/**
 * Task Center — a kanban board (待执行 / 正在执行 / 已完成) giving a macro view of
 * the company's tasks. Cards can be dragged between columns, assigned to several
 * employees, grouped by a small category and annotated with a flow.
 */
export function TasksModule(): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await imb.tasks.list();
      setTasks(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void appStore.reloadEmployees();
    void reload();
  }, [reload]);

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      pending: [],
      running: [],
      done: [],
    };
    for (const task of tasks) map[task.status].push(task);
    return map;
  }, [tasks]);

  const openCreate = (): void => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (task: Task): void => {
    setEditing(task);
    setEditorOpen(true);
  };

  const handleDrop = async (status: TaskStatus): Promise<void> => {
    const id = dragId;
    setDragId(null);
    setOverStatus(null);
    if (id === null) return;
    const task = tasks.find((item) => item.id === id);
    if (!task || task.status === status) return;
    try {
      await imb.tasks.move(id, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveTask = async (input: TaskInput): Promise<void> => {
    if (editing) {
      await imb.tasks.update(editing.id, input);
    } else {
      await imb.tasks.create(input);
    }
    setEditorOpen(false);
    setEditing(null);
    await reload();
  };

  const removeTask = async (id: number): Promise<void> => {
    await imb.tasks.remove(id);
    setEditorOpen(false);
    setEditing(null);
    await reload();
  };

  const content = (
    <>
      <div className="imb-chat-header imb-task-head">
        <div className="imb-task-head-text">
          <div className="imb-chat-title">{t("Task Center")}</div>
          <div className="imb-task-sub">
            {t("${count} tasks", { count: String(tasks.length) })}
          </div>
        </div>
        <Button onClick={openCreate}>
          <IconPlus className="imb-icon imb-sm" />
          {t("New task")}
        </Button>
      </div>

      <div className="imb-board">
        {COLUMNS.map((column) => (
          <div
            key={column.status}
            className={cls(
              "imb-board-col",
              `imb-col-${column.status}`,
              overStatus === column.status && "imb-is-drop",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              if (overStatus !== column.status) setOverStatus(column.status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setOverStatus((s) => (s === column.status ? null : s));
              }
            }}
            onDrop={() => void handleDrop(column.status)}
          >
            <div className="imb-board-col-head">
              <span className={`imb-col-dot imb-${column.status}`} aria-hidden="true" />
              <span className="imb-col-name">{t(column.labelKey)}</span>
              <span className="imb-col-count">{byStatus[column.status].length}</span>
            </div>
            <div className="imb-board-col-body">
              {byStatus[column.status].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  employees={employees}
                  dragging={dragId === task.id}
                  onDragStart={() => setDragId(task.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStatus(null);
                  }}
                  onClick={() => openEdit(task)}
                />
              ))}
              {!loading && byStatus[column.status].length === 0 && (
                <div className="imb-board-empty">{t("No tasks")}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error !== null && <p className="imb-error-text imb-chat-error">{error}</p>}

      <TaskEditor
        open={editorOpen}
        task={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={saveTask}
        onDelete={removeTask}
      />
    </>
  );

  return <ModuleView content={content} />;
}

type EmployeeList = readonly {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}[];

function TaskCard({
  task,
  employees,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  task: Task;
  employees: EmployeeList;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <div
      className={cls("imb-task-card", dragging && "imb-is-dragging")}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="imb-task-card-top">
        <span className="imb-task-title">{task.title}</span>
        <span className="imb-task-edit">
          <IconPencil />
        </span>
      </div>
      {task.category && (
        <span className="imb-task-category">{task.category}</span>
      )}
      {task.flow && <div className="imb-task-flow">{task.flow}</div>}
      {task.assignees.length > 0 && (
        <div className="imb-task-card-people">
          {task.assignees.map((id) => {
            const employee = employees.find((e) => e.id === id);
            return (
              <span key={id} className="imb-task-person" title={employee?.name ?? `#${id}`}>
                <EmployeeAvatar employeeId={id} size={20} />
                <span className="imb-task-person-name">
                  {employee?.name || employee?.role || `#${id}`}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TaskEditor({
  open,
  task,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  task: Task | null;
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
    if (!open) return;
    setTitle(task?.title ?? "");
    setDetail(task?.detail ?? "");
    setCategory(task?.category ?? "");
    setFlow(task?.flow ?? "");
    setStatus(task?.status ?? "pending");
    setAssignees(task ? [...task.assignees] : []);
    setError(null);
  }, [open, task]);

  if (!open) return null;

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
      title={task ? t("Edit task") : t("New task")}
      sub={t("Group, assign and set the flow of a task.")}
      error={error}
      actions={
        <>
          {task && (
            <Button
              variant="danger"
              onClick={() => void onDelete(task.id)}
              disabled={saving}
            >
              {t("Delete")}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
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
              options={STATUS_OPTIONS}
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
                  <span>{employee.name || employee.role || `#${employee.id}`}</span>
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
