import type { TaskInput, TaskStatus } from "@shared/types";
import { ipcMain } from "electron";
import * as dbTasks from "../db/tasks";
import { listBoardCards } from "../task-board";
import { assertInteger } from "./helpers";

/** Task-center (kanban board) IPC handlers. */
export function registerTaskHandlers(): void {
  ipcMain.handle("tasks:list", () => dbTasks.listTasks());

  // Board cards = manual tasks + cards derived from real task conversations.
  ipcMain.handle("tasks:board", () => listBoardCards());

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
}
