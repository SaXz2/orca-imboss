import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ASSISTANT_ID } from "@shared/constants/employees";
import { readChatPrompt } from "@shared/constants/prompts";
import type { ActiveLiveBlock, AgentStreamEvent } from "@shared/types";
import type { WebContents } from "electron";
import * as dbChats from "../db/chats";
import { addEmployeeRuntime } from "../employee-runtime";
import { sendToRenderer } from "../notifications";
import { errorEvent, sendEventTo, toStreamEvent } from "./agent-events";
import { getAgentEnvironment } from "./environment";
import type { AgentSession as AppAgentSession } from "./session";
import { ensureSessionFile } from "./session-files";

/**
 * App-level serialized queue per `{employeeId}/{chatId}`.
 *
 * This is the single serialization point for ALL agent runs. Unlike the old
 * per-message session, the app `AgentSession` wrapper is **persistent per
 * key**: one live Pi session is reused for every message in the queue and is
 * only rebuilt when its composition signature changes (the wrapper checks
 * that on every `prepare()`). It is disposed after a 5-minute idle period.
 *
 * Messages are plain text — no reply is captured or persisted; the agent
 * posts its own output through `imb_*` tools. A failed run is reported to the
 * windows bound to the key as an `error` event and never loses the caller's
 * already-persisted message.
 *
 * This module also owns the session bindings: a renderer window "binds" a
 * `(employee, chat)` key to receive that session's streamed events.
 */

const IDLE_MS = 5 * 60 * 1000;

interface QueueState {
  employeeId: number;
  chatId: number;
  /** App wrapper, persistent across queued messages until idle disposal. */
  session?: AppAgentSession;
  busy: boolean;
  /** Pending message texts, in arrival order. */
  queue: string[];
  idleTimer?: NodeJS.Timeout;
  /** Windows that bound this key (receive its streamed events). */
  boundSenders: Set<WebContents>;
  /** Set by lifecycle teardown so an in-flight drain stops cleanly. */
  disposed: boolean;
  /** Active live blocks of the currently running turn (restores live view). */
  activeBlocks: ActiveLiveBlock[];
}

const states = new Map<string, QueueState>();

/** Run-tracking for the employees dashboard: key → run start timestamp. */
const activeSince = new Map<string, number>();

/** Employee ids currently running an agent turn. */
export function getActiveEmployeeIds(): number[] {
  return [...new Set([...activeSince.keys()].map((k) => Number(k.split("/")[0])))];
}

/** Run start timestamp (ms) for an employee's current run, or null when idle. */
export function getActiveSince(employeeId: number): number | null {
  for (const [key, at] of activeSince) {
    if (Number(key.split("/")[0]) === employeeId) return at;
  }
  return null;
}

/**
 * Chats in which this employee currently has a run in flight.
 *
 * `activeSince` is keyed per `(employee, chat)`, so "is this employee busy?" is
 * a different question from "is this employee busy *on this task*?" — an
 * employee working in another chat must not make this task look active.
 */
export function getActiveChatIds(employeeId: number): Set<number> {
  const chats = new Set<number>();
  for (const key of activeSince.keys()) {
    const [employee, chat] = key.split("/");
    if (Number(employee) === employeeId) chats.add(Number(chat));
  }
  return chats;
}

/** Notify renderers that agent activity (busy/idle) changed. */
function notifyActivity(): void {
  try {
    sendToRenderer("agents:activity", {});
  } catch {
    // Best-effort: activity notifications must never break a run.
  }
}

/**
 * Schedule a message for an agent session, serialized per (employee, chat).
 *
 * Returns immediately (fire-and-forget): if a run for the key is already in
 * flight the message is queued, otherwise a run is started and the queue is
 * drained in order.
 */
export async function deliver(
  employeeId: number,
  chatId: number,
  text: string,
): Promise<void> {
  const state = getOrCreateState(employeeId, chatId);
  clearIdleTimer(state);
  state.queue.push(text);
  if (state.busy) return;
  state.busy = true;
  const key = keyFor(employeeId, chatId);
  if (!activeSince.has(key)) activeSince.set(key, Date.now());
  notifyActivity();
  void drain(state);
}

/**
 * Wake an employee's session for a chat. The assistant deliberately has no
 * session in task group chats: it is woken in its root-chat session instead,
 * with a prompt that names the group chat to read.
 */
export async function wakeAgent(
  employeeId: number,
  chatId: number,
  fallbackText: string,
): Promise<void> {
  // Guard: a cron tick can race with chat deletion. If the chat is already
  // gone, drop the wake instead of materializing an orphan session for it.
  if (!dbChats.getChat(chatId)) return;
  let targetChatId = chatId;
  let text = fallbackText;
  if (employeeId === ASSISTANT_ID) {
    const rootId = dbChats.getRootChatId(chatId);
    if (rootId !== chatId) {
      targetChatId = rootId;
      text = readChatPrompt(chatId);
    }
  }
  await ensureSessionFile(employeeId, targetChatId);
  await deliver(employeeId, targetChatId, text);
}

/**
 * Register a renderer window to receive a key's streamed events.
 *
 * The agent session is NOT built here: it is created lazily by `deliver()`
 * (via `ensureSession`) on the first message. Selecting a chat is therefore
 * cheap, and a run already in flight (cron / other entries) is still observed
 * because events are forwarded to `boundSenders`, independent of whether this
 * call created the session.
 */
export function bind(
  employeeId: number,
  chatId: number,
  sender: WebContents,
): ActiveLiveBlock[] {
  const state = getOrCreateState(employeeId, chatId);
  clearIdleTimer(state);
  if (!state.boundSenders.has(sender)) {
    state.boundSenders.add(sender);
    const onDestroyed = (): void => {
      sender.removeListener("destroyed", onDestroyed);
      unbind(employeeId, chatId, sender);
    };
    sender.once("destroyed", onDestroyed);
  }
  return state.activeBlocks
    ? state.activeBlocks.filter(Boolean).map((b) => ({ ...b }))
    : [];
}

/** Remove a window's binding; drop the entry once fully idle. */
export function unbind(
  employeeId: number,
  chatId: number,
  sender: WebContents,
): void {
  const key = keyFor(employeeId, chatId);
  const state = states.get(key);
  if (!state) return;
  state.boundSenders.delete(sender);
  if (state.boundSenders.size > 0 || state.busy || state.disposed) return;
  if (state.session) {
    scheduleIdleDispose(state);
  } else if (state.queue.length === 0) {
    states.delete(key);
  }
}

/** Dispose every session for one chat (chat deleted). */
export async function disposeForChat(chatId: number): Promise<void> {
  await disposeMatching((state) => state.chatId === chatId);
}

/** Abort active and queued runs for a specific session. */
export async function abortRun(
  employeeId: number,
  chatId: number,
): Promise<void> {
  const key = keyFor(employeeId, chatId);
  const state = states.get(key);
  if (!state) return;
  state.queue = [];
  state.activeBlocks = [];
  if (state.session) {
    await state.session.abort();
  }
}

/** Abort all active and queued agent runs belonging to a chat. */
export async function abortChat(chatId: number): Promise<void> {
  const matching = [...states.values()].filter((s) => s.chatId === chatId);
  for (const state of matching) {
    state.queue = [];
    state.activeBlocks = [];
    if (state.session) {
      await state.session.abort();
    }
  }
}

/** Dispose every session for one employee (employee deleted). */
export async function disposeForEmployee(employeeId: number): Promise<void> {
  await disposeMatching((state) => state.employeeId === employeeId);
}

/** Dispose every session (app quit). */
export async function disposeAll(): Promise<void> {
  await disposeMatching(() => true);
}

async function drain(state: QueueState): Promise<void> {
  try {
    while (!state.disposed) {
      const text = state.queue.shift();
      if (text === undefined) break;
      try {
        await ensureSession(state);
        if (state.disposed) {
          await disposeSessionOf(state);
          break;
        }
        await state.session?.prompt(text);
      } catch (err) {
        emitError(state, err);
      }
    }
  } finally {
    state.busy = false;
    if (state.disposed) return;
    if (state.queue.length > 0) {
      state.busy = true;
      void drain(state);
    } else {
      scheduleIdleDispose(state);
      // The busy episode ended: record its run time for the dashboard (工時).
      const key = keyFor(state.employeeId, state.chatId);
      const started = activeSince.get(key);
      if (started !== undefined) {
        addEmployeeRuntime(state.employeeId, Date.now() - started);
        activeSince.delete(key);
        notifyActivity();
      }
    }
  }
}

/**
 * Ensure the wrapper exists and is prepared. The wrapper itself compares the
 * composition signature and rebuilds only when needed.
 */
async function ensureSession(state: QueueState): Promise<void> {
  if (state.disposed) {
    throw new Error("Agent session state has been disposed.");
  }
  // Persist the (employee, chat) session file before building the Pi session,
  // so even a root chat (assistant ↔ user) resumes from disk instead of
  // starting in-memory. Idempotent: a recorded row is a no-op.
  await ensureSessionFile(state.employeeId, state.chatId);
  if (!state.session) {
    // Lazy import avoids a module-load cycle (session.ts imports builtin-tools,
    // which imports this module).
    const { AgentSession } = await import("./session");
    const env = getAgentEnvironment();
    state.session = new AgentSession(
      env,
      { employeeId: state.employeeId, chatId: state.chatId },
      (event) => forwardEvent(state, event),
    );
  }
  await state.session.prepare();
}

async function disposeMatching(
  predicate: (state: QueueState) => boolean,
): Promise<void> {
  const matching = [...states.values()].filter(predicate);
  await Promise.all(matching.map((state) => disposeState(state, true)));
}

function getOrCreateState(employeeId: number, chatId: number): QueueState {
  const key = keyFor(employeeId, chatId);
  let state = states.get(key);
  if (!state) {
    state = {
      employeeId,
      chatId,
      busy: false,
      queue: [],
      boundSenders: new Set(),
      disposed: false,
      activeBlocks: [],
    };
    states.set(key, state);
  }
  return state;
}

function keyFor(employeeId: number, chatId: number): string {
  return `${employeeId}/${chatId}`;
}

function clearIdleTimer(state: QueueState): void {
  if (state.idleTimer !== undefined) {
    clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
  }
}

function scheduleIdleDispose(state: QueueState): void {
  if (state.disposed) return;
  clearIdleTimer(state);
  state.idleTimer = setTimeout(() => {
    state.idleTimer = undefined;
    void disposeState(state, false);
  }, IDLE_MS);
}

/**
 * Tear down the state's session. `forceRemove` marks the state disposed and
 * drops it from the registry (lifecycle teardown); otherwise the entry is
 * removed only when nothing is bound and the queue is empty.
 */
async function disposeState(
  state: QueueState,
  forceRemove: boolean,
): Promise<void> {
  clearIdleTimer(state);
  if (forceRemove) {
    state.disposed = true;
    states.delete(keyFor(state.employeeId, state.chatId));
  }

  await disposeSessionOf(state);

  if (state.disposed || state.busy) return;
  if (state.queue.length > 0) {
    state.busy = true;
    void drain(state);
    return;
  }
  if (state.boundSenders.size === 0) {
    states.delete(keyFor(state.employeeId, state.chatId));
  }
}

/** Dispose the wrapper (if any) and clear the reference; never throws. */
async function disposeSessionOf(state: QueueState): Promise<void> {
  const session = state.session;
  state.session = undefined;
  if (!session) return;
  try {
    await session.dispose();
  } catch (err) {
    console.error(
      `[session-queue] failed to dispose session for ${state.employeeId} in chat ${state.chatId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/** Forward a raw Pi event to this key's bound windows (whitelisted DTOs). */
function forwardEvent(state: QueueState, event: AgentSessionEvent): void {
  const dto = toStreamEvent(event);
  if (dto) {
    updateActiveSnapshot(state, dto);
    sendEventTo(state.boundSenders, state.employeeId, state.chatId, dto);
  }
}

/** Update in-memory active blocks for mid-turn window restores. */
function updateActiveSnapshot(
  state: QueueState,
  event: AgentStreamEvent,
): void {
  switch (event.type) {
    case "message_update": {
      const index = event.contentIndex ?? 0;
      let block = state.activeBlocks[index];
      switch (event.subType) {
        case "thinking_start":
          state.activeBlocks[index] = {
            key: `active:${index}`,
            kind: "thinking",
            text: "",
          };
          break;
        case "thinking_delta":
          if (!block || block.kind !== "thinking") {
            block = { key: `active:${index}`, kind: "thinking", text: "" };
            state.activeBlocks[index] = block;
          }
          block.text += event.delta ?? "";
          break;
        case "thinking_end":
          if (block && block.kind === "thinking") {
            block.done = true;
          }
          break;
        case "text_start":
          state.activeBlocks[index] = {
            key: `active:${index}`,
            kind: "text",
            text: "",
          };
          break;
        case "text_delta":
          if (!block || block.kind !== "text") {
            block = { key: `active:${index}`, kind: "text", text: "" };
            state.activeBlocks[index] = block;
          }
          block.text += event.delta ?? "";
          break;
        case "toolcall_start":
          state.activeBlocks[index] = {
            key: `active:${index}`,
            kind: "tool",
            text: "",
            status: "running",
          };
          break;
        case "toolcall_end":
          if (!block || block.kind !== "tool") {
            block = {
              key: `active:${index}`,
              kind: "tool",
              text: "",
              status: "running",
            };
            state.activeBlocks[index] = block;
          }
          if (event.toolCallId !== undefined) block.toolCallId = event.toolCallId;
          if (event.toolName !== undefined) block.name = event.toolName;
          if (event.toolArgsSummary !== undefined) {
            block.argsSummary = event.toolArgsSummary;
          }
          if (event.toolArgsDetail !== undefined) {
            block.argsDetail = event.toolArgsDetail;
          }
          block.status = "running";
          break;
        default:
          break;
      }
      break;
    }
    case "tool_execution_start": {
      const block = state.activeBlocks.find(
        (b) => b && b.kind === "tool" && b.toolCallId === event.toolCallId,
      );
      if (block) {
        block.status = "running";
        if (event.toolName && !block.name) block.name = event.toolName;
      }
      break;
    }
    case "tool_execution_end": {
      const block = state.activeBlocks.find(
        (b) => b && b.kind === "tool" && b.toolCallId === event.toolCallId,
      );
      if (block) {
        block.status = event.isError ? "error" : "ok";
      }
      break;
    }
    case "agent_start":
      state.activeBlocks = [];
      break;
    case "agent_end":
    case "message_end":
    case "error":
      state.activeBlocks = [];
      break;
    default:
      break;
  }
}

/** Report a failed run to the bound windows and the log. */
function emitError(state: QueueState, err: unknown): void {
  console.error(
    `[session-queue] run for ${state.employeeId} in chat ${state.chatId} failed:`,
    err instanceof Error ? err.message : err,
  );
  sendEventTo(
    state.boundSenders,
    state.employeeId,
    state.chatId,
    errorEvent(err),
  );
}
