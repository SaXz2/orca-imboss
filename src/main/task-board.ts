import { t } from "@shared/l10n";
import {
  EMPTY_REACTIONS,
  type BoardCard,
  type MessageStep,
  type TaskStatus,
} from "@shared/types";
import { getDB } from "./db";
import { parseJsonObject, parseNumberArray } from "./db/json";
import { authoredCounts, reactionsFor } from "./db/task-thread";
import { listTasks } from "./db/tasks";

/**
 * Task Center board composition.
 *
 * Merges two sources into one board so it reflects the company's real work:
 * - persistent, editable `task` cards (the `tasks` table);
 * - `chat` cards derived from actual task conversations (assistant-created
 *   group chats and bridged platform chats), read-only, opening the chat.
 */

/** Display label per integration platform (falls back to the raw id). */
const PLATFORM_LABELS: Record<string, string> = {
  wechat: "WeChat",
  qq: "QQ",
  telegram: "Telegram",
};

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

interface ChatTaskRow {
  id: number;
  title: string;
  participants: string | null;
  last_message_at: number;
  source: string | null;
  p_content: string | null;
  p_steps: string | null;
}

export function listBoardCards(): BoardCard[] {
  const cards: BoardCard[] = [];

  const tasks = listTasks();
  const taskIds = tasks.map((task) => task.id);
  const counts = authoredCounts(taskIds);
  const reactions = reactionsFor(taskIds);

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
      commentCount: counts.get(task.id) ?? 0,
      reactions: reactions.get(task.id) ?? { ...EMPTY_REACTIONS },
    });
  }

  const rows = getDB()
    .prepare(
      `SELECT c.id, c.title, c.participants, c.last_message_at, c.source,
              (SELECT content FROM messages
                 WHERE chat_id = c.id AND kind = 'progress'
                 ORDER BY id DESC LIMIT 1) AS p_content,
              (SELECT steps FROM messages
                 WHERE chat_id = c.id AND kind = 'progress'
                 ORDER BY id DESC LIMIT 1) AS p_steps
         FROM chats c
        WHERE c.from_chat_id IS NOT NULL OR c.source IS NOT NULL
        ORDER BY c.last_message_at DESC`,
    )
    .all() as ChatTaskRow[];

  for (const row of rows) {
    const steps = parseSteps(row.p_steps);
    const title = row.title.trim() || (row.p_content ?? "").trim();
    if (title.length === 0 && steps.length === 0) continue; // nothing to show yet
    cards.push({
      key: `chat:${row.id}`,
      source: "chat",
      refId: row.id,
      title: title || t("Untitled"),
      detail: "",
      category: row.source
        ? t(PLATFORM_LABELS[row.source] ?? row.source)
        : t("Group"),
      flow: steps.map((s) => s.name).join(" → "),
      status: statusFromSteps(steps),
      closeReason: null,
      assignees: parseNumberArray(row.participants).filter((id) => id !== 0),
      updatedAt: row.last_message_at,
      steps,
      chatId: row.id,
      commentCount: 0,
      reactions: { ...EMPTY_REACTIONS },
    });
  }

  return cards.sort((a, b) => b.updatedAt - a.updatedAt);
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
