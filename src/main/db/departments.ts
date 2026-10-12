import type {
  Department,
  DepartmentEdge,
  DepartmentEdgeInput,
  DepartmentGraph,
  DepartmentInput,
  DepartmentKind,
  DepartmentLayout,
  DepartmentMember,
  DepartmentMembershipInput,
  DepartmentUpsertInput,
  EmployeeLink,
  EmployeeLinkInput,
  LinkKind,
  LinkPatch,
  LinkSide,
} from "@shared/types";
import { getDB } from "./index";

/** Row shapes as stored (snake_case columns). */
interface DepartmentRow {
  id: number;
  name: string;
  kind: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sort_order: number;
}

interface DepartmentMemberRow {
  department_id: number;
  employee_id: number;
  role_in_dept: string;
  is_lead: number;
  reports_to: number | null;
}

interface EmployeeLinkRow {
  id: number;
  from_employee_id: number;
  to_employee_id: number;
  label: string;
  kind: string;
}

interface DepartmentEdgeRow {
  id: number;
  from_dept_id: number;
  to_dept_id: number;
  label: string;
  kind: string;
  from_side: string | null;
  to_side: string | null;
}

const MAX_NAME = 200;
const MAX_LABEL = 120;
const MAX_ROLE = 200;
const MIN_W = 200;
const MIN_H = 140;
const MAX_LAYOUT = 100_000;
const MAX_BATCH = 100;

/**
 * The whole canvas: every department (with its members) plus every link.
 * Members are joined against `employees` so soft-deleted staff drop out
 * silently instead of leaving dangling nodes on the canvas.
 */
export function getGraph(): DepartmentGraph {
  const db = getDB();
  const deptRows = db
    .prepare("SELECT * FROM departments ORDER BY sort_order ASC, id ASC")
    .all() as DepartmentRow[];
  const memberRows = db
    .prepare(
      `SELECT m.department_id, m.employee_id, m.role_in_dept, m.is_lead, m.reports_to
         FROM department_members m
         JOIN employees e ON e.id = m.employee_id
        WHERE e.disabled = 0`,
    )
    .all() as DepartmentMemberRow[];
  const edgeRows = db
    .prepare("SELECT * FROM department_edges ORDER BY id ASC")
    .all() as DepartmentEdgeRow[];
  const linkRows = db
    .prepare("SELECT * FROM employee_links ORDER BY id ASC")
    .all() as EmployeeLinkRow[];

  const byDept = new Map<number, DepartmentMember[]>();
  for (const row of memberRows) {
    const list = byDept.get(row.department_id) ?? [];
    list.push({
      employeeId: row.employee_id,
      roleInDept: row.role_in_dept ?? "",
      isLead: row.is_lead === 1,
      reportsTo: row.reports_to ?? null,
    });
    byDept.set(row.department_id, list);
  }

  return {
    departments: deptRows.map((row) => ({
      ...toCore(row),
      members: sortMembers(byDept.get(row.id) ?? []),
    })),
    edges: edgeRows.map(toEdge),
    personLinks: linkRows.map(toLink),
  };
}

export function getDepartment(id: number): Department | null {
  const graph = getGraph();
  return graph.departments.find((d) => d.id === id) ?? null;
}

export function createDepartment(input: DepartmentInput): Department {
  const db = getDB();
  const max = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS m FROM departments")
    .get() as { m: number };
  const result = db
    .prepare(
      "INSERT INTO departments (name, kind, color, x, y, w, h, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      validateName(input.name) ?? "",
      validateKind(input.kind) ?? "team",
      validateColor(input.color) ?? "",
      validateCoord(input.x) ?? 0,
      validateCoord(input.y) ?? 0,
      validateSize(input.w, MIN_W) ?? 320,
      validateSize(input.h, MIN_H) ?? 240,
      max.m + 1,
    );
  const created = getDepartment(Number(result.lastInsertRowid));
  if (!created) throw new Error("Failed to create department.");
  return created;
}

export function updateDepartment(
  id: number,
  input: DepartmentInput,
): Department | null {
  const current = getDepartment(id);
  if (!current) return null;
  const db = getDB();
  db.prepare(
    "UPDATE departments SET name = ?, kind = ?, color = ?, x = ?, y = ?, w = ?, h = ? WHERE id = ?",
  ).run(
    input.name !== undefined ? (validateName(input.name) ?? "") : current.name,
    input.kind !== undefined
      ? (validateKind(input.kind) ?? current.kind)
      : current.kind,
    input.color !== undefined
      ? (validateColor(input.color) ?? "")
      : current.color,
    input.x !== undefined ? (validateCoord(input.x) ?? current.x) : current.x,
    input.y !== undefined ? (validateCoord(input.y) ?? current.y) : current.y,
    input.w !== undefined
      ? (validateSize(input.w, MIN_W) ?? current.w)
      : current.w,
    input.h !== undefined
      ? (validateSize(input.h, MIN_H) ?? current.h)
      : current.h,
    id,
  );
  return getDepartment(id);
}

export function deleteDepartment(id: number): boolean {
  return (
    getDB().prepare("DELETE FROM departments WHERE id = ?").run(id).changes > 0
  );
}

/** Commit a batch of dragged/resized tiles in one transaction. */
export function setLayout(layouts: DepartmentLayout[]): void {
  if (!Array.isArray(layouts) || layouts.length > MAX_BATCH) {
    throw new Error("Invalid layout batch.");
  }
  const db = getDB();
  const update = db.prepare(
    "UPDATE departments SET x = ?, y = ?, w = ?, h = ? WHERE id = ?",
  );
  db.transaction(() => {
    for (const layout of layouts) {
      const x = validateCoord(layout.x);
      const y = validateCoord(layout.y);
      const w = validateSize(layout.w, MIN_W);
      const h = validateSize(layout.h, MIN_H);
      if (x === null || y === null || w === null || h === null) continue;
      update.run(x, y, w, h, layout.id);
    }
  })();
}

export function addMember(
  departmentId: number,
  employeeId: number,
  roleInDept = "",
  isLead = false,
  reportsTo: number | null = null,
): Department | null {
  if (!departmentExists(departmentId)) return null;
  if (!employeeExists(employeeId)) {
    throw new Error(`Employee ${employeeId} not found.`);
  }
  const parent =
    reportsTo != null && reportsTo !== employeeId ? reportsTo : null;
  getDB()
    .prepare(
      `INSERT INTO department_members (department_id, employee_id, role_in_dept, is_lead, reports_to)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(department_id, employee_id)
       DO UPDATE SET role_in_dept = excluded.role_in_dept, is_lead = excluded.is_lead, reports_to = excluded.reports_to`,
    )
    .run(
      departmentId,
      employeeId,
      validateRole(roleInDept),
      isLead ? 1 : 0,
      parent,
    );
  return getDepartment(departmentId);
}

/** Set who a member reports to inside a department (null = root). */
export function setMemberParent(
  departmentId: number,
  employeeId: number,
  parentEmployeeId: number | null,
): Department | null {
  if (!departmentExists(departmentId)) return null;
  const parent =
    parentEmployeeId != null && parentEmployeeId !== employeeId
      ? parentEmployeeId
      : null;
  getDB()
    .prepare(
      "UPDATE department_members SET reports_to = ? WHERE department_id = ? AND employee_id = ?",
    )
    .run(parent, departmentId, employeeId);
  return getDepartment(departmentId);
}

export function removeMember(
  departmentId: number,
  employeeId: number,
): Department | null {
  const db = getDB();
  db.transaction(() => {
    // Orphan any members who reported to the departing employee.
    db.prepare(
      "UPDATE department_members SET reports_to = NULL WHERE department_id = ? AND reports_to = ?",
    ).run(departmentId, employeeId);
    db.prepare(
      "DELETE FROM department_members WHERE department_id = ? AND employee_id = ?",
    ).run(departmentId, employeeId);
  })();
  return getDepartment(departmentId);
}

export function addEdge(input: DepartmentEdgeInput): DepartmentEdge {
  const { fromDeptId, toDeptId } = input;
  if (fromDeptId === toDeptId) {
    throw new Error("A department cannot link to itself.");
  }
  if (!departmentExists(fromDeptId) || !departmentExists(toDeptId)) {
    throw new Error("Both departments must exist.");
  }
  const label = validateLabel(input.label) ?? "";
  const kind = input.kind ?? "collab";
  const db = getDB();
  // Re-connecting an existing pair updates its ports, but never wipes a label
  // or kind that is already there (a fresh connect carries an empty label).
  db.prepare(
    `INSERT INTO department_edges (from_dept_id, to_dept_id, label, kind, from_side, to_side)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(from_dept_id, to_dept_id) DO UPDATE SET
       label = CASE WHEN excluded.label = '' THEN department_edges.label ELSE excluded.label END,
       kind = CASE WHEN excluded.label = '' THEN department_edges.kind ELSE excluded.kind END,
       from_side = excluded.from_side,
       to_side = excluded.to_side`,
  ).run(
    fromDeptId,
    toDeptId,
    label,
    kind,
    validateSide(input.fromSide),
    validateSide(input.toSide),
  );
  const row = db
    .prepare(
      "SELECT * FROM department_edges WHERE from_dept_id = ? AND to_dept_id = ?",
    )
    .get(fromDeptId, toDeptId) as DepartmentEdgeRow;
  return toEdge(row);
}

export function updateEdge(
  id: number,
  patch: LinkPatch,
): DepartmentEdge | null {
  const db = getDB();
  const current = db
    .prepare("SELECT * FROM department_edges WHERE id = ?")
    .get(id) as DepartmentEdgeRow | undefined;
  if (!current) return null;
  db.prepare(
    "UPDATE department_edges SET label = ?, kind = ? WHERE id = ?",
  ).run(
    patch.label !== undefined
      ? (validateLabel(patch.label) ?? "")
      : current.label,
    patch.kind ?? validateLinkKind(current.kind),
    id,
  );
  const row = db
    .prepare("SELECT * FROM department_edges WHERE id = ?")
    .get(id) as DepartmentEdgeRow;
  return toEdge(row);
}

export function removeEdge(id: number): boolean {
  return (
    getDB().prepare("DELETE FROM department_edges WHERE id = ?").run(id)
      .changes > 0
  );
}

/**
 * Re-point an existing link to a new pair of departments (drag-to-reconnect).
 * If the new pair already exists, the moved link is dropped (duplicate) and
 * null is returned.
 */
export function moveEdge(
  id: number,
  fromDeptId: number,
  toDeptId: number,
  fromSide: LinkSide | null | undefined,
  toSide: LinkSide | null | undefined,
): DepartmentEdge | null {
  if (fromDeptId === toDeptId) {
    throw new Error("A department cannot link to itself.");
  }
  if (!departmentExists(fromDeptId) || !departmentExists(toDeptId)) {
    throw new Error("Both departments must exist.");
  }
  const db = getDB();
  const current = db
    .prepare("SELECT * FROM department_edges WHERE id = ?")
    .get(id) as DepartmentEdgeRow | undefined;
  if (!current) return null;
  // If the target pair already has a link, merge into it (keep any label)
  // instead of erroring or dropping the label on the floor.
  const clash = db
    .prepare(
      "SELECT * FROM department_edges WHERE from_dept_id = ? AND to_dept_id = ? AND id <> ?",
    )
    .get(fromDeptId, toDeptId, id) as DepartmentEdgeRow | undefined;
  if (clash) {
    if (!clash.label && current.label) {
      db.prepare(
        "UPDATE department_edges SET label = ?, kind = ? WHERE id = ?",
      ).run(current.label, current.kind, clash.id);
    }
    db.prepare("DELETE FROM department_edges WHERE id = ?").run(id);
    return toEdge(
      db
        .prepare("SELECT * FROM department_edges WHERE id = ?")
        .get(clash.id) as DepartmentEdgeRow,
    );
  }
  db.prepare(
    "UPDATE department_edges SET from_dept_id = ?, to_dept_id = ?, from_side = ?, to_side = ? WHERE id = ?",
  ).run(fromDeptId, toDeptId, validateSide(fromSide), validateSide(toSide), id);
  const row = db
    .prepare("SELECT * FROM department_edges WHERE id = ?")
    .get(id) as DepartmentEdgeRow;
  return toEdge(row);
}

/**
 * Batch create/update used by the assistant's `imb_set_departments` tool.
 * Omitting `id` creates; passing `id` updates. A provided `members` list
 * *replaces* that department's members (add/remove in one step). Everything
 * commits in one transaction so a bad item rolls back the whole batch.
 */
export function upsertDepartments(items: DepartmentUpsertInput[]): number[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one department is required.");
  }
  if (items.length > MAX_BATCH) {
    throw new Error(`Too many departments in one batch (max ${MAX_BATCH}).`);
  }
  const db = getDB();
  const ids: number[] = [];
  db.transaction(() => {
    for (const item of items) {
      const department =
        item.id !== undefined
          ? updateDepartment(item.id, item)
          : createDepartment(item);
      if (!department) throw new Error(`Department ${item.id} not found.`);
      if (item.members !== undefined) {
        replaceMembers(department.id, item.members);
      }
      ids.push(department.id);
    }
  })();
  return ids;
}

/** Replace one department's entire member list atomically. */
function replaceMembers(
  departmentId: number,
  members: DepartmentMembershipInput[],
): void {
  const db = getDB();
  const del = db.prepare(
    "DELETE FROM department_members WHERE department_id = ?",
  );
  const insert = db.prepare(
    "INSERT INTO department_members (department_id, employee_id, role_in_dept, is_lead, reports_to) VALUES (?, ?, ?, ?, ?)",
  );
  del.run(departmentId);
  for (const member of members) {
    if (!employeeExists(member.employeeId)) {
      throw new Error(`Employee ${member.employeeId} not found.`);
    }
    const parent =
      member.reportsTo != null && member.reportsTo !== member.employeeId
        ? member.reportsTo
        : null;
    insert.run(
      departmentId,
      member.employeeId,
      validateRole(member.roleInDept ?? ""),
      member.isLead ? 1 : 0,
      parent,
    );
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toCore(row: DepartmentRow): Omit<Department, "members"> {
  return {
    id: row.id,
    name: row.name ?? "",
    kind: row.kind === "pool" ? "pool" : "team",
    color: row.color ?? "",
    x: row.x ?? 0,
    y: row.y ?? 0,
    w: row.w ?? 320,
    h: row.h ?? 240,
    sortOrder: row.sort_order ?? 0,
  };
}

function toEdge(row: DepartmentEdgeRow): DepartmentEdge {
  return {
    id: row.id,
    fromDeptId: row.from_dept_id,
    toDeptId: row.to_dept_id,
    label: row.label ?? "",
    kind: validateLinkKind(row.kind),
    fromSide: validateSide(row.from_side),
    toSide: validateSide(row.to_side),
  };
}

function toLink(row: EmployeeLinkRow): EmployeeLink {
  return {
    id: row.id,
    fromEmployeeId: row.from_employee_id,
    toEmployeeId: row.to_employee_id,
    label: row.label ?? "",
    kind: validateLinkKind(row.kind),
  };
}

// ---------------------------------------------------------------------------
// person-to-person links
// ---------------------------------------------------------------------------

/** Draw (or relabel) a directed, labeled link between two employees. */
export function addEmployeeLink(input: EmployeeLinkInput): EmployeeLink {
  const { fromEmployeeId, toEmployeeId } = input;
  if (fromEmployeeId === toEmployeeId) {
    throw new Error("A person cannot link to themselves.");
  }
  if (!employeeExists(fromEmployeeId) || !employeeExists(toEmployeeId)) {
    throw new Error("Both employees must exist.");
  }
  const label = validateLabel(input.label) ?? "";
  const kind = input.kind ?? "collab";
  const db = getDB();
  db.prepare(
    `INSERT INTO employee_links (from_employee_id, to_employee_id, label, kind)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(from_employee_id, to_employee_id) DO UPDATE SET label = excluded.label, kind = excluded.kind`,
  ).run(fromEmployeeId, toEmployeeId, label, kind);
  const row = db
    .prepare(
      "SELECT * FROM employee_links WHERE from_employee_id = ? AND to_employee_id = ?",
    )
    .get(fromEmployeeId, toEmployeeId) as EmployeeLinkRow;
  return toLink(row);
}

export function updateEmployeeLink(
  id: number,
  patch: LinkPatch,
): EmployeeLink | null {
  const db = getDB();
  const current = db
    .prepare("SELECT * FROM employee_links WHERE id = ?")
    .get(id) as EmployeeLinkRow | undefined;
  if (!current) return null;
  db.prepare("UPDATE employee_links SET label = ?, kind = ? WHERE id = ?").run(
    patch.label !== undefined
      ? (validateLabel(patch.label) ?? "")
      : current.label,
    patch.kind ?? validateLinkKind(current.kind),
    id,
  );
  const row = db
    .prepare("SELECT * FROM employee_links WHERE id = ?")
    .get(id) as EmployeeLinkRow;
  return toLink(row);
}

export function removeEmployeeLink(id: number): boolean {
  return (
    getDB().prepare("DELETE FROM employee_links WHERE id = ?").run(id).changes >
    0
  );
}

/** Re-point an existing person link (drag-to-reconnect). Drops a duplicate. */
export function moveEmployeeLink(
  id: number,
  fromEmployeeId: number,
  toEmployeeId: number,
): EmployeeLink | null {
  if (fromEmployeeId === toEmployeeId) {
    throw new Error("A person cannot link to themselves.");
  }
  if (!employeeExists(fromEmployeeId) || !employeeExists(toEmployeeId)) {
    throw new Error("Both employees must exist.");
  }
  const db = getDB();
  const existing = db
    .prepare("SELECT id FROM employee_links WHERE id = ?")
    .get(id);
  if (!existing) return null;
  try {
    db.prepare(
      "UPDATE employee_links SET from_employee_id = ?, to_employee_id = ? WHERE id = ?",
    ).run(fromEmployeeId, toEmployeeId, id);
  } catch {
    db.prepare("DELETE FROM employee_links WHERE id = ?").run(id);
    return null;
  }
  const row = db
    .prepare("SELECT * FROM employee_links WHERE id = ?")
    .get(id) as EmployeeLinkRow;
  return toLink(row);
}

/** Leads first, then by employee id — a stable order for the tile's member list. */
function sortMembers(members: DepartmentMember[]): DepartmentMember[] {
  return [...members].sort((a, b) => {
    if (a.isLead !== b.isLead) return a.isLead ? -1 : 1;
    return a.employeeId - b.employeeId;
  });
}

function departmentExists(id: number): boolean {
  return (
    getDB().prepare("SELECT 1 FROM departments WHERE id = ?").get(id) !==
    undefined
  );
}

function employeeExists(id: number): boolean {
  return (
    getDB()
      .prepare("SELECT 1 FROM employees WHERE id = ? AND disabled = 0")
      .get(id) !== undefined
  );
}

function validateName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  if (name.length > MAX_NAME) throw new Error("Department name is too long.");
  return name;
}

function validateKind(kind: string | undefined): DepartmentKind | undefined {
  if (kind === undefined) return undefined;
  if (kind !== "team" && kind !== "pool") {
    throw new Error("Department kind must be 'team' or 'pool'.");
  }
  return kind;
}

/** Accepts `#rrggbb` / `#rgb` or an empty string (palette default). */
function validateColor(color: string | undefined): string | undefined {
  if (color === undefined) return undefined;
  if (color === "") return "";
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) {
    throw new Error("Department color must be a hex value.");
  }
  return color;
}

function validateLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  if (label.length > MAX_LABEL) throw new Error("Link label is too long.");
  return label;
}

/** Coerce a stored link kind to a known value (defaults to 'collab'). */
function validateLinkKind(kind: string | null | undefined): LinkKind {
  return kind === "depend" || kind === "report" || kind === "ref"
    ? kind
    : "collab";
}

/** Coerce a stored anchor side to a known value (or null). */
function validateSide(side: string | null | undefined): LinkSide | null {
  return side === "t" || side === "b" || side === "l" || side === "r"
    ? side
    : null;
}

function validateRole(role: string): string {
  if (role.length > MAX_ROLE) throw new Error("Department role is too long.");
  return role;
}

/** Clamp a canvas coordinate; returns null for a missing/NaN/absurd value. */
function validateCoord(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(-MAX_LAYOUT, Math.min(MAX_LAYOUT, value));
}

/** Clamp a tile dimension to a floor and a sane ceiling. */
function validateSize(value: number | undefined, min: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(min, Math.min(MAX_LAYOUT, value));
}
