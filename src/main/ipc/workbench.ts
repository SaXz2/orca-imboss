import { ipcMain } from "electron";
import {
  listWorkbenchDir,
  readWorkbenchFile,
  workbenchRoot,
} from "../workbench";
import { assertString } from "./helpers";

/** Right-dock workbench: the agents' working folder, browsed read-only. */
export function registerWorkbenchHandlers(): void {
  ipcMain.handle("workbench:root", () => workbenchRoot());

  ipcMain.handle("workbench:list", (_event, path: unknown) =>
    listWorkbenchDir(typeof path === "string" ? path : ""),
  );

  ipcMain.handle("workbench:read", (_event, path: unknown) =>
    readWorkbenchFile(assertString(path, "path")),
  );
}
