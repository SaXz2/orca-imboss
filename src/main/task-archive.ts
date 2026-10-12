import type { ArchivedTask } from "@shared/types";
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

/** Archived tasks, newest first. */
export function listArchivedTasks(): ArchivedTask[] {
  return read().sort((a, b) => b.archivedAt - a.archivedAt);
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
