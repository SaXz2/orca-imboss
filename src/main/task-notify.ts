import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { wakeAgent } from "./agent/session-queue";
import { getEmployee } from "./db/employees";
import { appendMessage } from "./db/messages";

/**
 * Deliver a task comment to the employees it @-mentions.
 *
 * A task's discussion is a separate timeline from any chat, so an @-mention in
 * it would otherwise be decoration: nobody would read it. This posts the
 * comment into the task's working chat and wakes each mentioned employee there,
 * which is exactly the mechanism the assistant uses to assign work — so the
 * mention becomes a real instruction and the employee's answer lands where the
 * work is recorded.
 */

/** Employee ids @-mentioned as `@<工牌号>` in a body of text. */
export function parseMentionedEmployees(body: string): number[] {
  const ids = new Set<number>();
  for (const match of body.matchAll(/@(\d+)(?![\d])/g)) {
    const id = Number(match[1]);
    if (Number.isSafeInteger(id) && id >= 0) ids.add(id);
  }
  return [...ids];
}

/**
 * Post `body` into `chatId` and wake every employee it mentions. Returns the
 * employee ids that were actually woken (empty when nobody was mentioned or the
 * target chat is unknown).
 */
export function notifyMentionedEmployees(
  chatId: number | null,
  body: string,
): number[] {
  if (chatId === null) return [];
  const ids = parseMentionedEmployees(body);
  if (ids.length === 0) return [];
  const woken = ids.filter((id) => {
    const employee = getEmployee(id);
    return employee !== null && !employee.disabled;
  });
  if (woken.length === 0) return [];
  // One message from the boss, then wake each addressee to read it.
  appendMessage(chatId, null, body, { kind: "text" });
  for (const id of woken) {
    void wakeAgent(id, chatId, READ_CHAT_PROMPT);
  }
  return woken;
}
