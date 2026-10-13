import type { ArchivedTask } from "@shared/types";
import { getDB } from "./db";
import { getSetting, setSetting } from "./db/settings";

/**
 * Archived tasks: hiding a task from the board while keeping a record of it.
 * Stored as one JSON list under a settings key, so archiving needs no schema
 * change; the board filters these keys out and the archive view lists them.
 */

const ARCHIVE_KEY = "tasks.archived";

function read(): ArchivedTask[] {
  const raw = getSetting(ARCHIVE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArchivedTask);
  } catch {
    return [];
  }
}

function isArchivedTask(value: unknown): value is ArchivedTask {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["key"] === "string" &&
    typeof record["title"] === "string" &&
    typeof record["archivedAt"] === "number"
  );
}

function write(entries: ArchivedTask[]): ArchivedTask[] {
  setSetting(ARCHIVE_KEY, JSON.stringify(entries));
  return entries;
}

/** True when a chat id still exists (a null id has nothing to check). */
function chatAlive(id: number | null): boolean {
  if (id === null) return true;
  return Boolean(getDB().prepare("SELECT 1 FROM chats WHERE id = ?").get(id));
}

/**
 * An archive entry is only meaningful while the thing it points at still
 * exists. Deleting a conversation cascades away its messages and spawned chats,
 * so its archived tasks have to go with it instead of lingering in the list.
 */
function stillExists(entry: ArchivedTask): boolean {
  if (!chatAlive(entry.chatId) || !chatAlive(entry.workChatId)) return false;

  const progress = /^progress:(\d+)$/.exec(entry.key);
  if (progress) {
    const id = Number(progress[1]);
    return Boolean(
      getDB()
        .prepare("SELECT 1 FROM messages WHERE id = ? AND kind = 'progress'")
        .get(id),
    );
  }

  const task = /^task:(\d+)$/.exec(entry.key);
  if (task) {
    const id = Number(task[1]);
    return Boolean(getDB().prepare("SELECT 1 FROM tasks WHERE id = ?").get(id));
  }

  return true;
}

/** Archived tasks, newest first; entries whose task/conversation is gone drop out. */
export function listArchivedTasks(): ArchivedTask[] {
  const entries = read();
  const alive = entries.filter(stillExists);
  // Self-healing: persist the pruned list so stale entries never accumulate.
  if (alive.length !== entries.length) write(alive);
  return alive.sort((a, b) => b.archivedAt - a.archivedAt);
}

/**
 * Drop archive entries whose task or conversation is gone. Called at startup
 * and whenever conversations are deleted, so the archive never lists a task
 * that no longer exists.
 */
export function pruneArchivedTasks(): void {
  listArchivedTasks();
}

/** Archive a task (idempotent per key); returns the updated archive list. */
export function archiveTask(entry: ArchivedTask): ArchivedTask[] {
  const rest = read().filter((item) => item.key !== entry.key);
  return write([entry, ...rest]);
}

/** Restore a task to the board; returns the updated archive list. */
export function unarchiveTask(key: string): ArchivedTask[] {
  return write(read().filter((item) => item.key !== key));
}
