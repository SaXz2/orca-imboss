import { t } from "@shared/l10n";
import type { Department, Employee, LinkSide } from "@shared/types";
import { useState } from "react";
import { cls } from "reactutils";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from "../../../context-menu";
import { EmployeeAvatar } from "../../../employee-avatar";
import type { DeptLayout } from "./layout";
import "./index.css";

/** Per-person avatar tint, so members read as distinct at a glance. */
const PERSON_PALETTE = [
  "#e64980",
  "#3b6ef5",
  "#22b573",
  "#f0921f",
  "#8a63d2",
  "#1098ad",
  "#c0512f",
];

/** Swatches offered when editing a department's color. */
const DEPT_SWATCHES = [
  "#e64980",
  "#3b6ef5",
  "#22b573",
  "#f0921f",
  "#8a63d2",
  "#1098ad",
  "#9b8b73",
];

export interface DepartmentCardProps {
  department: Department;
  color: string;
  layout: DeptLayout;
  scale: number;
  selected: boolean;
  employeeById: Map<number, Employee>;
  /** Employee id → the *other* departments they also belong to. */
  othersByEmployee: Map<number, { id: number; name: string }[]>;
  workingIds: Set<number>;
  onSelect: (id: number) => void;
  onPatch: (id: number, patch: Partial<Department>) => void;
  onCommit: () => void;
  onRename: (id: number, name: string) => void;
  onColor: (id: number, color: string) => void;
  onDelete: (id: number) => void;
  onOpenMemberPicker: (id: number) => void;
  onRemoveMember: (departmentId: number, employeeId: number) => void;
  onSetParent: (
    departmentId: number,
    employeeId: number,
    parentEmployeeId: number,
  ) => void;
  onFramePortDown: (
    id: number,
    side: LinkSide,
    event: React.PointerEvent,
  ) => void;
  onMemberPortDown: (employeeId: number, event: React.PointerEvent) => void;
  onHoverEmployee: (employeeId: number | null) => void;
  onHoverDept: (id: number | null) => void;
}

/**
 * One department frame: a soft card whose members form a top-down forest
 * (multiple peers at the top, each above its own subtree). The grip drags the
 * frame, the corner resizes width, edge ports link departments, a member's port
 * links people, and dragging a member card onto another sets the reporting line.
 */
export function DepartmentCard({
  department,
  color,
  layout,
  scale,
  selected,
  employeeById,
  othersByEmployee,
  workingIds,
  onSelect,
  onPatch,
  onCommit,
  onRename,
  onColor,
  onDelete,
  onOpenMemberPicker,
  onRemoveMember,
  onSetParent,
  onFramePortDown,
  onMemberPortDown,
  onHoverEmployee,
  onHoverDept,
}: DepartmentCardProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const pool = department.kind === "pool";

  function beginDrag(event: React.PointerEvent): void {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const orig = { x: department.x, y: department.y };
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - startX) / scale;
      const dy = (move.clientY - startY) / scale;
      onPatch(department.id, { x: orig.x + dx, y: orig.y + dy });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginNodeDrag(event: React.PointerEvent, employeeId: number): void {
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const onUp = (up: PointerEvent): void => {
      window.removeEventListener("pointerup", onUp);
      if (Math.hypot(up.clientX - startX, up.clientY - startY) < 6) return;
      const el = document
        .elementFromPoint(up.clientX, up.clientY)
        ?.closest?.(".imb-dept-mc") as HTMLElement | null;
      if (!el) return;
      const targetId = Number(el.getAttribute("data-emp-id"));
      const targetDept = Number(el.getAttribute("data-dept-id"));
      if (
        Number.isSafeInteger(targetId) &&
        targetId !== employeeId &&
        targetDept === department.id
      ) {
        onSetParent(department.id, employeeId, targetId);
      }
    };
    window.addEventListener("pointerup", onUp);
  }

  /** Resize the frame from a corner (dx/dy drive the two axes; left/top corners also move the origin). */
  function beginResize(
    event: React.PointerEvent,
    sx: -1 | 1,
    sy: -1 | 1,
  ): void {
    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const minW = layout.width;
    const minH = layout.height;
    const orig = {
      x: department.x,
      y: department.y,
      w: Math.max(minW, department.w),
      h: Math.max(minH, department.h),
    };
    const onMove = (move: PointerEvent): void => {
      const dx = (move.clientX - startX) / scale;
      const dy = (move.clientY - startY) / scale;
      let x = orig.x;
      let w: number;
      if (sx < 0) {
        w = orig.w - dx;
        if (w < minW) {
          x = orig.x + (orig.w - minW);
          w = minW;
        } else {
          x = orig.x + dx;
        }
      } else {
        w = Math.max(minW, orig.w + dx);
      }
      let y = orig.y;
      let h: number;
      if (sy < 0) {
        h = orig.h - dy;
        if (h < minH) {
          y = orig.y + (orig.h - minH);
          h = minH;
        } else {
          y = orig.y + dy;
        }
      } else {
        h = Math.max(minH, orig.h + dy);
      }
      onPatch(department.id, { x, y, w, h });
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onCommit();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function commitRename(): void {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== department.name) onRename(department.id, next);
  }

  function openMenu(event: React.MouseEvent): void {
    event.stopPropagation();
    const items: ContextMenuItem[] = [
      {
        key: "add",
        label: t("Add member"),
        onSelect: () => onOpenMemberPicker(department.id),
      },
      {
        key: "rename",
        label: t("Rename"),
        onSelect: () => {
          setDraft(department.name);
          setEditing(true);
        },
      },
      {
        key: "delete",
        label: t("Delete department"),
        danger: true,
        onSelect: () => onDelete(department.id),
      },
    ];
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  return (
    <div
      className={cls(
        "imb-dept-card",
        pool && "imb-is-pool",
        selected && "imb-is-selected",
      )}
      style={
        {
          left: department.x,
          top: department.y,
          width: layout.width,
          height: layout.height,
          "--dept-color": color,
        } as React.CSSProperties
      }
      data-dept-id={department.id}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect(department.id);
      }}
      onPointerEnter={() => onHoverDept(department.id)}
      onPointerLeave={() => onHoverDept(null)}
    >
      {selected && (
        <>
          <button
            type="button"
            className="imb-dept-hnd imb-is-tl"
            aria-label={t("Resize")}
            onPointerDown={(event) => beginResize(event, -1, -1)}
          />
          <button
            type="button"
            className="imb-dept-hnd imb-is-tr"
            aria-label={t("Resize")}
            onPointerDown={(event) => beginResize(event, 1, -1)}
          />
          <button
            type="button"
            className="imb-dept-hnd imb-is-bl"
            aria-label={t("Resize")}
            onPointerDown={(event) => beginResize(event, -1, 1)}
          />
          <button
            type="button"
            className="imb-dept-hnd imb-is-br"
            aria-label={t("Resize")}
            onPointerDown={(event) => beginResize(event, 1, 1)}
          />
        </>
      )}

      <div className="imb-dept-head" onPointerDown={(e) => beginDrag(e)}>
        <span className="imb-dept-grip" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <button
          type="button"
          className="imb-dept-dot"
          title={t("Change color")}
          aria-label={t("Change color")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setPaletteOpen((open) => !open);
          }}
        />
        {paletteOpen && (
          <span
            className="imb-dept-palette"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {DEPT_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="imb-dept-swatch"
                style={{ background: swatch }}
                onClick={(event) => {
                  event.stopPropagation();
                  onColor(department.id, swatch);
                  setPaletteOpen(false);
                }}
              />
            ))}
          </span>
        )}
        {editing ? (
          <input
            className="imb-dept-name-input"
            value={draft}
            autoFocus
            maxLength={200}
            aria-label={t("Department name")}
            onChange={(event) => setDraft(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="imb-dept-name"
            title={t("Double-click to rename")}
            onDoubleClick={() => {
              setDraft(department.name);
              setEditing(true);
            }}
          >
            {department.name || t("Unnamed department")}
          </span>
        )}
        <span className="imb-dept-count">
          {t("${count} people", { count: String(department.members.length) })}
        </span>
        {!pool && (
          <button
            type="button"
            className="imb-dept-addbtn"
            title={t("Add member")}
            aria-label={t("Add member")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpenMemberPicker(department.id);
            }}
          >
            ＋
          </button>
        )}
        {!pool && (
          <button
            type="button"
            className="imb-dept-more"
            title={t("More")}
            aria-label={t("More")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={openMenu}
          >
            ⋯
          </button>
        )}
      </div>

      <svg
        className="imb-dept-tree"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="imb-tree-arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="2.5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M0,0 L5,2.5 L0,5"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.3"
            />
          </marker>
        </defs>
        {layout.paths.map((d, index) => (
          <path
            key={index}
            className="imb-dept-bk"
            d={d}
            markerEnd="url(#imb-tree-arrow)"
          />
        ))}
      </svg>

      {layout.nodes.map((node) => {
        const member = department.members.find(
          (m) => m.employeeId === node.employeeId,
        );
        const employee = employeeById.get(node.employeeId);
        const others = (othersByEmployee.get(node.employeeId) ?? []).filter(
          (other) => other.id !== department.id,
        );
        const working = workingIds.has(node.employeeId);
        const tint =
          PERSON_PALETTE[Math.abs(node.employeeId) % PERSON_PALETTE.length];
        const role = member?.roleInDept || employee?.role || "";
        return (
          <div
            className={cls("imb-dept-mc", node.root && "imb-is-peer")}
            key={node.employeeId}
            style={
              {
                left: node.x,
                top: node.y,
                "--pc": tint,
              } as React.CSSProperties
            }
            data-emp-id={node.employeeId}
            data-dept-id={department.id}
            title={employee?.name}
            onPointerDown={(event) => {
              if (pool) event.stopPropagation();
              else beginNodeDrag(event, node.employeeId);
            }}
            onPointerEnter={(event) => {
              event.stopPropagation();
              onHoverEmployee(node.employeeId);
            }}
            onPointerLeave={() => onHoverEmployee(null)}
          >
            <span className="imb-dept-avwrap">
              <EmployeeAvatar
                employeeId={node.employeeId}
                size={node.root ? 36 : 30}
                className="imb-dept-av2"
              />
              <span
                className={cls("imb-dept-mstate", working && "imb-is-on")}
              />
              <button
                type="button"
                className="imb-dept-mport imb-is-l"
                title={t("Drag to link another person")}
                aria-label={t("Drag to link another person")}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onMemberPortDown(node.employeeId, event);
                }}
              />
            </span>
            <span className="imb-dept-tx">
              <span className="imb-dept-l1">
                <span className="imb-dept-nm">
                  {employee?.name || `#${node.employeeId}`}
                </span>
                {member?.isLead && (
                  <span className="imb-dept-pill">{t("Lead")}</span>
                )}
                {others.length > 0 && (
                  <span className="imb-dept-pill imb-is-also">
                    {t("Also in ${names}", {
                      names: others.map((other) => other.name).join("、"),
                    })}
                  </span>
                )}
              </span>
              {role && <span className="imb-dept-role">{role}</span>}
            </span>
            {!pool && (
              <button
                type="button"
                className="imb-dept-mremove"
                title={t("Remove from department")}
                aria-label={t("Remove from department")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveMember(department.id, node.employeeId);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="imb-dept-port imb-port-t"
        title={t("Drag to link another department")}
        aria-label={t("Drag to link another department")}
        onPointerDown={(event) => onFramePortDown(department.id, "t", event)}
      />
      <button
        type="button"
        className="imb-dept-port imb-port-b"
        title={t("Drag to link another department")}
        aria-label={t("Drag to link another department")}
        onPointerDown={(event) => onFramePortDown(department.id, "b", event)}
      />
      <button
        type="button"
        className="imb-dept-port imb-port-l"
        title={t("Drag to link another department")}
        aria-label={t("Drag to link another department")}
        onPointerDown={(event) => onFramePortDown(department.id, "l", event)}
      />
      <button
        type="button"
        className="imb-dept-port imb-port-r"
        title={t("Drag to link another department")}
        aria-label={t("Drag to link another department")}
        onPointerDown={(event) => onFramePortDown(department.id, "r", event)}
      />
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
