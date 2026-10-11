import type { TaskCloseReason, TaskEvent, TaskEventKind, TaskStatus } from "@shared/types";

/**
 * Task presentation vocabulary: board columns, the label palette, and the
 * label keys for statuses, close reasons and timeline event kinds. Kept
 * separate from rendering so the board, editor and detail view agree on one
 * source of truth.
 */

/** Kanban columns, in display order (left → right). */
export const COLUMNS: Array<{ status: TaskStatus; labelKey: string }> = [
  { status: "pending", labelKey: "Pending" },
  { status: "running", labelKey: "In progress" },
  { status: "done", labelKey: "Done" },
  { status: "closed", labelKey: "Closed" },
];

/** Board tag palette (GitHub-like; tint derived from the tag text). */
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

export function labelColor(text: string): string {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return LABEL_COLORS[hash % LABEL_COLORS.length];
}

/** Close-reason → translation key (issue-tracker style reasons). */
export const CLOSE_REASON_KEYS: Record<TaskCloseReason, string> = {
  completed: "Completed",
  rejected: "Rejected",
  duplicate: "Duplicate",
  wontfix: "Won't fix",
};

/** Timeline event kind → translation key. */
export const EVENT_KIND_KEYS: Record<TaskEventKind, string> = {
  created: "Created",
  comment: "Comment",
  request: "Request",
  reject: "Rejection",
  approve: "Approval",
  improvement: "Improvement",
  status: "Status",
  assigned: "Assigned",
  renamed: "Renamed",
  closed: "Closed",
  reopened: "Reopened",
};

/** Kinds offered in the comment composer, in display order. */
export const COMPOSER_KINDS: TaskEventKind[] = [
  "comment",
  "request",
  "reject",
  "approve",
  "improvement",
];

/** Human-readable actor name (`user` → the local user; `employee:<id>` → name). */
export function actorName(
  actor: string,
  employees: readonly { id: number; name?: string; role?: string }[],
  localLabel: string,
): string {
  if (actor === "user") return localLabel;
  if (actor === "system") return "system";
  const match = /^employee:(\d+)$/.exec(actor);
  if (!match) return actor;
  const id = Number(match[1]);
  const employee = employees.find((e) => e.id === id);
  return employee?.name || employee?.role || `#${id}`;
}

/** One-line summary of a system timeline entry's payload. */
export function describeEvent(
  event: TaskEvent,
  employees: readonly { id: number; name?: string; role?: string }[],
): string {
  const meta = event.meta;
  switch (event.kind) {
    case "status": {
      const from = typeof meta["from"] === "string" ? meta["from"] : "";
      const to = typeof meta["to"] === "string" ? meta["to"] : "";
      return `${from} → ${to}`;
    }
    case "assigned": {
      const ids = Array.isArray(meta["assignees"])
        ? (meta["assignees"] as unknown[]).filter(
            (v): v is number => typeof v === "number",
          )
        : [];
      return ids.length === 0
        ? "—"
        : ids
            .map((id) => {
              const employee = employees.find((e) => e.id === id);
              return employee?.name || employee?.role || `#${id}`;
            })
            .join(", ");
    }
    case "renamed": {
      const from = typeof meta["from"] === "string" ? meta["from"] : "";
      const to = typeof meta["to"] === "string" ? meta["to"] : "";
      return `${from} → ${to}`;
    }
    default:
      return "";
  }
}
