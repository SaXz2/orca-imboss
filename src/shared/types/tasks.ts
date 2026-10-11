/** Kanban column / lifecycle stage of a task. */
export type TaskStatus = "pending" | "running" | "done";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "done",
];

/** Row of the `tasks` table (task center). */
export interface Task {
  id: number;
  title: string;
  detail: string;
  /** Small free-form grouping, e.g. a project name. */
  category: string;
  /** Human-readable flow description (e.g. "调研 → 写作 → 审核"). */
  flow: string;
  status: TaskStatus;
  /** Assigned employee ids. */
  assignees: number[];
  /** Manual ordering within a column (ascending). */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** Raw DB row (JSON columns unparsed). */
export interface TaskRow {
  id: number;
  title: string;
  detail: string;
  category: string;
  flow: string;
  status: string;
  assignees: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/** Create/update payload; omitted fields are left untouched on update. */
export interface TaskInput {
  title?: string;
  detail?: string;
  category?: string;
  flow?: string;
  status?: TaskStatus;
  assignees?: number[];
  sortOrder?: number;
}

/** Where a board card comes from. */
export type BoardSource = "task" | "chat";

/**
 * One Task Center board card. `task` cards are the persistent, editable cards;
 * `chat` cards are derived from real task conversations (group chats / bridged
 * chats), so the board reflects the company's actual work — read-only, and
 * clicking one opens that conversation.
 */
export interface BoardCard {
  /** Stable key: `task:<id>` or `chat:<id>`. */
  key: string;
  source: BoardSource;
  refId: number;
  title: string;
  detail: string;
  category: string;
  flow: string;
  status: TaskStatus;
  assignees: number[];
  updatedAt: number;
  /** Latest progress steps (chat cards only; for a compact stepper). */
  steps: import("./messages").MessageStep[];
  /** Chat id to open (chat cards only). */
  chatId: number | null;
}
