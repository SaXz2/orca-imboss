import { t } from "@shared/l10n";
import type { BoardCard, Task, TaskInput, TaskStatus } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { Button } from "../../../button";
import { IconPlus } from "../../../icons";
import { TaskCard } from "./task-card";
import { TaskDetail } from "./task-detail";
import { type EditableTask, TaskEditor } from "./task-editor";
import { COLUMNS } from "./task-meta";
import "./index.css";

/**
 * Tasks — a GitHub-Projects-style board merging the company's manual
 * tasks and its real task conversations. Selecting a task card opens its
 * thread (timeline + discussion + feedback); conversation-derived cards open
 * the underlying chat instead.
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
  const [editing, setEditing] = useState<EditableTask | null>(null);
  const [createStatus, setCreateStatus] = useState<TaskStatus>("pending");
  const [detailId, setDetailId] = useState<number | null>(null);

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
      closed: [],
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
    setEditing(editableFromCard(card));
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
    if (detailId === id) setDetailId(null);
    await reload();
  };

  const content =
    detailId !== null ? (
      <TaskDetail
        taskId={detailId}
        employees={employees}
        onBack={() => setDetailId(null)}
        onEdit={(task: Task) => {
          setEditing(task);
          setEditorOpen(true);
        }}
        onChanged={reload}
      />
    ) : (
      <>
        <div className="imb-chat-header imb-task-head">
          <div className="imb-task-head-text">
            <div className="imb-chat-title">{t("Tasks")}</div>
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
                        : setDetailId(card.refId)
                    }
                    onEdit={() => openEdit(card)}
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
      </>
    );

  return (
    <>
      <ModuleView content={content} />
      <TaskEditor
        open={editorOpen}
        task={editing}
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
}

/** The editable subset the editor works on, taken from a board card. */
function editableFromCard(card: BoardCard): EditableTask {
  return {
    id: card.refId,
    title: card.title,
    detail: card.detail,
    category: card.category,
    flow: card.flow,
    status: card.status,
    assignees: card.assignees,
  };
}
