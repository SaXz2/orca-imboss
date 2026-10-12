import type {
  Department,
  DepartmentEdge,
  DepartmentEdgeInput,
  DepartmentEdgeMove,
  DepartmentGraph,
  DepartmentInput,
  DepartmentLayout,
  EmployeeLink,
  EmployeeLinkInput,
  LinkPatch,
} from "@shared/types";
import { ipcMain } from "electron";
import * as dbDepartments from "../db/departments";
import { sendToRenderer } from "../notifications";
import { assertInteger } from "./helpers";

/** Tell the renderer the canvas changed (agent tools mutate it out of band). */
function notifyDepartmentsChanged(): void {
  sendToRenderer("departments:changed", {});
}

export function registerDepartmentHandlers(): void {
  ipcMain.handle("departments:graph", (): DepartmentGraph =>
    dbDepartments.getGraph(),
  );

  ipcMain.handle(
    "departments:create",
    (_event, input: DepartmentInput | undefined): Department => {
      const department = dbDepartments.createDepartment(input ?? {});
      notifyDepartmentsChanged();
      return department;
    },
  );

  ipcMain.handle(
    "departments:update",
    (_event, id: unknown, input: DepartmentInput): Department | null => {
      const department = dbDepartments.updateDepartment(
        assertInteger(id, "department id"),
        input ?? {},
      );
      notifyDepartmentsChanged();
      return department;
    },
  );

  ipcMain.handle("departments:delete", (_event, id: unknown): boolean => {
    const removed = dbDepartments.deleteDepartment(
      assertInteger(id, "department id"),
    );
    if (removed) notifyDepartmentsChanged();
    return removed;
  });

  // Drag/resize commits a whole batch at once; no per-tile notify (the renderer
  // already holds the new positions optimistically).
  ipcMain.handle(
    "departments:setLayout",
    (_event, layouts: DepartmentLayout[]): void => {
      dbDepartments.setLayout(Array.isArray(layouts) ? layouts : []);
    },
  );

  ipcMain.handle(
    "departments:addMember",
    (
      _event,
      departmentId: unknown,
      employeeId: unknown,
      roleInDept: unknown,
      isLead: unknown,
      reportsTo: unknown,
    ): Department | null => {
      const department = dbDepartments.addMember(
        assertInteger(departmentId, "department id"),
        assertInteger(employeeId, "employee id"),
        typeof roleInDept === "string" ? roleInDept : "",
        isLead === true,
        reportsTo == null ? null : assertInteger(reportsTo, "reportsTo"),
      );
      notifyDepartmentsChanged();
      return department;
    },
  );

  ipcMain.handle(
    "departments:removeMember",
    (_event, departmentId: unknown, employeeId: unknown): Department | null => {
      const department = dbDepartments.removeMember(
        assertInteger(departmentId, "department id"),
        assertInteger(employeeId, "employee id"),
      );
      notifyDepartmentsChanged();
      return department;
    },
  );

  ipcMain.handle(
    "departments:setMemberParent",
    (
      _event,
      departmentId: unknown,
      employeeId: unknown,
      parentEmployeeId: unknown,
    ): Department | null => {
      const department = dbDepartments.setMemberParent(
        assertInteger(departmentId, "department id"),
        assertInteger(employeeId, "employee id"),
        parentEmployeeId == null
          ? null
          : assertInteger(parentEmployeeId, "parent employee id"),
      );
      notifyDepartmentsChanged();
      return department;
    },
  );

  ipcMain.handle(
    "departments:addPersonLink",
    (_event, input: EmployeeLinkInput): EmployeeLink => {
      const link = dbDepartments.addEmployeeLink({
        fromEmployeeId: assertInteger(input?.fromEmployeeId, "fromEmployeeId"),
        toEmployeeId: assertInteger(input?.toEmployeeId, "toEmployeeId"),
        label: typeof input?.label === "string" ? input.label : undefined,
        kind: input?.kind,
      });
      notifyDepartmentsChanged();
      return link;
    },
  );

  ipcMain.handle(
    "departments:updatePersonLink",
    (_event, id: unknown, patch: LinkPatch): EmployeeLink | null => {
      const link = dbDepartments.updateEmployeeLink(
        assertInteger(id, "link id"),
        patch ?? {},
      );
      if (link) notifyDepartmentsChanged();
      return link;
    },
  );

  ipcMain.handle(
    "departments:removePersonLink",
    (_event, id: unknown): boolean => {
      const removed = dbDepartments.removeEmployeeLink(
        assertInteger(id, "link id"),
      );
      if (removed) notifyDepartmentsChanged();
      return removed;
    },
  );

  ipcMain.handle(
    "departments:addEdge",
    (_event, input: DepartmentEdgeInput): DepartmentEdge => {
      const edge = dbDepartments.addEdge({
        fromDeptId: assertInteger(input?.fromDeptId, "fromDeptId"),
        toDeptId: assertInteger(input?.toDeptId, "toDeptId"),
        label: typeof input?.label === "string" ? input.label : undefined,
        kind: input?.kind,
        fromSide: input?.fromSide ?? null,
        toSide: input?.toSide ?? null,
      });
      notifyDepartmentsChanged();
      return edge;
    },
  );

  ipcMain.handle(
    "departments:updateEdge",
    (_event, id: unknown, patch: LinkPatch): DepartmentEdge | null => {
      const edge = dbDepartments.updateEdge(
        assertInteger(id, "edge id"),
        patch ?? {},
      );
      if (edge) notifyDepartmentsChanged();
      return edge;
    },
  );

  ipcMain.handle("departments:removeEdge", (_event, id: unknown): boolean => {
    const removed = dbDepartments.removeEdge(assertInteger(id, "edge id"));
    if (removed) notifyDepartmentsChanged();
    return removed;
  });

  ipcMain.handle(
    "departments:moveEdge",
    (_event, id: unknown, input: DepartmentEdgeMove): DepartmentEdge | null => {
      const edge = dbDepartments.moveEdge(
        assertInteger(id, "edge id"),
        assertInteger(input?.fromDeptId, "fromDeptId"),
        assertInteger(input?.toDeptId, "toDeptId"),
        input?.fromSide ?? null,
        input?.toSide ?? null,
      );
      notifyDepartmentsChanged();
      return edge;
    },
  );

  ipcMain.handle(
    "departments:movePersonLink",
    (
      _event,
      id: unknown,
      input: { fromEmployeeId?: unknown; toEmployeeId?: unknown },
    ): EmployeeLink | null => {
      const link = dbDepartments.moveEmployeeLink(
        assertInteger(id, "link id"),
        assertInteger(input?.fromEmployeeId, "fromEmployeeId"),
        assertInteger(input?.toEmployeeId, "toEmployeeId"),
      );
      notifyDepartmentsChanged();
      return link;
    },
  );
}
