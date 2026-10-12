import type {
  ArchivedTask,
  TaskCommentInput,
  TaskInput,
  TaskPromoteInput,
  TaskReactionKind,
  TaskStatus,
} from "@shared/types";
import { ipcMain } from "electron";
import * as dbTaskThread from "../db/task-thread";
import * as dbTasks from "../db/tasks";
import {
  archiveTask,
  listArchivedTasks,
  unarchiveTask,
} from "../task-archive";
import { listBoardCards } from "../task-board";
import { notifyMentionedEmployees } from "../task-notify";
import { assertInteger, assertString } from "./helpers";

/**
 * Task-center IPC handlers: the board plus the task *thread* (timeline,
 * comments, reactions) and lifecycle transitions (close / reopen).
 */
export function registerTaskHandlers(): void {
  ipcMain.handle("tasks:list", () => dbTasks.listTasks());

  // Board cards = manual tasks + cards derived from real task conversations.
  ipcMain.handle("tasks:board", () => listBoardCards());

  ipcMain.handle("tasks:get", (_event, id: unknown) =>
    dbTasks.getTask(assertInteger(id, "task id")),
  );

  ipcMain.handle("tasks:create", (_event, input: unknown) =>
    dbTasks.createTask(input as TaskInput),
  );

  // Give a progress-derived board card a real task (and thus a thread).
  ipcMain.handle("tasks:promote", (_event, input: unknown) =>
    dbTasks.ensureProgressTask(input as TaskPromoteInput),
  );

  ipcMain.handle("tasks:update", (_event, id: unknown, input: unknown) =>
    dbTasks.updateTask(assertInteger(id, "task id"), input as TaskInput),
  );

  ipcMain.handle("tasks:move", (_event, id: unknown, status: unknown) =>
    dbTasks.moveTask(assertInteger(id, "task id"), status as TaskStatus),
  );

  ipcMain.handle("tasks:delete", (_event, id: unknown) =>
    dbTasks.deleteTask(assertInteger(id, "task id")),
  );

  ipcMain.handle("tasks:timeline", (_event, id: unknown) =>
    dbTaskThread.listTaskEvents(assertInteger(id, "task id")),
  );

  // One round-trip for the detail view: task + timeline + feedback + refs.
  ipcMain.handle("tasks:thread", (_event, id: unknown) => {
    const taskId = assertInteger(id, "task id");
    return {
      task: dbTasks.getTask(taskId),
      events: dbTaskThread.listTaskEvents(taskId),
      reactions: dbTaskThread.getTaskReactions(taskId),
      references: dbTaskThread.taskReferences(taskId),
    };
  });

  ipcMain.handle("tasks:comment", (_event, id: unknown, input: unknown) => {
    const taskId = assertInteger(id, "task id");
    const comment = input as TaskCommentInput;
    const event = dbTaskThread.addTaskComment(taskId, comment);
    dbTasks.touchTask(taskId);
    // An @-mention is delivered for real: post into the task's working chat and
    // wake the mentioned employees there, so somebody actually reads it.
    notifyMentionedEmployees(
      dbTasks.getTask(taskId)?.workChatId ?? null,
      comment.body,
    );
    return event;
  });

  ipcMain.handle(
    "tasks:react",
    (_event, id: unknown, kind: unknown, actor: unknown) => {
      const taskId = assertInteger(id, "task id");
      const reactions = dbTaskThread.toggleTaskReaction(
        taskId,
        kind as TaskReactionKind,
        typeof actor === "string" ? actor : undefined,
      );
      dbTasks.touchTask(taskId);
      return reactions;
    },
  );

  ipcMain.handle("tasks:close", (_event, id: unknown, reason: unknown) =>
    dbTasks.closeTask(assertInteger(id, "task id"), reason),
  );
  ipcMain.handle("tasks:reopen", (_event, id: unknown) =>
    dbTasks.reopenTask(assertInteger(id, "task id")),
  );

  // Restoring a closed card: reopen the promoted task it belonged to.
  ipcMain.handle(
    "tasks:reopenProgress",
    (_event, chatId: unknown, title: unknown) =>
      dbTasks.reopenProgressTask(
        assertInteger(chatId, "chat id"),
        assertString(title, "title"),
      ),
  );

  ipcMain.handle(
    "tasks:comment:delete",
    (_event, id: unknown, eventId: unknown) => {
      const taskId = assertInteger(id, "task id");
      const removed = dbTaskThread.deleteTaskEvent(
        taskId,
        assertInteger(eventId, "event id"),
      );
      if (removed) dbTasks.touchTask(taskId);
      return removed;
    },
  );

  // Manual cross-reference between two tasks (the `#id` path is automatic).
  ipcMain.handle("tasks:link", (_event, fromId: unknown, toId: unknown) => {
    const from = assertInteger(fromId, "task id");
    const to = assertInteger(toId, "task id");
    dbTaskThread.linkTasks(from, to, "references");
    dbTasks.touchTask(from);
    dbTasks.touchTask(to);
    return dbTaskThread.taskReferences(from);
  });

  // Archive: hide a task from the board while keeping it listed.
  ipcMain.handle("tasks:archives", () => listArchivedTasks());

  ipcMain.handle("tasks:archive", (_event, entry: unknown) => {
    const record = entry as Partial<ArchivedTask>;
    return archiveTask({
      key: assertString(record.key, "key"),
      title: assertString(record.title, "title"),
      chatId: typeof record.chatId === "number" ? record.chatId : null,
      workChatId:
        typeof record.workChatId === "number" ? record.workChatId : null,
      archivedAt: Date.now(),
    });
  });

  ipcMain.handle("tasks:unarchive", (_event, key: unknown) =>
    unarchiveTask(assertString(key, "key")),
  );
}
