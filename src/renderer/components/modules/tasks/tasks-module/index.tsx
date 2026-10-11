import { t } from "@shared/l10n";
import type { BoardCard, TaskInput, TaskStatus } from "@shared/types";
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

/** Kanban columns, in display order (GitHub-Project style, left → right). */
const COLUMNS: Array<{ status: TaskStatus; labelKey: string }> = [
  { status: "pending", labelKey: "Pending" },
  { status: "running", labelKey: "In progress" },
  { status: "done", labelKey: "Done" },
];

const STATUS_OPTIONS = COLUMNS.map((c) => ({
  value: c.status,
  label: t(c.labelKey),
}));

/** GitHub-like label palette (chip tint derived from the label text). */
const LABEL_COLORS = [
  "#2f6fed",
  "#e8740c",
  "#12a150",
  "#c026d3",
  "#0891b2",
  "#d9236b",
  "#7c5cff",
  "#a16207",
];

function labelColor(text: string): string {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

/**
 * Task Center — a GitHub-Projects-style board merging the company's manual
 * tasks and its real task conversations (assistant group chats and bridged
 * platform chats), so the board is a live view of what is being worked on.
 */
export function TasksModule(): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;

  const [cards, setCards] = useState<BoardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BoardCard | null>(null);
  const [createStatus, setCreateStatus] = useState<TaskStatus>("pending");

  const reload = useCallback(async (): Promise<void> => {
    try {
      setCards(await imb.tasks.board());
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
    const map: Record<TaskStatus, BoardCard[]> = {
      pending: [],
      running: [],
      done: [],
    };
    for (const card of cards) map[card.status].push(card);
    return map;
  }, [cards]);

  const openCreate = (status: TaskStatus): void => {
    setEditing(null);
    setCreateStatus(status);
    setEditorOpen(true);
  };

  const openEdit = (card: BoardCard): void => {
    if (card.source === "chat") return;
    setEditing(card);
    setEditorOpen(true);
  };

  const openChat = async (chatId: number): Promise<void> => {
    try {
      const summary = await imb.chats.summary(chatId);
      if (summary) appStore.openChat(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDrop = async (status: TaskStatus): Promise<void> => {
    const key = dragKey;
    setDragKey(null);
    setOverStatus(null);
    if (key === null) return;
    const card = cards.find((c) => c.key === key);
    if (!card || card.source !== "task" || card.status === status) return;
    try {
      await imb.tasks.move(card.refId, status);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveTask = async (input: TaskInput): Promise<void> => {
    if (editing) {
      await imb.tasks.update(editing.refId, input);
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
            {t("${count} tasks", { count: String(cards.length) })}
          </div>
        </div>
        <Button onClick={() => openCreate("pending")}>
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
              <span
                className={`imb-col-dot imb-${column.status}`}
                aria-hidden="true"
              />
              <span className="imb-col-name">{t(column.labelKey)}</span>
              <span className="imb-col-count">
                {byStatus[column.status].length}
              </span>
              <button
                type="button"
                className="imb-col-add"
                title={t("New task")}
                aria-label={t("New task")}
                onClick={() => openCreate(column.status)}
              >
                <IconPlus className="imb-icon imb-xs" />
              </button>
            </div>
            <div className="imb-board-col-body">
              {byStatus[column.status].map((card) => (
                <TaskCard
                  key={card.key}
                  card={card}
                  employees={employees}
                  dragging={dragKey === card.key}
                  onDragStart={() => setDragKey(card.key)}
                  onDragEnd={() => {
                    setDragKey(null);
                    setOverStatus(null);
                  }}
                  onOpen={() =>
                    card.source === "chat" && card.chatId !== null
                      ? void openChat(card.chatId)
                      : openEdit(card)
                  }
                />
              ))}
              {!loading && byStatus[column.status].length === 0 && (
                <div className="imb-board-empty">{t("No tasks")}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {error !== null && (
        <p className="imb-error-text imb-chat-error">{error}</p>
      )}

      <TaskEditor
        open={editorOpen}
        card={editing}
        initialStatus={createStatus}
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
  card,
  employees,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  card: BoardCard;
  employees: EmployeeList;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}): React.JSX.Element {
  const isChat = card.source === "chat";
  const doneSteps = card.steps.filter((s) => s.status === "done").length;
  const totalSteps = card.steps.length;
  const shown = card.assignees.slice(0, 4);
  const extra = card.assignees.length - shown.length;

  return (
    <div
      className={cls(
        "imb-gh-card",
        isChat && "imb-is-chat",
        dragging && "imb-is-dragging",
      )}
      draggable={!isChat}
      onDragStart={isChat ? undefined : onDragStart}
      onDragEnd={isChat ? undefined : onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="imb-gh-card-title">{card.title}</div>

      {(card.category || totalSteps > 0) && (
        <div className="imb-gh-card-labels">
          {card.category && (
            <span
              className="imb-gh-label"
              style={{
                color: labelColor(card.category),
                borderColor: labelColor(card.category),
                background: `color-mix(in srgb, ${labelColor(card.category)} 12%, transparent)`,
              }}
            >
              {card.category}
            </span>
          )}
          {totalSteps > 0 && (
            <span className="imb-gh-steps">
              {t("${done} of ${total} steps", {
                done: String(doneSteps),
                total: String(totalSteps),
              })}
            </span>
          )}
        </div>
      )}

      <div className="imb-gh-card-foot">
        <span className="imb-gh-ref">
          {isChat ? t("Conversation") : `#${card.refId}`}
        </span>
        <span className="imb-gh-assignees">
          {shown.map((id) => (
            <span key={id} className="imb-gh-assignee">
              <EmployeeAvatar employeeId={id} size={20} />
            </span>
          ))}
          {extra > 0 && <span className="imb-gh-more">{`+${extra}`}</span>}
        </span>
        {!isChat && (
          <span className="imb-gh-edit" aria-hidden="true">
            <IconPencil />
          </span>
        )}
      </div>
    </div>
  );
}

function TaskEditor({
  open,
  card,
  initialStatus,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  card: BoardCard | null;
  initialStatus: TaskStatus;
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
    setTitle(card?.title ?? "");
    setDetail(card?.detail ?? "");
    setCategory(card?.category ?? "");
    setFlow(card?.flow ?? "");
    setStatus(card?.status ?? initialStatus);
    setAssignees(card ? [...card.assignees] : []);
    setError(null);
  }, [open, card, initialStatus]);

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
      title={card ? t("Edit task") : t("New task")}
      sub={t("Group, assign and set the flow of a task.")}
      error={error}
      actions={
        <>
          {card && (
            <Button
              variant="danger"
              onClick={() => void onDelete(card.refId)}
              disabled={saving}
            >
              {t("Delete")}
            </Button>
          )}
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
