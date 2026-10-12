import { t } from "@shared/l10n";
import {
  EMPTY_REACTIONS,
  type BoardCard,
  type MessageStep,
  type TaskStatus,
} from "@shared/types";
import { getActiveSince } from "./agent/session-queue";
import { getDB } from "./db";
import * as dbEmployees from "./db/employees";
import { parseJsonObject } from "./db/json";
import { authoredCounts, reactionsFor } from "./db/task-thread";
import { ensureProgressTask, listManualTasks } from "./db/tasks";
import { listArchivedTasks } from "./task-archive";

/**
 * Task Center board composition.
 *
 * Merges two sources into one board so it reflects the company's real work:
 * - persistent, editable `task` cards (the `tasks` table);
 * - `progress` cards derived from the assistant's task-progress messages: one
 *   card per task, whose steps are the per-employee sub-tasks ("清子 assigned
 *   this to 陆子衡 and 崔敏行"). A conversation is never a task by itself.
 */

function parseSteps(raw: string | null | undefined): MessageStep[] {
  const obj = parseJsonObject(raw ?? undefined);
  const steps = obj["steps"];
  if (!Array.isArray(steps)) return [];
  const out: MessageStep[] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const record = step as Record<string, unknown>;
    const status = record["status"];
    if (
      typeof record["name"] !== "string" ||
      (status !== "done" && status !== "busy" && status !== "pending" &&
        status !== "interrupted")
    ) {
      continue;
    }
    out.push({
      ...(typeof record["employeeId"] === "number"
        ? { employeeId: record["employeeId"] }
        : {}),
      name: record["name"],
      role: typeof record["role"] === "string" ? record["role"] : "",
      status,
    });
  }
  return out;
}

/** A chat's status follows its latest progress card. */
function statusFromSteps(steps: MessageStep[]): TaskStatus {
  if (steps.length === 0) return "pending";
  if (steps.some((s) => s.status === "busy")) return "running";
  if (steps.every((s) => s.status === "done")) return "done";
  return "pending";
}

interface ProgressRow {
  id: number;
  chat_id: number;
  content: string | null;
  steps: string | null;
  created_at: number;
}

export function listBoardCards(): BoardCard[] {
  const cards: BoardCard[] = [];

  const tasks = listManualTasks();

  for (const task of tasks) {
    cards.push({
      key: `task:${task.id}`,
      source: "task",
      refId: task.id,
      title: task.title,
      detail: task.detail,
      category: task.category,
      flow: task.flow,
      status: task.status,
      closeReason: task.closeReason,
      assignees: task.assignees,
      updatedAt: task.updatedAt,
      steps: [],
      chatId: null,
      workChatId: null,
      commentCount: 0,
      reactions: { ...EMPTY_REACTIONS },
      threadId: task.id,
      progressKey: null,
    });
  }

  // Each progress card the assistant posts is one task; its steps are the
  // per-employee sub-tasks. The assistant re-posts a card as work advances, so
  // only the newest card per (chat, title) is kept — otherwise one task would
  // show up several times. Live session activity overlays the stored status so
  // the board reflects what is actually running right now.
  const rows = getDB()
    .prepare(
      `SELECT id, chat_id, content, steps, created_at
         FROM messages
        WHERE kind = 'progress'
        ORDER BY id DESC
        LIMIT 400`,
    )
    .all() as ProgressRow[];

  const people = dbEmployees.listEmployees();
  const archived = new Set(listArchivedTasks().map((entry) => entry.key));
  const seen = new Set<string>();

  for (const row of rows) {
    const steps = parseSteps(row.steps);
    const title = (row.content ?? "").trim();
    if (title.length === 0 && steps.length === 0) continue;

    // Newest card wins for a given task in a given conversation.
    const groupKey = `${row.chat_id}\u0000${title}`;
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);

    // Archived tasks are hidden from the board (they live in the archive view).
    if (archived.has(`progress:${row.id}`)) continue;

    // Owner names may arrive without an id (older cards); resolve them once so
    // the board, the steps view and the per-employee tallies all agree.
    const owned = steps.map((step) => {
      if (step.employeeId !== undefined) return step;
      const person = people.find(
        (candidate) =>
          (candidate.name && candidate.name.trim() === step.name.trim()) ||
          (candidate.role && candidate.role.trim() === step.role.trim()),
      );
      return person ? { ...step, employeeId: person.id } : step;
    });

    const assignees = [
      ...new Set(
        owned
          .map((step) => step.employeeId)
          .filter((id): id is number => typeof id === "number"),
      ),
    ];
    const live = owned.some(
      (step) =>
        step.employeeId !== undefined &&
        getActiveSince(step.employeeId) !== null,
    );

    // Every card owns a real task, materialised here, so it can carry a thread
    // (discussion, feedback, references, close) without the view having to
    // create one first. The key is stable across the assistant's re-posts.
    const progressKey = `${row.chat_id}:${title}`;
    const flow = owned.map((step) => step.name).join(" → ");
    const derived = live ? "running" : statusFromSteps(owned);
    const workChatId = taskGroupChatId(row.chat_id, row.id) ?? row.chat_id;
    const task = ensureProgressTask({
      progressKey,
      title: title || t("Untitled"),
      flow,
      status: derived,
      assignees,
      workChatId,
    });
    const closed = task.status === "closed";

    cards.push({
      key: `progress:${row.id}`,
      source: "progress",
      refId: row.id,
      title: title || t("Untitled"),
      detail: task.detail,
      category: task.category,
      flow: task.flow || flow,
      status: closed ? "closed" : derived,
      closeReason: closed ? task.closeReason : null,
      assignees,
      updatedAt: row.created_at,
      steps: owned,
      chatId: row.chat_id,
      workChatId,
      commentCount: 0,
      reactions: { ...EMPTY_REACTIONS },
      progressKey,
      threadId: task.id,
    });
  }

  // Thread rollups for every card that has (or can have) a thread.
  const threadIds = cards
    .map((card) => card.threadId)
    .filter((id): id is number => id !== null);
  const counts = authoredCounts(threadIds);
  const reactions = reactionsFor(threadIds);
  for (const card of cards) {
    if (card.threadId === null) continue;
    card.commentCount = counts.get(card.threadId) ?? 0;
    card.reactions = reactions.get(card.threadId) ?? { ...EMPTY_REACTIONS };
  }

  return cards.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The task group chat a progress card belongs to. The assistant posts a
 * `chat`-kind card into the root chat right before it starts a task, whose
 * content is the id of the group chat it just created; that group is where the
 * assignees actually work, so it is the chat an assignee's session lives in.
 */
function taskGroupChatId(rootChatId: number, beforeMessageId: number): number | null {
  const row = getDB()
    .prepare(
      `SELECT content FROM messages
        WHERE chat_id = ? AND kind = 'chat' AND id < ?
        ORDER BY id DESC LIMIT 1`,
    )
    .get(rootChatId, beforeMessageId) as { content: string } | undefined;
  const id = Number.parseInt((row?.content ?? "").trim(), 10);
  if (!Number.isSafeInteger(id)) return null;
  const chat = getDB()
    .prepare("SELECT from_chat_id FROM chats WHERE id = ?")
    .get(id) as { from_chat_id: number | null } | undefined;
  return chat && chat.from_chat_id === rootChatId ? id : null;
}

/** Per-employee task counts by board column (GitHub-style state summary). */
export interface EmployeeTaskCounts {
  pending: number;
  running: number;
  done: number;
  closed: number;
}

export function employeeTaskCounts(): Map<number, EmployeeTaskCounts> {
  const map = new Map<number, EmployeeTaskCounts>();
  for (const card of listBoardCards()) {
    // Closed cards are archived, not workload — leave them out of the summary.
    if (card.status === "closed") continue;
    for (const id of card.assignees) {
      let entry = map.get(id);
      if (!entry) {
        entry = { pending: 0, running: 0, done: 0, closed: 0 };
        map.set(id, entry);
      }
      entry[card.status] += 1;
    }
  }
  return map;
}
