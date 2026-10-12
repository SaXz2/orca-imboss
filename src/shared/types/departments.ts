/**
 * Department canvas domain types.
 *
 * The canvas organizes the flat employee roster into draggable department
 * "tiles" wired together by labeled links. Departments and employees are
 * many-to-many: one employee can belong to several departments at once, and an
 * employee may belong to none (independent talent, e.g. the outsourcing pool).
 */

/** Node kind: a regular department, or the independent outsourcing pool. */
export type DepartmentKind = "team" | "pool";

/**
 * Generic relationship kind for a link (department↔department or person↔person).
 * Deliberately domain-neutral — the free-text label carries the specifics.
 */
export type LinkKind = "collab" | "depend" | "report" | "ref";

export const LINK_KINDS: readonly LinkKind[] = [
  "collab",
  "depend",
  "report",
  "ref",
];

/** One department–employee membership row (many-to-many). */
export interface DepartmentMember {
  employeeId: number;
  /** Free-text role within this department (empty = fall back to the employee's own role). */
  roleInDept: string;
  /** Marks this department's lead. */
  isLead: boolean;
  /** Employee id this member reports to inside the same department (null = a root of the department's internal tree). */
  reportsTo: number | null;
}

/** Canvas node: one department tile plus its members. */
export interface Department {
  id: number;
  name: string;
  kind: DepartmentKind;
  /** Accent color ('' = derive from the department palette). */
  color: string;
  /** Canvas layout, in canvas units. */
  x: number;
  y: number;
  w: number;
  h: number;
  sortOrder: number;
  members: DepartmentMember[];
}

/** Which frame port a link anchors to: top / bottom / left / right. */
export type LinkSide = "t" | "b" | "l" | "r";

/** A directed, labeled link between two departments. */
export interface DepartmentEdge {
  id: number;
  fromDeptId: number;
  toDeptId: number;
  label: string;
  kind: LinkKind;
  /** Anchor side at each end (null = auto-pick by direction). */
  fromSide: LinkSide | null;
  toSide: LinkSide | null;
}

/** The whole canvas: nodes plus links. */
export interface DepartmentGraph {
  departments: Department[];
  edges: DepartmentEdge[];
  /** Person-to-person links (independent of departments; may cross them). */
  personLinks: EmployeeLink[];
}

/** A person-to-person link between two employees, drawn above the frames. */
export interface EmployeeLink {
  id: number;
  fromEmployeeId: number;
  toEmployeeId: number;
  label: string;
  kind: LinkKind;
}

/** Input for drawing a new person-to-person link. */
export interface EmployeeLinkInput {
  fromEmployeeId: number;
  toEmployeeId: number;
  label?: string;
  kind?: LinkKind;
}

/** Patch for an existing link's label and/or kind. */
export interface LinkPatch {
  label?: string;
  kind?: LinkKind;
}

/** Create/update input for one department (absent fields stay untouched). */
export interface DepartmentInput {
  name?: string;
  kind?: DepartmentKind;
  color?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** One membership in a batch upsert. */
export interface DepartmentMembershipInput {
  employeeId: number;
  roleInDept?: string;
  isLead?: boolean;
  /** Employee id this member reports to inside the same department. */
  reportsTo?: number | null;
}

/** One department in a batch upsert (omit `id` to create). */
export interface DepartmentUpsertInput extends DepartmentInput {
  id?: number;
  /** When present, replaces the department's whole member list. */
  members?: DepartmentMembershipInput[];
}

/** One department's committed layout (drag/resize commit). */
export interface DepartmentLayout {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Input for drawing a new link between two departments. */
export interface DepartmentEdgeInput {
  fromDeptId: number;
  toDeptId: number;
  label?: string;
  kind?: LinkKind;
  fromSide?: LinkSide | null;
  toSide?: LinkSide | null;
}

/** Input for re-pointing an existing department link. */
export interface DepartmentEdgeMove {
  fromDeptId: number;
  toDeptId: number;
  fromSide?: LinkSide | null;
  toSide?: LinkSide | null;
}
