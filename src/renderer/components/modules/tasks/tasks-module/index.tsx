import { t } from "@shared/l10n";
import type { ArchivedTask, BoardCard, Task, TaskInput, TaskStatus } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { IconArchive } from "../../../icons";
import { TaskArchiveList } from "./archive-list";
import { TaskCard } from "./task-card";
import { TaskDetail } from "./task-detail";
import { TaskStepsDetail } from "./task-steps-detail";
import { type EditableTask, TaskEditor } from "./task-editor";
import { COLUMNS, labelColor } from "./task-meta";
import "./index.css";

/**
 * Tasks — a GitHub-Projects-style board of the company's work. Manual tasks are
 * editable cards; tasks the assistant posts as progress cards are read-only and
 * open their per-person steps, where each name leads to that employee's session.
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
  const [detailId, setDetailId] = useState<number | null>(null);
  const [progressCard, setProgressCard] = useState<BoardCard | null>(null);
  const [archived, setArchived] = useState<ArchivedTask[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [cards, archives] = await Promise.all([
        imb.tasks.board(),
        imb.tasks.archives(),
      ]);
      setCards(cards);
      setArchived(archives);
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

  // Distinct categories across manual tasks (most used first) — the board's
  // "small classification", used as a filter strip.
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of cards) {
      if (card.source !== "task" || card.category === "") continue;
      counts.set(card.category, (counts.get(card.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
  }, [cards]);

  // A filter whose category disappeared (its last task deleted) is dropped.
  useEffect(() => {
    if (
      categoryFilter !== null &&
      !categories.some(([name]) => name === categoryFilter)
    ) {
      setCategoryFilter(null);
    }
  }, [categories, categoryFilter]);

  const visible = useMemo(
    () =>
      categoryFilter === null
        ? cards
        : cards.filter((card) => card.category === categoryFilter),
    [cards, categoryFilter],
  );

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, BoardCard[]> = {
      pending: [],
      running: [],
      done: [],
      closed: [],
    };
    for (const card of visible) map[card.status].push(card);
    return map;
  }, [visible]);

  const openEdit = (card: BoardCard): void => {
    setEditing(editableFromCard(card));
    setEditorOpen(true);
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

  const archiveCurrent = async (card: BoardCard): Promise<void> => {
    try {
      const list = await imb.tasks.archive({
        key: card.key,
        title: card.title,
        chatId: card.chatId,
        workChatId: card.workChatId,
      });
      setArchived(list);
      setProgressCard(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const restore = async (key: string): Promise<void> => {
    try {
      setArchived(await imb.tasks.unarchive(key));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const content = showArchive ? (
    <TaskArchiveList
      archived={archived}
      onBack={() => setShowArchive(false)}
      onRestore={(key) => void restore(key)}
    />
  ) : progressCard ? (
    <TaskStepsDetail
      key={progressCard.key}
      card={progressCard}
      employees={employees}
      onBack={() => setProgressCard(null)}
      onArchive={(card) => void archiveCurrent(card)}
      onChanged={reload}
      onOpenTask={(id) => {
        setProgressCard(null);
        setDetailId(id);
      }}
    />
  ) : detailId !== null ? (
      <TaskDetail
        key={detailId}
        taskId={detailId}
        employees={employees}
        onBack={() => setDetailId(null)}
        onEdit={(task: Task) => {
          setEditing(task);
          setEditorOpen(true);
        }}
        onChanged={reload}
        onOpenTask={setDetailId}
      />
    ) : (
      <>
        <div className="imb-chat-header imb-task-head">
          <div className="imb-task-head-text">
            <div className="imb-chat-title">{t("Tasks")}</div>
            <div className="imb-task-sub">
              {t("${count} tasks", { count: String(visible.length) })}
            </div>
          </div>
          <div className="imb-task-head-actions">
            <button
              type="button"
              className={cls(
                "imb-task-archive-btn",
                showArchive && "imb-is-on",
              )}
              onClick={() => setShowArchive((on) => !on)}
            >
              <IconArchive />
              {t("Archive")}
              {archived.length > 0 && (
                <span className="imb-task-archive-n">{archived.length}</span>
              )}
            </button>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="imb-board-filters">
            <button
              type="button"
              className={cls(
                "imb-filter-chip",
                categoryFilter === null && "imb-is-on",
              )}
              onClick={() => setCategoryFilter(null)}
            >
              {t("All")}
            </button>
            {categories.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={cls(
                  "imb-filter-chip",
                  categoryFilter === name && "imb-is-on",
                )}
                onClick={() =>
                  setCategoryFilter((current) =>
                    current === name ? null : name,
                  )
                }
              >
                <span
                  className="imb-filter-dot"
                  style={{ background: labelColor(name) }}
                />
                {name}
                <span className="imb-filter-n">{count}</span>
              </button>
            ))}
          </div>
        )}

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
                      card.source === "progress"
                        ? setProgressCard(card)
                        : setDetailId(card.refId)
                    }
                    onEdit={() => openEdit(card)}
                    onArchive={() => void archiveCurrent(card)}
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
    id: card.threadId ?? card.refId,
    title: card.title,
    detail: card.detail,
    category: card.category,
    flow: card.flow,
    status: card.status,
    assignees: card.assignees,
  };
}
