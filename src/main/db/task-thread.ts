import {
  EMPTY_REACTIONS,
  TASK_AUTHORED_KINDS,
  type TaskCommentInput,
  type TaskEvent,
  type TaskEventKind,
  type TaskEventRow,
  type TaskReactionKind,
  type TaskReactions,
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
    value === "reopened"
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
  return toEvent(row);
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
