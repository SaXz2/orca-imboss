import type { CronJob } from "@shared/types";
import { ipcMain } from "electron";
import { getJob } from "../db/cron";
import { removeJob, runJobNow, setJob, setJobEnabled } from "../cron";
import * as dbCron from "../db/cron";
import { assertInteger, assertString } from "./helpers";

export function registerCronHandlers(): void {
  // List an employee's jobs (assistant id 0 included) with chat titles resolved
  // for the Employees detail pane.
  ipcMain.handle("cron:listByEmployee", (_event, employeeId: unknown) => {
    const safeId = assertInteger(employeeId, "employee id");
    if (safeId < 0) throw new Error("employee id must not be negative.");
    return dbCron.listByEmployee(safeId);
  });

  // Every job across all employees: the dock's scheduled-tasks view.
  ipcMain.handle("cron:listAll", () => dbCron.listAll());

  // Edit a job's schedule and content. `id`/chat/employee stay unchanged, so a
  // rename of the task cannot silently move it to another session.
  ipcMain.handle(
    "cron:update",
    (_event, id: unknown, patch: unknown): CronJob | null => {
      const safeId = assertString(id, "cron job id");
      const existing = getJob(safeId);
      if (!existing) return null;
      const record = (patch ?? {}) as {
        schedule?: unknown;
        content?: unknown;
      };
      return setJob({
        id: safeId,
        chatId: existing.chatId,
        employeeId: existing.employeeId,
        schedule:
          typeof record.schedule === "string"
            ? record.schedule
            : existing.schedule,
        content:
          typeof record.content === "string"
            ? record.content
            : existing.content,
      });
    },
  );

  // Enable / disable a job (stops or (re)starts its live scheduler handle).
  ipcMain.handle(
    "cron:setEnabled",
    (_event, id: unknown, enabled: unknown): CronJob | null =>
      setJobEnabled(assertString(id, "cron job id"), enabled === true),
  );

  // Fire a job immediately, as its schedule would have.
  ipcMain.handle("cron:runNow", (_event, id: unknown): CronJob | null =>
    runJobNow(assertString(id, "cron job id")),
  );

  // Remove a job: stops the live Cron handle and deletes the DB row. Returns
  // false when the job does not exist (idempotent from the renderer's view).
  ipcMain.handle("cron:remove", (_event, id: unknown): boolean => {
    const safeId = assertString(id, "cron job id");
    if (safeId.trim().length === 0) {
      throw new Error("cron job id must not be empty.");
    }
    return removeJob(safeId);
  });
}
