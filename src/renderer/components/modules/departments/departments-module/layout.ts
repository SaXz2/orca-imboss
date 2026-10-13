import type { Department, DepartmentMember } from "@shared/types";

/**
 * Layout for one department frame's internal structure.
 *
 * Members form a FOREST via `reportsTo`: a root is a member with no valid
 * parent inside the same department. Several roots — several peers at the same
 * level (e.g. three co-leaders) — are laid out side by side, each above its own
 * subtree. Leaves are spread across the frame width; a parent sits centred over
 * its children. The frame width follows the leaf count and its height the depth.
 */
export const DEPT_HEADER_H = 46;
export const DEPT_PAD_TOP = 68;
export const DEPT_LEVEL_H = 106;
export const DEPT_PAD_BOTTOM = 26;
export const DEPT_FOOTER_H = 30;
export const PEER_HALF = 27;
export const CHILD_HALF = 24;
export const SLOT_W = 190;
export const MARGIN_X = 34;

export interface LayoutNode {
  employeeId: number;
  /** Centre position in frame-local coordinates. */
  x: number;
  y: number;
  /** 0 = a top-level peer (co-leader); deeper = a subordinate. */
  depth: number;
  /** A top-level peer (draws with the peer card style). */
  root: boolean;
  /** Reports to nobody in the department (same as root). */
  lead: boolean;
  half: number;
  /** Rendered card size (so links can attach to the card's border). */
  w: number;
  h: number;
}

export interface DeptLayout {
  /** Frame width, driven by the leaf count. */
  width: number;
  /** Frame height, driven by the tree depth. */
  height: number;
  nodes: LayoutNode[];
  /** Bracket paths (frame-local): a parent's stem + a shared bar + drops. */
  paths: string[];
}

/** One child's drop from its parent (a straight stem when directly below). */
function childPath(parent: LayoutNode, child: LayoutNode): string {
  const pBottom = parent.y + parent.half;
  const childTop = child.y - child.half;
  if (Math.abs(child.x - parent.x) < 1) {
    return `M ${parent.x},${pBottom} L ${child.x},${childTop}`;
  }
  const midY = (pBottom + childTop) / 2;
  return `M ${parent.x},${pBottom} L ${parent.x},${midY} L ${child.x},${midY} L ${child.x},${childTop}`;
}

export function layoutDepartment(department: Department): DeptLayout {
  const members = department.members;
  const baseWidth = Math.max(260, 2 * MARGIN_X + SLOT_W);
  if (members.length === 0) {
    return {
      width: baseWidth,
      height: Math.max(
        DEPT_HEADER_H +
          DEPT_PAD_TOP +
          CHILD_HALF * 2 +
          DEPT_PAD_BOTTOM +
          DEPT_FOOTER_H,
        department.h,
      ),
      nodes: [],
      paths: [],
    };
  }

  const byId = new Map(members.map((m) => [m.employeeId, m]));
  const children = new Map<number, DepartmentMember[]>();
  const roots: DepartmentMember[] = [];
  for (const member of members) {
    const parentId = member.reportsTo;
    const parent =
      parentId != null && parentId !== member.employeeId && byId.has(parentId)
        ? parentId
        : null;
    if (parent === null) {
      roots.push(member);
    } else {
      const list = children.get(parent) ?? [];
      list.push(member);
      children.set(parent, list);
    }
  }
  roots.sort((a, b) => a.employeeId - b.employeeId);

  const pos = new Map<number, { x: number; y: number }>();
  const seen = new Set<number>();
  let leafX = 0;
  let maxDepth = 0;

  function place(member: DepartmentMember, depth: number): number {
    if (seen.has(member.employeeId)) {
      return pos.get(member.employeeId)?.x ?? 0;
    }
    seen.add(member.employeeId);
    maxDepth = Math.max(maxDepth, depth);
    const kids = (children.get(member.employeeId) ?? [])
      .slice()
      .sort((a, b) => a.employeeId - b.employeeId);
    let x: number;
    if (kids.length === 0) {
      x = leafX;
      leafX += 1;
    } else {
      const xs = kids.map((kid) => place(kid, depth + 1));
      x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    pos.set(member.employeeId, { x, y: depth });
    return x;
  }

  for (const root of roots) place(root, 0);
  for (const member of members) {
    if (!pos.has(member.employeeId)) place(member, 0);
  }

  const leaves = Math.max(1, leafX);
  const width = Math.max(
    baseWidth,
    2 * MARGIN_X + leaves * SLOT_W,
    department.w,
  );
  const slotW = (width - 2 * MARGIN_X) / leaves;

  const nodes: LayoutNode[] = members.map((member) => {
    const p = pos.get(member.employeeId) ?? { x: 0, y: 0 };
    const root = p.y === 0;
    return {
      employeeId: member.employeeId,
      x: MARGIN_X + (p.x + 0.5) * slotW,
      y: DEPT_HEADER_H + DEPT_PAD_TOP + p.y * DEPT_LEVEL_H,
      depth: p.y,
      root,
      lead: root,
      half: root ? PEER_HALF : CHILD_HALF,
      w: root ? 178 : 168,
      h: root ? 54 : 46,
    };
  });

  const nodeById = new Map(nodes.map((n) => [n.employeeId, n]));
  const paths: string[] = [];
  for (const member of members) {
    const kids = children.get(member.employeeId);
    if (!kids || kids.length === 0) continue;
    const parent = nodeById.get(member.employeeId);
    if (!parent) continue;
    for (const kid of kids) {
      const child = nodeById.get(kid.employeeId);
      if (child) paths.push(childPath(parent, child));
    }
  }

  const deepestHalf = maxDepth === 0 ? PEER_HALF : CHILD_HALF;
  const height = Math.max(
    DEPT_HEADER_H +
      DEPT_PAD_TOP +
      maxDepth * DEPT_LEVEL_H +
      deepestHalf +
      DEPT_PAD_BOTTOM +
      DEPT_FOOTER_H,
    department.h,
  );
  return { width, height, nodes, paths };
}
