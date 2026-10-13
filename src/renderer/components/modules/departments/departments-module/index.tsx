import { t } from "@shared/l10n";
import {
  LINK_KINDS,
  type Department,
  type DepartmentEdge,
  type DepartmentGraph,
  type Employee,
  type EmployeeLink,
  type LinkKind,
  type LinkSide,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { Button } from "../../../button";
import { Modal } from "../../../modal";
import { DepartmentCard } from "./department-card";
import {
  EdgesLayer,
  KIND_STYLE,
  PersonLinksLayer,
  canvasToScreen,
  type LinkEnd,
  type PendingLink,
  type Point,
  type ReconnectTarget,
  type Viewport,
} from "./edges";
import { layoutDepartment, type DeptLayout } from "./layout";
import { MemberPicker } from "./member-picker";
import "./index.css";

const PALETTE = [
  "#e64980",
  "#4c6ef5",
  "#0ca678",
  "#f59f00",
  "#7950f2",
  "#1098ad",
];
const POOL_COLOR = "#9b8b73";

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;
const DEFAULT_VIEWPORT: Viewport = { x: 48, y: 40, scale: 1 };

// Kept outside the component so the pan/zoom (and the one-time fit) survive
// switching away from the module and back.
const viewportMemory: { value: Viewport | null } = { value: null };
const fitMemory: { done: boolean } = { done: false };

/** How person-to-person links are shown. */
type PersonMode = "hidden" | "hover" | "all";
const PERSON_MODES: readonly PersonMode[] = ["hidden", "hover", "all"];
const PERSON_MODE_LABEL: Record<PersonMode, string> = {
  hidden: "Hidden",
  hover: "On hover",
  all: "All",
};

function colorFor(department: Department): string {
  if (department.color) return department.color;
  if (department.kind === "pool") return POOL_COLOR;
  return PALETTE[department.id % PALETTE.length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface PendingPersonLink {
  fromEmployeeId: number;
  to: Point;
}

interface Reconnect {
  kind: "dept" | "person";
  id: number;
  movingEnd: "from" | "to";
  /** The other (fixed) endpoint, in screen space. */
  fixed: Point;
  /** Where the drag began, in screen space (to tell a click from a drag). */
  start: Point;
  pointer: Point;
}

interface EditEntry {
  id: number;
  label: string;
  kind: LinkKind;
}

interface Editing {
  type: "dept" | "person";
  entries: EditEntry[];
}

/**
 * The department canvas: department frames (each a top-down member forest),
 * wired by kind-colored department links and person-to-person links (shown per
 * the toolbar's display mode). Reads the whole graph from main and keeps it in
 * sync (the assistant can mutate it out of band).
 */
export function DepartmentsModule(): React.JSX.Element {
  const { data } = useApp();
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<DepartmentGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(
    () => viewportMemory.value ?? DEFAULT_VIEWPORT,
  );
  useEffect(() => {
    viewportMemory.value = viewport;
  }, [viewport]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoveredDeptId, setHoveredDeptId] = useState<number | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<number | null>(
    null,
  );
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [pendingPerson, setPendingPerson] = useState<PendingPersonLink | null>(
    null,
  );
  const [pickerDeptId, setPickerDeptId] = useState<number | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [personMode, setPersonMode] = useState<PersonMode>("hover");
  const [deptMode, setDeptMode] = useState<PersonMode>("all");
  const [reconnect, setReconnect] = useState<Reconnect | null>(null);

  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);
  const graphRef = useRef<DepartmentGraph | null>(graph);
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);
  const pendingRef = useRef<PendingLink | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  const pendingPersonRef = useRef<PendingPersonLink | null>(null);
  useEffect(() => {
    pendingPersonRef.current = pendingPerson;
  }, [pendingPerson]);

  const reloadGraph = useCallback(async (): Promise<void> => {
    try {
      const next = await imb.departments.graph();
      setGraph(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadGraph();
    void appStore.reloadEmployees();
    const off = imb.departments.onChanged(() => void reloadGraph());
    return () => {
      off();
    };
  }, [reloadGraph]);

  // Safety net: if the window loses focus mid-drag, the pointerup can be missed,
  // leaving a rubber-band line stuck. Clear every transient drag state.
  useEffect(() => {
    const clear = (): void => {
      setPending(null);
      setPendingPerson(null);
      setReconnect(null);
    };
    window.addEventListener("blur", clear);
    return () => window.removeEventListener("blur", clear);
  }, []);

  const wheelCleanupRef = useRef<(() => void) | null>(null);
  const attachSurface = useCallback((el: HTMLDivElement | null): void => {
    surfaceRef.current = el;
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setViewport((vp) => {
        const scale = clamp(
          vp.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1),
          MIN_SCALE,
          MAX_SCALE,
        );
        const k = scale / vp.scale;
        return { scale, x: px - (px - vp.x) * k, y: py - (py - vp.y) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanupRef.current = () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pendingActive = pending !== null;

  /** Drag from a frame port to another frame → create a department link. */
  function startDeptLink(
    fromId: number,
    fromSide: LinkSide,
    startScreen: Point,
  ): void {
    const el = surfaceRef.current;
    if (!el) return;
    const to = (event: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    setPending({ fromId, fromSide, to: startScreen });
    const onMove = (event: PointerEvent): void => {
      setPending((current) =>
        current ? { ...current, to: to(event) } : current,
      );
    };
    const onUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPending(null);
      const drop = to(event);
      const toId = deptAt(drop, 32);
      if (toId !== null && toId !== fromId) {
        void createEdge(fromId, toId, fromSide, drop);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const pendingPersonActive = pendingPerson !== null;

  /** Drag from a person port to another member → create a person link. */
  function startPersonLink(fromEmployeeId: number, startScreen: Point): void {
    const el = surfaceRef.current;
    if (!el) return;
    const to = (event: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    setPendingPerson({ fromEmployeeId, to: startScreen });
    const onMove = (event: PointerEvent): void => {
      setPendingPerson((current) =>
        current ? { ...current, to: to(event) } : current,
      );
    };
    const onUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setPendingPerson(null);
      const drop = to(event);
      const toId = personAt(drop);
      if (toId !== null && toId !== fromEmployeeId) {
        void createPersonLink(fromEmployeeId, toId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const reconnectActive = reconnect !== null;

  // The outsourcing pool is derived, not hand-managed: it holds every employee
  // who is NOT placed in a team department (the built-in assistant excluded).
  const departments = useMemo((): Department[] => {
    const source = graph?.departments ?? [];
    const assigned = new Set<number>();
    for (const d of source) {
      if (d.kind === "pool") continue;
      for (const m of d.members) assigned.add(m.employeeId);
    }
    const unassigned = data.employees.items.filter(
      (e) => e.id !== 0 && !e.disabled && !assigned.has(e.id),
    );
    return source.map((d) =>
      d.kind === "pool"
        ? {
            ...d,
            members: unassigned.map((e) => ({
              employeeId: e.id,
              roleInDept: "",
              isLead: false,
              reportsTo: null,
            })),
          }
        : d,
    );
  }, [graph, data.employees.items]);

  const layouts = useMemo(() => {
    const map = new Map<number, DeptLayout>();
    for (const department of departments) {
      map.set(department.id, layoutDepartment(department));
    }
    return map;
  }, [departments]);

  const placedDepartments = useMemo(
    () =>
      departments.map((department) => {
        const layout = layouts.get(department.id);
        return {
          ...department,
          // Match exactly what the card renders: max(content, user size).
          w: layout?.width ?? department.w,
          h: layout?.height ?? department.h,
        };
      }),
    [graph, layouts],
  );

  const layoutsRef = useRef(layouts);
  useEffect(() => {
    layoutsRef.current = layouts;
  }, [layouts]);

  function fitAll(): void {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const placed = placedDepartments;
    if (!rect || placed.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const d of placed) {
      minX = Math.min(minX, d.x);
      minY = Math.min(minY, d.y);
      maxX = Math.max(maxX, d.x + d.w);
      maxY = Math.max(maxY, d.y + d.h);
    }
    const pad = 60;
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const scale = clamp(
      Math.min((rect.width - pad * 2) / bw, (rect.height - pad * 2) / bh),
      MIN_SCALE,
      1,
    );
    setViewport({
      scale,
      x: (rect.width - bw * scale) / 2 - minX * scale,
      y: (rect.height - bh * scale) / 2 - minY * scale,
    });
  }

  function zoomBy(factor: number): void {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setViewport((vp) => {
      const scale = clamp(vp.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = scale / vp.scale;
      return { scale, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k };
    });
  }

  function beginPan(event: React.PointerEvent): void {
    if (!surfaceRef.current) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...viewportRef.current };
    setSelectedId(null);
    const onMove = (move: PointerEvent): void => {
      setViewport({
        ...start,
        x: start.x + (move.clientX - startX),
        y: start.y + (move.clientY - startY),
      });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function replaceDepartment(department: Department | null): void {
    if (!department) return;
    setGraph((current) =>
      current
        ? {
            ...current,
            departments: current.departments.map((d) =>
              d.id === department.id ? department : d,
            ),
          }
        : current,
    );
  }

  const patchLocal = useCallback(
    (id: number, patch: Partial<Department>): void => {
      setGraph((current) =>
        current
          ? {
              ...current,
              departments: current.departments.map((d) =>
                d.id === id ? { ...d, ...patch } : d,
              ),
            }
          : current,
      );
    },
    [],
  );

  async function commitLayout(): Promise<void> {
    const current = graphRef.current;
    if (!current) return;
    try {
      await imb.departments.setLayout(
        current.departments.map((d) => ({
          id: d.id,
          x: d.x,
          y: d.y,
          w: layoutsRef.current.get(d.id)?.width ?? d.w,
          h: layoutsRef.current.get(d.id)?.height ?? d.h,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createDepartment(): Promise<void> {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const vp = viewportRef.current;
    const x = rect ? (rect.width / 2 - vp.x) / vp.scale - 160 : 80;
    const y = rect ? (rect.height / 2 - vp.y) / vp.scale - 120 : 80;
    try {
      await imb.departments.create({ name: t("New department"), x, y });
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function renameDepartment(id: number, name: string): Promise<void> {
    patchLocal(id, { name });
    try {
      await imb.departments.update(id, { name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setDeptColor(id: number, color: string): Promise<void> {
    patchLocal(id, { color });
    try {
      await imb.departments.update(id, { color });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setDeptCharter(id: number, charter: string): Promise<void> {
    patchLocal(id, { charter });
    try {
      await imb.departments.update(id, { charter });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteDepartment(id: number): Promise<void> {
    try {
      await imb.departments.remove(id);
      if (selectedId === id) setSelectedId(null);
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addMember(
    departmentId: number,
    employeeId: number,
  ): Promise<void> {
    try {
      replaceDepartment(
        await imb.departments.addMember(departmentId, employeeId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removeMember(
    departmentId: number,
    employeeId: number,
  ): Promise<void> {
    try {
      replaceDepartment(
        await imb.departments.removeMember(departmentId, employeeId),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function setMemberParent(
    departmentId: number,
    employeeId: number,
    parentEmployeeId: number,
  ): Promise<void> {
    try {
      replaceDepartment(
        await imb.departments.setMemberParent(
          departmentId,
          employeeId,
          parentEmployeeId,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createEdge(
    fromDeptId: number,
    toDeptId: number,
    fromSide: LinkSide | null,
    dropScreen: Point,
  ): Promise<void> {
    try {
      const toSide = nearestSide(toDeptId, dropScreen);
      await imb.departments.addEdge({
        fromDeptId,
        toDeptId,
        label: "",
        fromSide,
        toSide,
      });
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function createPersonLink(
    fromEmployeeId: number,
    toEmployeeId: number,
  ): Promise<void> {
    try {
      await imb.departments.addPersonLink({
        fromEmployeeId,
        toEmployeeId,
        label: "",
      });
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function deptCenterScreen(id: number): Point | null {
    const d = graphRef.current?.departments.find((x) => x.id === id);
    if (!d) return null;
    const layout = layoutsRef.current.get(id);
    const w = Math.max(layout?.width ?? 0, d.w);
    const h = Math.max(layout?.height ?? 0, d.h);
    return canvasToScreen(
      { x: d.x + w / 2, y: d.y + h / 2 },
      viewportRef.current,
    );
  }

  function personScreen(employeeId: number): Point | null {
    for (const d of graphRef.current?.departments ?? []) {
      const node = layoutsRef.current
        .get(d.id)
        ?.nodes.find((n) => n.employeeId === employeeId);
      if (node) {
        return canvasToScreen(
          { x: d.x + node.x, y: d.y + node.y },
          viewportRef.current,
        );
      }
    }
    return null;
  }

  /** Grab a link's endpoint (or body) to re-point it; a click just opens it. */
  function startReconnect(
    target: ReconnectTarget,
    end: LinkEnd,
    grabScreen: Point,
  ): void {
    const graph = graphRef.current;
    const el = surfaceRef.current;
    if (!graph || !el) return;
    const kind = target.kind;

    let movingEnd: "from" | "to";
    let fixed: Point;
    if (kind === "dept") {
      const edge = graph.edges.find((e) => e.id === target.id);
      if (!edge) return;
      const a = deptCenterScreen(edge.fromDeptId);
      const b = deptCenterScreen(edge.toDeptId);
      if (!a || !b) return;
      movingEnd =
        end === "from"
          ? "from"
          : end === "to"
            ? "to"
            : Math.hypot(grabScreen.x - a.x, grabScreen.y - a.y) <=
                Math.hypot(grabScreen.x - b.x, grabScreen.y - b.y)
              ? "from"
              : "to";
      fixed = movingEnd === "from" ? b : a;
    } else {
      const link = graph.personLinks.find((l) => l.id === target.id);
      if (!link) return;
      const a = personScreen(link.fromEmployeeId);
      const b = personScreen(link.toEmployeeId);
      if (!a || !b) return;
      movingEnd =
        end === "from"
          ? "from"
          : end === "to"
            ? "to"
            : Math.hypot(grabScreen.x - a.x, grabScreen.y - a.y) <=
                Math.hypot(grabScreen.x - b.x, grabScreen.y - b.y)
              ? "from"
              : "to";
      fixed = movingEnd === "from" ? b : a;
    }

    setReconnect({
      kind,
      id: target.id,
      movingEnd,
      fixed,
      start: grabScreen,
      pointer: grabScreen,
    });

    const to = (event: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const onMove = (event: PointerEvent): void => {
      setReconnect((r) => (r ? { ...r, pointer: to(event) } : r));
    };
    const onUp = (event: PointerEvent): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setReconnect(null);
      const drop = to(event);
      const moved = Math.hypot(drop.x - grabScreen.x, drop.y - grabScreen.y);
      const g = graphRef.current;
      if (!g) return;
      if (kind === "dept") {
        const edge = g.edges.find((e) => e.id === target.id);
        if (!edge) return;
        if (moved < 6) {
          setEditing({
            type: "dept",
            entries: [{ id: edge.id, label: edge.label, kind: edge.kind }],
          });
          return;
        }
        const targetId = deptAt(drop, 32);
        if (targetId === null) {
          // Dragged onto empty space → cancel (delete) the link.
          void removeEdgeById(target.id);
          return;
        }
        const fromDeptId = movingEnd === "from" ? targetId : edge.fromDeptId;
        const toDeptId = movingEnd === "to" ? targetId : edge.toDeptId;
        if (fromDeptId === toDeptId) return;
        const newSide = nearestSide(targetId, drop);
        void moveEdgeLink(
          target.id,
          fromDeptId,
          toDeptId,
          movingEnd === "from" ? newSide : edge.fromSide,
          movingEnd === "to" ? newSide : edge.toSide,
        );
      } else {
        const link = g.personLinks.find((l) => l.id === target.id);
        if (!link) return;
        if (moved < 6) {
          setEditing({
            type: "person",
            entries: [{ id: link.id, label: link.label, kind: link.kind }],
          });
          return;
        }
        const empId = personAt(drop);
        if (empId === null) {
          void removePersonLinkById(target.id);
          return;
        }
        const fromEmployeeId =
          movingEnd === "from" ? empId : link.fromEmployeeId;
        const toEmployeeId = movingEnd === "to" ? empId : link.toEmployeeId;
        if (fromEmployeeId === toEmployeeId) return;
        void movePersonLinkLink(target.id, fromEmployeeId, toEmployeeId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** The frame's four port points, box size included. */
  function deptBox(
    deptId: number,
  ): { x: number; y: number; w: number; h: number } | null {
    const d = graphRef.current?.departments.find((x) => x.id === deptId);
    if (!d) return null;
    const layout = layoutsRef.current.get(deptId);
    return {
      x: d.x,
      y: d.y,
      w: layout?.width ?? d.w,
      h: layout?.height ?? d.h,
    };
  }

  /** Which port of a frame is nearest to a screen point. */
  function nearestSide(deptId: number, screen: Point): LinkSide | null {
    const box = deptBox(deptId);
    if (!box) return null;
    const vp = viewportRef.current;
    const candidates: { side: LinkSide; p: Point }[] = [
      { side: "t", p: { x: box.x + box.w / 2, y: box.y } },
      { side: "b", p: { x: box.x + box.w / 2, y: box.y + box.h } },
      { side: "l", p: { x: box.x, y: box.y + box.h / 2 } },
      { side: "r", p: { x: box.x + box.w, y: box.y + box.h / 2 } },
    ];
    let best: LinkSide | null = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const p = canvasToScreen(candidate.p, vp);
      const distance = Math.hypot(p.x - screen.x, p.y - screen.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate.side;
      }
    }
    return best;
  }

  /** Screen point → canvas point. */
  function toCanvas(screen: Point): Point {
    const vp = viewportRef.current;
    return { x: (screen.x - vp.x) / vp.scale, y: (screen.y - vp.y) / vp.scale };
  }

  /** Department whose frame contains a screen point (with a drop tolerance). */
  function deptAt(screen: Point, margin = 0): number | null {
    const c = toCanvas(screen);
    const m = margin / viewportRef.current.scale;
    for (const d of graphRef.current?.departments ?? []) {
      const box = deptBox(d.id);
      if (!box) continue;
      if (
        c.x >= box.x - m &&
        c.x <= box.x + box.w + m &&
        c.y >= box.y - m &&
        c.y <= box.y + box.h + m
      ) {
        return d.id;
      }
    }
    return null;
  }

  /** Member node nearest to a screen point, within a grab radius. */
  function personAt(screen: Point): number | null {
    const c = toCanvas(screen);
    const radius = 40 / viewportRef.current.scale;
    let best: number | null = null;
    let bestDistance = radius;
    for (const d of graphRef.current?.departments ?? []) {
      for (const node of layoutsRef.current.get(d.id)?.nodes ?? []) {
        const nx = d.x + node.x;
        const ny = d.y + node.y;
        const distance = Math.hypot(c.x - nx, c.y - ny);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = node.employeeId;
        }
      }
    }
    return best;
  }

  async function removeEdgeById(id: number): Promise<void> {
    try {
      await imb.departments.removeEdge(id);
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function removePersonLinkById(id: number): Promise<void> {
    try {
      await imb.departments.removePersonLink(id);
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function moveEdgeLink(
    id: number,
    fromDeptId: number,
    toDeptId: number,
    fromSide: LinkSide | null,
    toSide: LinkSide | null,
  ): Promise<void> {
    try {
      await imb.departments.moveEdge(id, {
        fromDeptId,
        toDeptId,
        fromSide,
        toSide,
      });
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function movePersonLinkLink(
    id: number,
    fromEmployeeId: number,
    toEmployeeId: number,
  ): Promise<void> {
    try {
      await imb.departments.movePersonLink(id, {
        fromEmployeeId,
        toEmployeeId,
      });
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveLink(): Promise<void> {
    const group = editing;
    if (!group) return;
    try {
      for (const entry of group.entries) {
        const patch = { label: entry.label, kind: entry.kind };
        if (group.type === "dept") {
          await imb.departments.updateEdge(entry.id, patch);
        } else {
          await imb.departments.updatePersonLink(entry.id, patch);
        }
      }
      setEditing(null);
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteLink(): Promise<void> {
    const group = editing;
    if (!group) return;
    try {
      for (const entry of group.entries) {
        if (group.type === "dept") {
          await imb.departments.removeEdge(entry.id);
        } else {
          await imb.departments.removePersonLink(entry.id);
        }
      }
      setEditing(null);
      await reloadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const employees = useMemo(
    (): Employee[] =>
      data.employees.items.map((employee) => ({
        ...employee,
        mcp: [...employee.mcp],
        skills: [...employee.skills],
      })),
    [data.employees.items],
  );

  const employeeById = useMemo(
    () =>
      new Map(employees.map((employee) => [employee.id, employee] as const)),
    [employees],
  );

  const othersByEmployee = useMemo(() => {
    const map = new Map<number, { id: number; name: string }[]>();
    for (const department of departments) {
      for (const member of department.members) {
        const list = map.get(member.employeeId) ?? [];
        list.push({
          id: department.id,
          name: department.name || t("Unnamed department"),
        });
        map.set(member.employeeId, list);
      }
    }
    return map;
  }, [graph]);

  // Live-working status needs the employee metrics integration, which this
  // self-contained module deliberately does not depend on.
  const workingIds = useMemo(() => new Set<number>(), []);

  const colorById = useMemo(
    () =>
      new Map(
        (graph?.departments ?? []).map((d) => [d.id, colorFor(d)] as const),
      ),
    [graph],
  );

  const activeDeptIds = useMemo(() => {
    const set = new Set<number>();
    if (selectedId !== null) set.add(selectedId);
    if (hoveredDeptId !== null) set.add(hoveredDeptId);
    return set;
  }, [selectedId, hoveredDeptId]);

  const activeEmployees = useMemo(() => {
    const set = new Set<number>();
    if (hoveredEmployeeId !== null) set.add(hoveredEmployeeId);
    return set;
  }, [hoveredEmployeeId]);

  const personPos = useMemo(() => {
    const map = new Map<number, Point>();
    for (const department of departments) {
      for (const node of layouts.get(department.id)?.nodes ?? []) {
        map.set(node.employeeId, {
          x: department.x + node.x,
          y: department.y + node.y,
        });
      }
    }
    return map;
  }, [departments, layouts]);

  const personSize = useMemo(() => {
    const map = new Map<number, { w: number; h: number }>();
    for (const department of departments) {
      for (const node of layouts.get(department.id)?.nodes ?? []) {
        map.set(node.employeeId, { w: node.w, h: node.h });
      }
    }
    return map;
  }, [departments, layouts]);

  const pickerDepartment =
    graph?.departments.find((d) => d.id === pickerDeptId) ?? null;

  useEffect(() => {
    if (fitMemory.done || !graph || graph.departments.length === 0) return;
    if (!surfaceRef.current) return;
    fitMemory.done = true;
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  const content = (
    <div className="imb-dept-module">
      <div className="imb-dept-toolbar">
        <div className="imb-dept-toolbar-left">
          <span className="imb-dept-title">{t("Departments")}</span>
          <span className="imb-dept-subtitle">
            {t("${count} departments · ${people} people", {
              count: String(departments.length),
              people: String(
                new Set(
                  departments.flatMap((d) =>
                    d.members.map((m) => m.employeeId),
                  ),
                ).size,
              ),
            })}
          </span>
        </div>
        <div className="imb-dept-toolbar-right">
          <div className="imb-dept-seg">
            <span className="imb-dept-seglabel">{t("Department links")}</span>
            {PERSON_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={cls(
                  "imb-dept-segbtn",
                  deptMode === mode && "imb-is-on",
                )}
                onClick={() => setDeptMode(mode)}
              >
                {t(PERSON_MODE_LABEL[mode])}
              </button>
            ))}
          </div>
          <div className="imb-dept-seg">
            <span className="imb-dept-seglabel">{t("People links")}</span>
            {PERSON_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={cls(
                  "imb-dept-segbtn",
                  personMode === mode && "imb-is-on",
                )}
                onClick={() => setPersonMode(mode)}
              >
                {t(PERSON_MODE_LABEL[mode])}
              </button>
            ))}
          </div>
          <Button onClick={fitAll}>{t("Focus")}</Button>
          <Button onClick={() => void createDepartment()}>
            {t("New department")}
          </Button>
        </div>
      </div>

      <div
        className={cls(
          "imb-dept-surface",
          (pendingActive || pendingPersonActive || reconnectActive) &&
            "imb-is-linking",
        )}
        ref={attachSurface}
        onPointerDown={beginPan}
      >
        <div
          className="imb-dept-world"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
          }}
        >
          {departments.map((department) => (
            <DepartmentCard
              key={department.id}
              department={department}
              color={colorFor(department)}
              layout={
                layouts.get(department.id) ?? layoutDepartment(department)
              }
              scale={viewport.scale}
              selected={department.id === selectedId}
              employeeById={employeeById}
              othersByEmployee={othersByEmployee}
              workingIds={workingIds}
              onSelect={setSelectedId}
              onPatch={patchLocal}
              onCommit={() => void commitLayout()}
              onRename={(id, name) => void renameDepartment(id, name)}
              onColor={(id, color) => void setDeptColor(id, color)}
              onCharter={(id, charter) => void setDeptCharter(id, charter)}
              onDelete={(id) => void deleteDepartment(id)}
              onOpenMemberPicker={setPickerDeptId}
              onRemoveMember={(id, employeeId) =>
                void removeMember(id, employeeId)
              }
              onSetParent={(id, employeeId, parentId) =>
                void setMemberParent(id, employeeId, parentId)
              }
              onHoverEmployee={setHoveredEmployeeId}
              onHoverDept={setHoveredDeptId}
              onFramePortDown={(id, side, event) => {
                event.stopPropagation();
                event.preventDefault();
                const rect = surfaceRef.current?.getBoundingClientRect();
                startDeptLink(id, side, {
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                });
              }}
              onMemberPortDown={(employeeId, event) => {
                event.stopPropagation();
                event.preventDefault();
                const rect = surfaceRef.current?.getBoundingClientRect();
                startPersonLink(employeeId, {
                  x: event.clientX - (rect?.left ?? 0),
                  y: event.clientY - (rect?.top ?? 0),
                });
              }}
            />
          ))}
        </div>

        <EdgesLayer
          departments={placedDepartments}
          edges={graph?.edges ?? []}
          viewport={viewport}
          pending={pending}
          activeDeptIds={activeDeptIds}
          hoveredEdgeId={hoveredEdgeId}
          onHoverEdge={setHoveredEdgeId}
          labelsAlways={
            deptMode === "all" &&
            !pendingActive &&
            !pendingPersonActive &&
            !reconnectActive
          }
          hiddenEdgeId={
            reconnect && reconnect.kind === "dept" ? reconnect.id : null
          }
          deptColor={(id) => colorById.get(id) ?? "#b5872e"}
          isVisible={(edge: DepartmentEdge) =>
            deptMode === "all" ||
            (deptMode === "hover" &&
              (activeDeptIds.has(edge.fromDeptId) ||
                activeDeptIds.has(edge.toDeptId) ||
                hoveredEdgeId === edge.id))
          }
          onReconnect={startReconnect}
          onEditLabel={(edges: DepartmentEdge[]) => {
            setEditing({
              type: "dept",
              entries: edges.map((e) => ({
                id: e.id,
                label: e.label,
                kind: e.kind,
              })),
            });
          }}
        />

        <PersonLinksLayer
          links={graph?.personLinks ?? []}
          personPos={personPos}
          personSize={personSize}
          viewport={viewport}
          activeEmployees={activeEmployees}
          isVisible={(link: EmployeeLink) =>
            personMode === "all" ||
            (personMode === "hover" &&
              hoveredEmployeeId !== null &&
              (link.fromEmployeeId === hoveredEmployeeId ||
                link.toEmployeeId === hoveredEmployeeId))
          }
          onEditLabel={(links: EmployeeLink[]) => {
            setEditing({
              type: "person",
              entries: links.map((l) => ({
                id: l.id,
                label: l.label,
                kind: l.kind,
              })),
            });
          }}
          onReconnect={startReconnect}
          hiddenLinkId={
            reconnect && reconnect.kind === "person" ? reconnect.id : null
          }
        />

        {reconnect && (
          <svg className="imb-dept-hitlayer" aria-hidden="true">
            <path
              className="imb-dept-wire imb-is-pending"
              d={`M ${reconnect.fixed.x},${reconnect.fixed.y} L ${reconnect.pointer.x},${reconnect.pointer.y}`}
            />
          </svg>
        )}

        {pendingPerson &&
          (() => {
            const from = personScreen(pendingPerson.fromEmployeeId);
            if (!from) return null;
            return (
              <svg className="imb-dept-hitlayer" aria-hidden="true">
                <path
                  className="imb-dept-wire imb-is-pending"
                  d={`M ${from.x},${from.y} L ${pendingPerson.to.x},${pendingPerson.to.y}`}
                />
              </svg>
            );
          })()}

        {loading && !graph && (
          <div className="imb-dept-overlay">{t("Loading…")}</div>
        )}
        {graph && graph.departments.length === 0 && !loading && (
          <div className="imb-dept-overlay">
            {t("No departments yet. Create one to start.")}
          </div>
        )}

        <div
          className="imb-dept-zoom"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={t("Zoom out")}
            onClick={() => zoomBy(1 / 1.2)}
          >
            −
          </button>
          <button
            type="button"
            aria-label={t("Reset view")}
            onClick={() => setViewport(DEFAULT_VIEWPORT)}
          >
            {Math.round(viewport.scale * 100)}%
          </button>
          <button
            type="button"
            aria-label={t("Zoom in")}
            onClick={() => zoomBy(1.2)}
          >
            ＋
          </button>
        </div>

        <div className="imb-dept-legend">
          <span>
            <span className="imb-legend-arrow">→</span>
            {t("Link · one color")}
          </span>
          <span>
            <span className="imb-legend-kind" />
            {t("Frame hierarchy")}
          </span>
        </div>

        <div className="imb-dept-hint">
          {t(
            "Drag empty space to pan · scroll to zoom · drag a frame's edge dot to link departments · drag a person's dot to link people",
          )}
        </div>
      </div>

      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}

      <MemberPicker
        departmentId={pickerDeptId}
        departmentName={pickerDepartment?.name ?? ""}
        employees={employees}
        existingIds={pickerDepartment?.members.map((m) => m.employeeId) ?? []}
        onClose={() => setPickerDeptId(null)}
        onAdd={(employeeId) => {
          if (pickerDeptId !== null) void addMember(pickerDeptId, employeeId);
        }}
      />

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("Link")}
        actions={
          <>
            <Button variant="danger" onClick={() => void deleteLink()}>
              {t("Delete link")}
            </Button>
            <Button onClick={() => void saveLink()}>{t("Save")}</Button>
          </>
        }
      >
        <div className="imb-dept-linkform">
          {(editing?.entries ?? []).map((entry, index) => (
            <div className="imb-dept-linkentry" key={entry.id}>
              <div className="imb-dept-kinds">
                {LINK_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={cls(
                      "imb-dept-kindbtn",
                      entry.kind === kind && "imb-is-on",
                    )}
                    style={
                      {
                        "--kind-color": KIND_STYLE[kind].color,
                      } as React.CSSProperties
                    }
                    onClick={() =>
                      setEditing((current) =>
                        current
                          ? {
                              ...current,
                              entries: current.entries.map((e, i) =>
                                i === index ? { ...e, kind } : e,
                              ),
                            }
                          : current,
                      )
                    }
                  >
                    {t(KIND_LABEL[kind])}
                  </button>
                ))}
              </div>
              <input
                className="imb-dept-edge-input"
                value={entry.label}
                maxLength={120}
                autoFocus={index === 0}
                placeholder={t("Label (optional)")}
                aria-label={t("Link label")}
                onChange={(event) =>
                  setEditing((current) =>
                    current
                      ? {
                          ...current,
                          entries: current.entries.map((e, i) =>
                            i === index
                              ? { ...e, label: event.target.value }
                              : e,
                          ),
                        }
                      : current,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveLink();
                  }
                }}
              />
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );

  return <ModuleView content={content} />;
}

/** Display name for each generic link kind. */
const KIND_LABEL: Record<LinkKind, string> = {
  collab: "Collaboration",
  depend: "Dependency",
  report: "Reporting",
  ref: "Reference",
};
