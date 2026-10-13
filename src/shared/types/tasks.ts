/**
 * Task-center (kanban board) domain types.
 *
 * A task is modelled as a *thread*: a persistent entity plus an append-only
 * timeline of events (comments, status changes, assignment, closing), plus
 * reactions on the thread. This mirrors how issue trackers treat state — a
 * status is not just a field, changing it appends an event.
 */

/** Kanban column / lifecycle stage of a task. */
export type TaskStatus = "pending" | "running" | "done" | "closed";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "running",
  "done",
  "closed",
];

/** Why a task was closed (issue-tracker style close reasons). */
export type TaskCloseReason =
  "completed" | "rejected" | "duplicate" | "wontfix";

export const TASK_CLOSE_REASONS: readonly TaskCloseReason[] = [
  "completed",
  "rejected",
  "duplicate",
  "wontfix",
];

/**
 * Timeline entry kinds.
 *
 * `comment`/`request`/`reject`/`approve`/`improvement` are authored entries
 * (discussion, demands, rejections, approvals, improvement proposals);
 * the rest are system entries appended by the lifecycle itself.
 */
export type TaskEventKind =
  | "created"
  | "comment"
  | "request"
  | "reject"
  | "approve"
  | "improvement"
  | "status"
  | "assigned"
  | "renamed"
  | "closed"
  | "reopened"
  | "referenced";

/** Event kinds a human/agent can author (as opposed to system-generated). */
export const TASK_AUTHORED_KINDS: readonly TaskEventKind[] = [
  "comment",
  "request",
  "reject",
  "approve",
  "improvement",
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
  /** Set only while `status` is `closed`. */
  closeReason: TaskCloseReason | null;
  /** Assigned employee ids. */
  assignees: number[];
  /** Manual ordering within a column (ascending). */
  sortOrder: number;
  /**
   * Stable key of the progress card this task was promoted from, or null for a
   * hand-written task. Promoted tasks are shown on the board through their
   * progress card, not as a separate card.
   */
  progressKey: string | null;
  /** The working group chat this task's people work in (mentions land here). */
  workChatId: number | null;
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
  close_reason: string | null;
  assignees: string;
  sort_order: number;
  progress_key: string | null;
  work_chat_id: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * An archived task: just enough to list it and jump back into it. Archiving is
 * a board-level hide, so it stores the board key rather than the task itself.
 */
export interface ArchivedTask {
  /** Board key of the archived card (`progress:<id>`). */
  key: string;
  title: string;
  /** Conversation to open (root chat, present in the chat list). */
  chatId: number | null;
  /** The task's working group chat. */
  workChatId: number | null;
  /**
   * Stable task identity the card was promoted under, so restoring can reopen
   * the same task (`group:<chatId>` or `<chatId>:<title>`).
   */
  progressKey: string | null;
  /** Epoch milliseconds the task was archived. */
  archivedAt: number;
}

/** Create/update payload; omitted fields are left untouched on update. */
export interface TaskInput {
  title?: string;
  detail?: string;
  category?: string;
  flow?: string;
  status?: TaskStatus;
  closeReason?: TaskCloseReason | null;
  assignees?: number[];
  sortOrder?: number;
}

/**
 * Promote a progress-derived board card into a real task so it can carry a
 * thread. Idempotent on `progressKey`.
 */
export interface TaskPromoteInput {
  progressKey: string;
  title: string;
  flow?: string;
  status?: TaskStatus;
  assignees?: number[];
}

/**
 * One entry on a task's timeline.
 *
 * `actor` is `"user"` for the local user or `"employee:<id>"` for an AI
 * employee, so agents can participate in a task's discussion later without a
 * schema change.
 */
export interface TaskEvent {
  id: number;
  taskId: number;
  actor: string;
  kind: TaskEventKind;
  body: string;
  /** Kind-specific payload (e.g. `{ status, closeReason }` for `closed`). */
  meta: Record<string, unknown>;
  createdAt: number;
}

/** Raw DB row (JSON columns unparsed). */
export interface TaskEventRow {
  id: number;
  task_id: number;
  actor: string;
  kind: string;
  body: string;
  meta: string;
  created_at: number;
}

/** Authored timeline entry (discussion / demand / rejection / proposal). */
export interface TaskCommentInput {
  body: string;
  kind?: TaskEventKind;
  actor?: string;
}

/** Feedback primitives on a task (Muse's 赞 / 收藏 / 关注). */
export type TaskReactionKind = "like" | "bookmark" | "follow";

export const TASK_REACTION_KINDS: readonly TaskReactionKind[] = [
  "like",
  "bookmark",
  "follow",
];

/** Reaction rollup for one task: counts plus the local user's own state. */
export interface TaskReactions {
  like: number;
  bookmark: number;
  follow: number;
  liked: boolean;
  bookmarked: boolean;
  following: boolean;
}

export const EMPTY_REACTIONS: TaskReactions = {
  like: 0,
  bookmark: 0,
  follow: 0,
  liked: false,
  bookmarked: false,
  following: false,
};

/** Where a board card comes from. */
export type BoardSource = "task" | "progress";

/** Edge kinds between tasks (only `references` is produced so far). */
export type TaskLinkKind = "references" | "duplicates" | "blocks";

/** A compact pointer to another task (for reference lists). */
export interface TaskRef {
  id: number;
  title: string;
  status: TaskStatus;
}

/** One round-trip payload for the detail view: the task, its timeline, feedback. */
export interface TaskThread {
  task: Task | null;
  events: TaskEvent[];
  reactions: TaskReactions;
  /** Outgoing references (this task mentions them) and incoming ones. */
  references: { out: TaskRef[]; in: TaskRef[] };
}

/**
 * One task board card. `task` cards are the persistent, editable cards;
 * `progress` cards are derived from the assistant's task-progress messages —
 * one card per task, whose steps are the per-employee sub-tasks. A conversation
 * on its own is never a task.
 */
export interface BoardCard {
  /** Stable key: `task:<id>` or `progress:<messageId>`. */
  key: string;
  source: BoardSource;
  refId: number;
  title: string;
  detail: string;
  category: string;
  flow: string;
  status: TaskStatus;
  /** Set only while `status` is `closed` (task cards only). */
  closeReason: TaskCloseReason | null;
  assignees: number[];
  updatedAt: number;
  /** Latest progress steps (progress cards only; for a compact stepper). */
  steps: import("./messages").MessageStep[];
  /** Conversation to open for this card: a root chat, so it is reachable from
   *  the chat list (progress and task cards alike). */
  chatId: number | null;
  /** The task's working group chat, where the assignees actually worked. Used
   *  to open an assignee's session; falls back to `chatId`. */
  workChatId: number | null;
  /** Authored timeline entries (task cards only). */
  commentCount: number;
  /** Feedback rollup (task cards only; chat cards report zeros). */
  reactions: TaskReactions;
  /**
   * Id of the task backing this card's thread. For `task` cards it is `refId`;
   * for `progress` cards it is set once the card has been promoted, and null
   * until then (clicking promotes it).
   */
  threadId: number | null;
  /**
   * Stable promotion key for a `progress` card (`<chatId>:<title>`), unchanged
   * when the assistant re-posts the card. Null for `task` cards.
   */
  progressKey: string | null;
}
