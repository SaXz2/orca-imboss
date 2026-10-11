import type {
  TaskCommentInput,
  TaskInput,
  TaskReactionKind,
  TaskStatus,
} from "@shared/types";
import { ipcMain } from "electron";
import * as dbTaskThread from "../db/task-thread";
import * as dbTasks from "../db/tasks";
import { listBoardCards } from "../task-board";
import { assertInteger } from "./helpers";

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

  ipcMain.handle("tasks:comment", (_event, id: unknown, input: unknown) => {
    const taskId = assertInteger(id, "task id");
    const event = dbTaskThread.addTaskComment(taskId, input as TaskCommentInput);
    dbTasks.touchTask(taskId);
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
}
