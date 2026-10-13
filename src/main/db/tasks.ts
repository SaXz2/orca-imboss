import {
  TASK_CLOSE_REASONS,
  type Task,
  type TaskCloseReason,
  type TaskInput,
  type TaskRow,
  type TaskStatus,
} from "@shared/types";
import { getDB } from "./index";
import { parseNumberArray, stringifyArray } from "./json";
import { logTaskEvent } from "./task-thread";

/**
 * Task-center persistence (kanban board). Plain CRUD over the `tasks` table;
 * `assignees` is a JSON array column parsed defensively on read.
 *
 * Every lifecycle change also appends a timeline entry (see `task-thread.ts`),
 * so a task is a thread: the row holds current state, the timeline holds how
 * it got there.
 */

const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const MAX_CATEGORY = 60;
const MAX_FLOW = 200;
const MAX_ASSIGNEES = 50;

function isStatus(value: unknown): value is TaskStatus {
  return (
    value === "pending" ||
    value === "running" ||
    value === "done" ||
    value === "closed"
  );
}

function isCloseReason(value: unknown): value is TaskCloseReason {
  return TASK_CLOSE_REASONS.includes(value as TaskCloseReason);
}

function toTask(row: TaskRow): Task {
  const status: TaskStatus = isStatus(row.status) ? row.status : "pending";
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    category: row.category,
    flow: row.flow,
    status,
    closeReason:
      status === "closed"
        ? isCloseReason(row.close_reason)
          ? row.close_reason
          : "completed"
        : null,
    assignees: parseNumberArray(row.assignees),
    sortOrder: row.sort_order,
    progressKey: row.progress_key,
    workChatId: row.work_chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTasks(): Task[] {
  return (
    getDB()
      .prepare("SELECT * FROM tasks ORDER BY sort_order ASC, id ASC")
      .all() as TaskRow[]
  ).map(toTask);
}

/**
 * Promote a progress-derived board card into a real task, so it can carry a
 * thread. Idempotent on `progressKey`; the task's fields track the latest card
 * snapshot on every call.
 */
export function ensureProgressTask(input: {
  progressKey: string;
  title: string;
  flow?: string;
  status?: TaskStatus;
  assignees?: number[];
  workChatId?: number | null;
}): Task {
  const key = input.progressKey.slice(0, 200);
  if (key.length === 0) throw new Error("A progress key is required.");
  const db = getDB();
  const existing = db
    .prepare("SELECT id, status FROM tasks WHERE progress_key = ?")
    .get(key) as { id: number; status: string } | undefined;
  const status = isStatus(input.status) ? input.status : "done";
  if (existing) {
    // A closed card stays closed: its board column is the user's decision, not
    // something the next progress re-post should undo.
    const nextStatus = existing.status === "closed" ? "closed" : status;
    db.prepare(
      "UPDATE tasks SET title = ?, flow = ?, status = ?, assignees = ?, " +
        "work_chat_id = ?, " +
        "updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?",
    ).run(
      cleanText(input.title, MAX_TITLE) || "—",
      cleanText(input.flow, MAX_FLOW),
      nextStatus,
      stringifyArray(cleanAssignees(input.assignees)),
      typeof input.workChatId === "number" ? input.workChatId : null,
      existing.id,
    );
    const updated = getTask(existing.id);
    if (updated) return updated;
  }
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE status = ?",
    )
    .get(status) as { m: number };
  const result = db
    .prepare(
      "INSERT INTO tasks (title, detail, category, flow, status, assignees, " +
        "sort_order, progress_key, work_chat_id) " +
        "VALUES (?, '', '', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      cleanText(input.title, MAX_TITLE) || "—",
      cleanText(input.flow, MAX_FLOW),
      status,
      stringifyArray(cleanAssignees(input.assignees)),
      maxRow.m + 1,
      key,
      typeof input.workChatId === "number" ? input.workChatId : null,
    );
  const id = Number(result.lastInsertRowid);
  logTaskEvent(id, "created", { meta: { title: input.title, status } });
  const created = getTask(id);
  if (!created) throw new Error("Failed to promote the task.");
  return created;
}

export function getTask(id: number): Task | null {
  const row = getDB().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    TaskRow | undefined;
  return row ? toTask(row) : null;
}

function validateTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  if (title.length === 0) throw new Error("A task title is required.");
  if (title.length > MAX_TITLE) throw new Error("Task title is too long.");
  return title;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function cleanAssignees(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter(
          (v): v is number =>
            typeof v === "number" && Number.isSafeInteger(v) && v >= 0,
        )
        .slice(0, MAX_ASSIGNEES),
    ),
  ];
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Bump a task's `updated_at` (board ordering) after off-row activity. */
export function touchTask(id: number): void {
  getDB()
    .prepare("UPDATE tasks SET updated_at = ? WHERE id = ?")
    .run(now(), id);
}

export function createTask(input: TaskInput): Task {
  const db = getDB();
  const title = validateTitle(input.title);
  const status = isStatus(input.status) ? input.status : "pending";
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE status = ?",
    )
    .get(status) as { m: number };
  const result = db
    .prepare(
      "INSERT INTO tasks (title, detail, category, flow, status, assignees, sort_order) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      title,
      cleanText(input.detail, MAX_TEXT),
      cleanText(input.category, MAX_CATEGORY),
      cleanText(input.flow, MAX_FLOW),
      status,
      stringifyArray(cleanAssignees(input.assignees)),
      maxRow.m + 1,
    );
  const id = Number(result.lastInsertRowid);
  logTaskEvent(id, "created", { meta: { title, status } });
  const created = getTask(id);
  if (!created) throw new Error("Failed to create task.");
  return created;
}

export function updateTask(id: number, input: TaskInput): Task | null {
  const current = getTask(id);
  if (!current) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  const events: Array<() => void> = [];
  if (input.title !== undefined) {
    const title = validateTitle(input.title);
    sets.push("title = ?");
    values.push(title);
    if (title !== current.title) {
      events.push(() =>
        logTaskEvent(id, "renamed", {
          meta: { from: current.title, to: title },
        }),
      );
    }
  }
  if (input.detail !== undefined) {
    sets.push("detail = ?");
    values.push(cleanText(input.detail, MAX_TEXT));
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    values.push(cleanText(input.category, MAX_CATEGORY));
  }
  if (input.flow !== undefined) {
    sets.push("flow = ?");
    values.push(cleanText(input.flow, MAX_FLOW));
  }
  if (input.status !== undefined && isStatus(input.status)) {
    sets.push("status = ?");
    values.push(input.status);
    if (input.status !== current.status) {
      const reason = isCloseReason(input.closeReason)
        ? input.closeReason
        : "completed";
      if (input.status === "closed") {
        sets.push("close_reason = ?");
        values.push(reason);
        events.push(() =>
          logTaskEvent(id, "closed", { meta: { closeReason: reason } }),
        );
      } else if (current.status === "closed") {
        sets.push("close_reason = NULL");
        events.push(() => logTaskEvent(id, "reopened", {}));
      } else {
        events.push(() =>
          logTaskEvent(id, "status", {
            meta: { from: current.status, to: input.status },
          }),
        );
      }
    }
  }
  if (input.assignees !== undefined) {
    const assignees = cleanAssignees(input.assignees);
    sets.push("assignees = ?");
    values.push(stringifyArray(assignees));
    const before = [...current.assignees].sort().join(",");
    const after = [...assignees].sort().join(",");
    if (before !== after) {
      events.push(() => logTaskEvent(id, "assigned", { meta: { assignees } }));
    }
  }
  if (sets.length === 0) return current;
  sets.push("updated_at = CAST(strftime('%s', 'now') AS INTEGER)");
  values.push(id);
  getDB()
    .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);
  for (const emit of events) emit();
  return getTask(id);
}

/** Move a task to a status column, placing it at the end of that column. */
export function moveTask(id: number, status: TaskStatus): Task | null {
  const current = getTask(id);
  if (!current || !isStatus(status)) return null;
  if (current.status === status) return current;
  const db = getDB();
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE status = ?",
    )
    .get(status) as { m: number };
  const closed = status === "closed";
  if (closed) {
    db.prepare(
      "UPDATE tasks SET status = ?, close_reason = 'completed', sort_order = ?, " +
        "updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?",
    ).run(status, maxRow.m + 1, id);
    logTaskEvent(id, "closed", { meta: { closeReason: "completed" } });
  } else {
    db.prepare(
      "UPDATE tasks SET status = ?, close_reason = NULL, sort_order = ?, " +
        "updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?",
    ).run(status, maxRow.m + 1, id);
    if (current.status === "closed") {
      logTaskEvent(id, "reopened", { meta: { status } });
    } else {
      logTaskEvent(id, "status", {
        meta: { from: current.status, to: status },
      });
    }
  }
  return getTask(id);
}

/** Close a task with an explicit reason (issue-tracker close reasons). */
export function closeTask(id: number, reason: unknown): Task | null {
  const current = getTask(id);
  if (!current) return null;
  const resolved = isCloseReason(reason) ? reason : "completed";
  getDB()
    .prepare(
      "UPDATE tasks SET status = 'closed', close_reason = ?, " +
        "updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?",
    )
    .run(resolved, id);
  logTaskEvent(id, "closed", { meta: { closeReason: resolved } });
  return getTask(id);
}

/**
 * Reopen a promoted task named by its progress identity (a closed card whose
 * archive entry is being restored). Null when no such task exists.
 */
export function reopenProgressTask(progressKey: string): Task | null {
  const row = getDB()
    .prepare("SELECT id FROM tasks WHERE progress_key = ?")
    .get(progressKey) as { id: number } | undefined;
  return row ? reopenTask(row.id) : null;
}

/** Reopen a closed task back to the pending column. */
export function reopenTask(id: number): Task | null {
  const current = getTask(id);
  if (!current) return null;
  if (current.status !== "closed") return current;
  const db = getDB();
  const maxRow = db
    .prepare(
      "SELECT COALESCE(MAX(sort_order), 0) AS m FROM tasks WHERE status = 'pending'",
    )
    .get() as { m: number };
  db.prepare(
    "UPDATE tasks SET status = 'pending', close_reason = NULL, sort_order = ?, " +
      "updated_at = CAST(strftime('%s', 'now') AS INTEGER) WHERE id = ?",
  ).run(maxRow.m + 1, id);
  logTaskEvent(id, "reopened", {});
  return getTask(id);
}

export function deleteTask(id: number): boolean {
  return getDB().prepare("DELETE FROM tasks WHERE id = ?").run(id).changes > 0;
}
