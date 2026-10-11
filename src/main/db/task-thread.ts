import {
  EMPTY_REACTIONS,
  TASK_AUTHORED_KINDS,
  TASK_STATUSES,
  type TaskCommentInput,
  type TaskEvent,
  type TaskEventKind,
  type TaskEventRow,
  type TaskLinkKind,
  type TaskReactionKind,
  type TaskReactions,
  type TaskRef,
  type TaskStatus,
} from "@shared/types";
import { getDB } from "./index";
import { parseJsonObject } from "./json";

/**
 * Task thread persistence: the append-only timeline (`task_events`) and the
 * feedback rollups (`task_reactions`) that hang off a task. Task CRUD itself
 * lives in `tasks.ts`; this module owns everything that accumulates *on* a task.
 */

/** The local user's actor key. Employees use `employee:<id>`. */
export const LOCAL_ACTOR = "user";

const MAX_BODY = 8000;

function isEventKind(value: unknown): value is TaskEventKind {
  return (
    TASK_AUTHORED_KINDS.includes(value as TaskEventKind) ||
    value === "created" ||
    value === "status" ||
    value === "assigned" ||
    value === "renamed" ||
    value === "closed" ||
    value === "reopened" ||
    value === "referenced"
  );
}

function isReactionKind(value: unknown): value is TaskReactionKind {
  return value === "like" || value === "bookmark" || value === "follow";
}

function toEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    actor: row.actor,
    kind: isEventKind(row.kind) ? row.kind : "comment",
    body: row.body,
    meta: parseJsonObject(row.meta),
    createdAt: row.created_at,
  };
}

/** The full timeline for a task, oldest → newest. */
export function listTaskEvents(taskId: number): TaskEvent[] {
  return (
    getDB()
      .prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC")
      .all(taskId) as TaskEventRow[]
  ).map(toEvent);
}

/**
 * Append one timeline entry. Called both by task CRUD (lifecycle entries) and
 * by authored comments. `actor` defaults to `system` for lifecycle entries.
 */
export function logTaskEvent(
  taskId: number,
  kind: TaskEventKind,
  options: {
    actor?: string;
    body?: string;
    meta?: Record<string, unknown>;
  } = {},
): void {
  getDB()
    .prepare(
      "INSERT INTO task_events (task_id, actor, kind, body, meta) " +
        "VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      taskId,
      options.actor ?? "system",
      kind,
      (options.body ?? "").slice(0, MAX_BODY),
      JSON.stringify(options.meta ?? {}),
    );
}

/** Post an authored entry (discussion, demand, rejection, approval, proposal). */
export function addTaskComment(
  taskId: number,
  input: TaskCommentInput,
): TaskEvent {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (body.length === 0) throw new Error("A comment body is required.");
  const kind =
    input.kind !== undefined && TASK_AUTHORED_KINDS.includes(input.kind)
      ? input.kind
      : "comment";
  const actor =
    typeof input.actor === "string" && input.actor.trim().length > 0
      ? input.actor.trim()
      : LOCAL_ACTOR;
  const result = getDB()
    .prepare(
      "INSERT INTO task_events (task_id, actor, kind, body, meta) " +
        "VALUES (?, ?, ?, ?, '{}')",
    )
    .run(taskId, actor, kind, body.slice(0, MAX_BODY));
  const row = getDB()
    .prepare("SELECT * FROM task_events WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as TaskEventRow | undefined;
  if (!row) throw new Error("Failed to add the comment.");
  // `#id` mentions in the body become directed edges to those tasks.
  for (const target of parseTaskRefs(body)) {
    linkTasks(taskId, target, "references");
  }
  return toEvent(row);
}

/** Task ids referenced as `#123` in a body of text, de-duplicated. */
export function parseTaskRefs(body: string): number[] {
  const ids = new Set<number>();
  for (const match of body.matchAll(/#(\d+)(?![\d])/g)) {
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Record a directed edge between two tasks, and (when the edge is new) append
 * a `referenced` entry to the target's timeline — the GitHub cross-reference
 * behaviour, in both directions of discovery.
 */
export function linkTasks(
  fromTaskId: number,
  toTaskId: number,
  kind: TaskLinkKind = "references",
): void {
  if (fromTaskId === toTaskId) return;
  const db = getDB();
  // A dead reference (the target was deleted) is silently dropped.
  const target = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(toTaskId);
  if (!target) return;
  const inserted = db
    .prepare(
      "INSERT OR IGNORE INTO task_links (from_task_id, to_task_id, kind) " +
        "VALUES (?, ?, ?)",
    )
    .run(fromTaskId, toTaskId, kind);
  if (inserted.changes > 0) {
    logTaskEvent(toTaskId, "referenced", { meta: { fromTaskId } });
  }
}

function toRef(row: { id: number; title: string; status: string }): TaskRef {
  return {
    id: row.id,
    title: row.title,
    status: TASK_STATUSES.includes(row.status as TaskStatus)
      ? (row.status as TaskStatus)
      : "pending",
  };
}

/** Outgoing (this task mentions them) and incoming reference lists. */
export function taskReferences(taskId: number): {
  out: TaskRef[];
  in: TaskRef[];
} {
  const db = getDB();
  const out = db
    .prepare(
      "SELECT t.id, t.title, t.status FROM task_links l " +
        "JOIN tasks t ON t.id = l.to_task_id " +
        "WHERE l.from_task_id = ? AND l.kind = 'references' ORDER BY l.id DESC",
    )
    .all(taskId) as Array<{ id: number; title: string; status: string }>;
  const incoming = db
    .prepare(
      "SELECT t.id, t.title, t.status FROM task_links l " +
        "JOIN tasks t ON t.id = l.from_task_id " +
        "WHERE l.to_task_id = ? AND l.kind = 'references' ORDER BY l.id DESC",
    )
    .all(taskId) as Array<{ id: number; title: string; status: string }>;
  return { out: out.map(toRef), in: incoming.map(toRef) };
}

/** Authored-entry counts for many tasks at once (board card badges). */
export function authoredCounts(taskIds: readonly number[]): Map<number, number> {
  const map = new Map<number, number>();
  if (taskIds.length === 0) return map;
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = getDB()
    .prepare(
      `SELECT task_id, COUNT(*) AS n FROM task_events
        WHERE task_id IN (${placeholders})
          AND kind IN ('comment','request','reject','approve','improvement')
        GROUP BY task_id`,
    )
    .all(...taskIds) as Array<{ task_id: number; n: number }>;
  for (const row of rows) map.set(row.task_id, row.n);
  return map;
}

/** Feedback rollup for one task, including the local actor's own state. */
export function getTaskReactions(
  taskId: number,
  actor: string = LOCAL_ACTOR,
): TaskReactions {
  return reactionsFor([taskId], actor).get(taskId) ?? { ...EMPTY_REACTIONS };
}

/** Reaction rollups for many tasks at once (board cards). */
export function reactionsFor(
  taskIds: readonly number[],
  actor: string = LOCAL_ACTOR,
): Map<number, TaskReactions> {
  const map = new Map<number, TaskReactions>();
  if (taskIds.length === 0) return map;
  for (const id of taskIds) map.set(id, { ...EMPTY_REACTIONS });
  const placeholders = taskIds.map(() => "?").join(", ");
  const rows = getDB()
    .prepare(
      `SELECT task_id, kind, COUNT(*) AS n,
              MAX(CASE WHEN actor = ? THEN 1 ELSE 0 END) AS mine
         FROM task_reactions
        WHERE task_id IN (${placeholders})
        GROUP BY task_id, kind`,
    )
    .all(actor, ...taskIds) as Array<{
    task_id: number;
    kind: string;
    n: number;
    mine: number;
  }>;
  for (const row of rows) {
    if (!isReactionKind(row.kind)) continue;
    const entry = map.get(row.task_id);
    if (!entry) continue;
    entry[row.kind] = row.n;
    if (row.mine === 1) {
      if (row.kind === "like") entry.liked = true;
      else if (row.kind === "bookmark") entry.bookmarked = true;
      else entry.following = true;
    }
  }
  return map;
}

/** Toggle one feedback kind for an actor; returns the task's new rollup. */
export function toggleTaskReaction(
  taskId: number,
  kind: TaskReactionKind,
  actor: string = LOCAL_ACTOR,
): TaskReactions {
  if (!isReactionKind(kind)) throw new Error("Unknown reaction kind.");
  const db = getDB();
  const existing = db
    .prepare(
      "SELECT 1 FROM task_reactions WHERE task_id = ? AND actor = ? AND kind = ?",
    )
    .get(taskId, actor, kind);
  if (existing) {
    db.prepare(
      "DELETE FROM task_reactions WHERE task_id = ? AND actor = ? AND kind = ?",
    ).run(taskId, actor, kind);
  } else {
    db.prepare(
      "INSERT INTO task_reactions (task_id, actor, kind) VALUES (?, ?, ?)",
    ).run(taskId, actor, kind);
  }
  return getTaskReactions(taskId, actor);
}
