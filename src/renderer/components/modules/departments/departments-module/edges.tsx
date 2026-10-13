import type {
  Department,
  DepartmentEdge,
  EmployeeLink,
  LinkKind,
  LinkSide,
} from "@shared/types";
import { cls } from "reactutils";

/** Canvas viewport: canvas point → screen point is `p * scale + offset`. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export type LinkEnd = "from" | "to" | "body";

export interface ReconnectTarget {
  kind: "dept" | "person";
  id: number;
}

/** Person-to-person links use their own color, distinct from department links. */
export const PERSON_COLOR = "#55505c";

/** Per-kind accent, used only by the link editor's kind buttons. */
export const KIND_STYLE: Record<LinkKind, { color: string; dash: string }> = {
  collab: { color: "#3b6ef5", dash: "9 7" },
  depend: { color: "#f0921f", dash: "7 6" },
  report: { color: "#22b573", dash: "2 5" },
  ref: { color: "#9b8b73", dash: "1 5" },
};

/** Project a canvas-space point into screen space. */
export function canvasToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

function boxCenter(d: Department): Point {
  return { x: d.x + d.w / 2, y: d.y + d.h / 2 };
}

function portPoint(department: Department, side: LinkSide): Point {
  const c = boxCenter(department);
  if (side === "t") return { x: c.x, y: department.y };
  if (side === "b") return { x: c.x, y: department.y + department.h };
  if (side === "l") return { x: department.x, y: c.y };
  return { x: department.x + department.w, y: c.y };
}

function autoSide(from: Department, to: Department): LinkSide {
  const a = boxCenter(from);
  const b = boxCenter(to);
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return b.x >= a.x ? "r" : "l";
  return b.y >= a.y ? "b" : "t";
}

/**
 * Orthogonal (right-angle) route from port to port: leave perpendicular, turn,
 * enter perpendicular. A single L-bend when the sides are perpendicular, a
 * Z (two bends) when they share an axis.
 */
function routeOf(
  from: Department,
  to: Department,
  fromSide: LinkSide | null,
  toSide: LinkSide | null,
  offset = 0,
): { pts: Point[]; mid: Point; perp: Point } {
  const fs = fromSide ?? autoSide(from, to);
  const ts = toSide ?? autoSide(to, from);
  const s = portPoint(from, fs);
  const t = portPoint(to, ts);
  const horizS = fs === "l" || fs === "r";
  const horizT = ts === "l" || ts === "r";
  let pts: Point[];
  if (horizS && horizT) {
    const midX = (s.x + t.x) / 2 + offset;
    pts = [s, { x: midX, y: s.y }, { x: midX, y: t.y }, t];
  } else if (!horizS && !horizT) {
    const midY = (s.y + t.y) / 2 + offset;
    pts = [s, { x: s.x, y: midY }, { x: t.x, y: midY }, t];
  } else if (horizS) {
    pts = [s, { x: t.x, y: s.y }, t];
  } else {
    pts = [s, { x: s.x, y: t.y }, t];
  }
  // Anchor the label beside the longest segment's middle (offset off the line),
  // so it neither sits on a frame nor covers the wire.
  let bestLen = 0;
  let bestIndex = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (len > bestLen) {
      bestLen = len;
      bestIndex = i;
    }
  }
  const a = pts[bestIndex];
  const b2 = pts[bestIndex + 1];
  const len = bestLen || 1;
  const dir = { x: (b2.x - a.x) / len, y: (b2.y - a.y) / len };
  return {
    pts,
    mid: { x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2 },
    perp: { x: dir.y, y: -dir.x },
  };
}

function roundedPath(points: Point[], radius = 12): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i - 1];
    const c = points[i];
    const n = points[i + 1];
    const v1x = c.x - p.x;
    const v1y = c.y - p.y;
    const v2x = n.x - c.x;
    const v2y = n.y - c.y;
    const l1 = Math.hypot(v1x, v1y);
    const l2 = Math.hypot(v2x, v2y);
    if (l1 < 1 || l2 < 1) {
      d += ` L ${c.x},${c.y}`;
      continue;
    }
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const ax = c.x - (v1x / l1) * r;
    const ay = c.y - (v1y / l1) * r;
    const bx = c.x + (v2x / l2) * r;
    const by = c.y + (v2y / l2) * r;
    d += ` L ${ax},${ay} Q ${c.x},${c.y} ${bx},${by}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x},${last.y}`;
  return d;
}

export interface PendingLink {
  fromId: number;
  fromSide: LinkSide;
  to: Point;
}

export interface EdgesLayerProps {
  departments: Department[];
  edges: DepartmentEdge[];
  viewport: Viewport;
  pending: PendingLink | null;
  activeDeptIds: Set<number>;
  hoveredEdgeId: number | null;
  onHoverEdge: (id: number | null) => void;
  isVisible: (edge: DepartmentEdge) => boolean;
  labelsAlways: boolean;
  /** Hide this edge while it is being re-pointed (show only the preview). */
  hiddenEdgeId: number | null;
  /** A department's color (the link borrows its source card's color). */
  deptColor: (deptId: number) => string;
  onEditLabel: (edges: DepartmentEdge[], screen: Point) => void;
  onReconnect: (
    target: ReconnectTarget,
    end: LinkEnd,
    grabScreen: Point,
  ) => void;
}

/**
 * Department links: right-angled dashed lines from port to port, colored by the
 * source card. Links sharing a pair merge into one line; an endpoint (or the
 * line) can be dragged to re-point it.
 */
export function EdgesLayer({
  departments,
  edges,
  viewport,
  pending,
  activeDeptIds,
  hoveredEdgeId,
  onHoverEdge,
  isVisible,
  labelsAlways,
  hiddenEdgeId,
  deptColor,
  onEditLabel,
  onReconnect,
}: EdgesLayerProps): React.JSX.Element {
  const byId = new Map(departments.map((d) => [d.id, d]));
  const source = pending ? byId.get(pending.fromId) : undefined;

  const groups = new Map<string, DepartmentEdge[]>();
  for (const edge of edges) {
    const key =
      edge.fromDeptId < edge.toDeptId
        ? `${edge.fromDeptId}:${edge.toDeptId}`
        : `${edge.toDeptId}:${edge.fromDeptId}`;
    const list = groups.get(key) ?? [];
    list.push(edge);
    groups.set(key, list);
  }
  const groupList = [...groups.values()];

  function routeScreen(group: DepartmentEdge[]): {
    screen: Point[];
    mid: Point;
    perp: Point;
    color: string;
  } | null {
    const edge = group[0];
    const from = byId.get(edge.fromDeptId);
    const to = byId.get(edge.toDeptId);
    if (!from || !to) return null;
    const offset = ((edge.id % 5) - 2) * 8;
    const { pts, mid, perp } = routeOf(
      from,
      to,
      edge.fromSide,
      edge.toSide,
      offset,
    );
    return {
      screen: pts.map((p) => canvasToScreen(p, viewport)),
      mid: canvasToScreen(mid, viewport),
      perp,
      // The link follows its TARGET card's color (parent → child uses the child).
      color: deptColor(edge.toDeptId),
    };
  }

  return (
    <>
      <svg className="imb-dept-wires" aria-hidden="true">
        <defs>
          <marker
            id="imb-arrow"
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M0,0 L6,3 L0,6"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.4"
            />
          </marker>
        </defs>
        {groupList.map((group) => {
          if (group.length === 1 && group[0].id === hiddenEdgeId) return null;
          if (!group.some(isVisible)) return null;
          const route = routeScreen(group);
          if (!route) return null;
          const edge = group[0];
          const live =
            activeDeptIds.has(edge.fromDeptId) ||
            activeDeptIds.has(edge.toDeptId) ||
            group.some((e) => e.id === hoveredEdgeId);
          const s = route.screen[0];
          return (
            <g key={edge.id}>
              <path
                className={cls("imb-dept-wire", live && "imb-is-live")}
                d={roundedPath(route.screen)}
                style={{ stroke: route.color }}
                markerEnd="url(#imb-arrow)"
              />
              <circle
                className="imb-dept-anchor"
                cx={s.x}
                cy={s.y}
                r={3.2}
                style={{ stroke: route.color }}
              />
            </g>
          );
        })}
        {pending && source && (
          <path
            className="imb-dept-wire imb-is-pending"
            d={`M ${
              canvasToScreen(portPoint(source, pending.fromSide), viewport).x
            },${
              canvasToScreen(portPoint(source, pending.fromSide), viewport).y
            } L ${pending.to.x},${pending.to.y}`}
          />
        )}
      </svg>

      <svg className="imb-dept-hitlayer" aria-hidden="true">
        {groupList.map((group) => {
          if (group.length !== 1) return null;
          const edge = group[0];
          if (!isVisible(edge)) return null;
          const route = routeScreen(group);
          if (!route) return null;
          const s = route.screen[0];
          const d = roundedPath(route.screen);
          return (
            <g key={edge.id}>
              <path
                className="imb-dept-wire-hit"
                d={d}
                onPointerEnter={() => onHoverEdge(edge.id)}
                onPointerLeave={() => onHoverEdge(null)}
                onPointerDown={(event) =>
                  onReconnect({ kind: "dept", id: edge.id }, "body", {
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
              <circle
                className="imb-dept-eph"
                cx={s.x}
                cy={s.y}
                r={5}
                style={{ stroke: route.color }}
                onPointerDown={(event) =>
                  onReconnect({ kind: "dept", id: edge.id }, "from", {
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
            </g>
          );
        })}
      </svg>

      {groupList.map((group) => {
        const shown = group.filter(isVisible);
        const labels = (
          labelsAlways ? shown : shown.filter((e) => e.id === hoveredEdgeId)
        ).filter((e) => e.label.length > 0 || e.id === hoveredEdgeId);
        if (labels.length === 0) return null;
        const route = routeScreen(group);
        if (!route) return null;
        const at = {
          x: route.mid.x + route.perp.x * 20,
          y: route.mid.y + route.perp.y * 20,
        };
        const first = labels[0];
        const text = labels.map((e) => e.label || "+").join(" · ");
        return (
          <button
            key={`label:${first.id}`}
            type="button"
            className="imb-dept-wire-label"
            style={{ left: at.x, top: at.y, background: route.color }}
            title={text}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditLabel(labels, at);
            }}
          >
            {text}
          </button>
        );
      })}
    </>
  );
}

export interface PersonLinksLayerProps {
  links: EmployeeLink[];
  personPos: Map<number, Point>;
  /** employee id → its card size (links attach to the card border). */
  personSize: Map<number, { w: number; h: number }>;
  viewport: Viewport;
  isVisible: (link: EmployeeLink) => boolean;
  activeEmployees: Set<number>;
  /** Hide this link while it is being re-pointed. */
  hiddenLinkId: number | null;
  onEditLabel: (links: EmployeeLink[], screen: Point) => void;
  onReconnect: (
    target: ReconnectTarget,
    end: LinkEnd,
    grabScreen: Point,
  ) => void;
}

/** Person-to-person links: straight dashed segments in their own color. */
export function PersonLinksLayer({
  links,
  personPos,
  personSize,
  viewport,
  isVisible,
  activeEmployees,
  hiddenLinkId,
  onEditLabel,
  onReconnect,
}: PersonLinksLayerProps): React.JSX.Element {
  const all = links.filter(
    (link) => isVisible(link) && link.id !== hiddenLinkId,
  );

  // Attach each end to the member CARD's border (not its centre), so the line
  // meets the card edge and never runs through the card or sits over it.
  const borderPoint = (
    c: Point,
    size: { w: number; h: number },
    toward: Point,
  ): Point => {
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return c;
    const s = Math.min(
      size.w / 2 / Math.max(Math.abs(dx), 1e-6),
      size.h / 2 / Math.max(Math.abs(dy), 1e-6),
    );
    return { x: c.x + dx * s, y: c.y + dy * s };
  };

  const lineOf = (link: EmployeeLink): { sa: Point; sb: Point } | null => {
    const a = personPos.get(link.fromEmployeeId);
    const b = personPos.get(link.toEmployeeId);
    if (!a || !b) return null;
    const sizeA = personSize.get(link.fromEmployeeId) ?? { w: 168, h: 46 };
    const sizeB = personSize.get(link.toEmployeeId) ?? { w: 168, h: 46 };
    return {
      sa: canvasToScreen(borderPoint(a, sizeA, b), viewport),
      sb: canvasToScreen(borderPoint(b, sizeB, a), viewport),
    };
  };

  const isLive = (link: EmployeeLink): boolean =>
    activeEmployees.has(link.fromEmployeeId) ||
    activeEmployees.has(link.toEmployeeId);

  return (
    <>
      <svg className="imb-dept-plinks" aria-hidden="true">
        {all.map((link) => {
          const ends = lineOf(link);
          if (!ends) return null;
          return (
            <path
              key={link.id}
              className={cls("imb-dept-pwire", isLive(link) && "imb-is-live")}
              d={`M ${ends.sa.x},${ends.sa.y} L ${ends.sb.x},${ends.sb.y}`}
              markerEnd="url(#imb-arrow)"
            />
          );
        })}
      </svg>
      <svg className="imb-dept-hitlayer" aria-hidden="true">
        {all.map((link) => {
          const ends = lineOf(link);
          if (!ends) return null;
          const sa = ends.sa;
          const sb = ends.sb;
          return (
            <g key={link.id}>
              <path
                className="imb-dept-wire-hit"
                d={`M ${sa.x},${sa.y} L ${sb.x},${sb.y}`}
                onPointerDown={(event) =>
                  onReconnect({ kind: "person", id: link.id }, "body", {
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
              <circle
                className="imb-dept-eph"
                cx={sa.x}
                cy={sa.y}
                r={5}
                style={{ stroke: PERSON_COLOR }}
                onPointerDown={(event) =>
                  onReconnect({ kind: "person", id: link.id }, "from", {
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
              <circle
                className="imb-dept-eph"
                cx={sb.x}
                cy={sb.y}
                r={5}
                style={{ stroke: PERSON_COLOR }}
                onPointerDown={(event) =>
                  onReconnect({ kind: "person", id: link.id }, "to", {
                    x: event.clientX,
                    y: event.clientY,
                  })
                }
              />
            </g>
          );
        })}
      </svg>
      {all.map((link) => {
        const ends = lineOf(link);
        if (!ends) return null;
        const mid = {
          x: (ends.sa.x + ends.sb.x) / 2,
          y: (ends.sa.y + ends.sb.y) / 2 - 12,
        };
        return (
          <button
            key={`plabel:${link.id}`}
            type="button"
            className="imb-dept-wire-label"
            style={{ left: mid.x, top: mid.y, background: PERSON_COLOR }}
            title={link.label || undefined}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onEditLabel([link], mid);
            }}
          >
            {link.label || "+"}
          </button>
        );
      })}
    </>
  );
}
