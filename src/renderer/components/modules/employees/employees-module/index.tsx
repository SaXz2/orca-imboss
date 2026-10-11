import {
  BUILTIN_REMOVE_CRON_MARKER,
  BUILTIN_SET_CRON_MARKER,
} from "@shared/constants/agent_tools";
import { getLocale, t } from "@shared/l10n";
import type { Employee, EmployeeInput, EmployeeMetric } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { useMultiSelect } from "../../../../hooks/use-multi-select";
import { formatChatTime, previewText } from "../../chat/relative-time";
import { ModuleView } from "../../../app-shell";
import { Button } from "../../../button";
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuState,
} from "../../../context-menu";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconCheck } from "../../../icons";
import { ItemList } from "../../../item-list";
import { ListPane } from "../../../list-pane";
import { ListRow } from "../../../list-row";
import { Modal } from "../../../modal";
import "../../../modules/module-common.css";
import "./index.css";
import type { MultiSelectOption } from "../../../multi-select";
import { SearchInput } from "../../../search-input";
import { EmployeeDetail } from "../employee-detail";
import { EmployeeRecruitModal } from "../employee-recruit-modal";

/** Compact duration label: 45s / 12m / 1h20m. */
function formatDuration(ms: number): string {
  const secs = Math.max(0, Math.floor(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

export function EmployeesModule(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [recruitOpen, setRecruitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteIds, setDeleteIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  const { data } = useApp();
  const loading = data.employees.loading;
  const listError = data.employees.error;
  const locale = getLocale();

  // Live per-employee metrics (working status, run time, activity, output).
  const [metrics, setMetrics] = useState<Map<number, EmployeeMetric>>(
    () => new Map(),
  );
  const reloadMetrics = useCallback(async (): Promise<void> => {
    try {
      const list = await imb.employees.metrics();
      setMetrics(new Map(list.map((m) => [m.employeeId, m])));
    } catch {
      // Best-effort: metrics are non-critical; keep the last snapshot.
    }
  }, []);

  useEffect(() => {
    void reloadMetrics();
    const off = imb.employees.onActivity(() => void reloadMetrics());
    // Poll while mounted so the live "elapsed" time keeps ticking.
    const timer = window.setInterval(() => void reloadMetrics(), 5000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [reloadMetrics]);

  // Centralized in appStore (loaded once at startup); filter client-side.
  const employees = useMemo((): Employee[] => {
    // Valtio snapshot elements are deeply readonly; clone the nested ref
    // arrays into mutable copies so they satisfy the Employee type.
    const source = data.employees.items.map((employee) => ({
      ...employee,
      mcp: [...employee.mcp],
      skills: [...employee.skills],
    }));
    const needle = query.trim().toLowerCase();
    if (!needle) return source;
    return source.filter(
      (employee) =>
        employee.name.toLowerCase().includes(needle) ||
        employee.role.toLowerCase().includes(needle),
    );
  }, [data.employees.items, query]);

  // Model options still come via IPC (models out of scope); loaded once.
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  useEffect(() => {
    void imb.models
      .list()
      .then((models) =>
        setModelOptions(models.map((m) => `${m.provider}/${m.id}`)),
      )
      .catch(() => {
        // Best-effort: model selects stay empty on failure.
      });
  }, []);

  // Re-fetch on every entry (best-effort): employees can be changed by the
  // agent with no renderer event, and the editor's MCP/skill option selects
  // must reflect the current backend state.
  useEffect(() => {
    void appStore.reloadEmployees();
    void appStore.reloadMcp();
    void appStore.reloadSkills();
  }, []);

  // Linked-MCP options = built-in opt-in cron tools + configured MCP servers.
  const mcpOptions = useMemo((): MultiSelectOption[] => {
    return [
      { value: BUILTIN_SET_CRON_MARKER, label: t("Set cron job") },
      { value: BUILTIN_REMOVE_CRON_MARKER, label: t("Remove cron job") },
      ...data.mcp.items.map((m) => ({ value: m.name, label: m.name })),
    ];
  }, [data.mcp.items]);

  const multi = useMultiSelect<Employee, number>({
    getKey: (employee) => employee.id,
    items: employees,
    onActivate: (employee) => setSelectedId(employee.id),    // The built-in assistant is always pinned but never selectable; bulk
    // actions and "Select all" must not be able to reach it.
    isSelectable: (employee) => employee.id !== 0,
  });
  const clearSelection = multi.clear;

  /** Open an employee's daily agent session ("private chat") in its latest chat. */
  const openEmployeeSession = useCallback(
    async (employeeId: number): Promise<void> => {
      try {
        const chatId = await imb.chats.latestForEmployee(employeeId);
        if (chatId === null) return;
        await appStore.openAgentSession(employeeId, chatId);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // Query changes reset the selection.
  useEffect(() => {
    clearSelection();
  }, [clearSelection, query]);

  // Auto-select the first employee after page 1 loads (and recover when the
  // selected employee disappears, e.g. bulk delete).
  useEffect(() => {
    if (loading) return;
    if (employees.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((current) =>
      current !== null && employees.some((employee) => employee.id === current)
        ? current
        : employees[0].id,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, loading]);

  const selected =
    employees.find((employee) => employee.id === selectedId) ?? null;

  const patch = useCallback(
    async (id: number, input: EmployeeInput): Promise<boolean> => {
      try {
        const updated = await imb.employees.update(id, input);
        if (updated) appStore.replaceEmployee(updated);
        setError(null);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [],
  );

  const create = useCallback(
    async (input: EmployeeInput): Promise<Employee | null> => {
      try {
        const created = await imb.employees.create(input);
        // Newest id sorts last (id ASC) — append so it is immediately visible.
        appStore.addEmployee(created);
        setSelectedId(created.id);
        setError(null);
        return created;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: number): Promise<void> => {
    try {
      const removed = await imb.employees.remove(id);
      if (removed) appStore.removeEmployee(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const deleteSelected = useCallback(async (): Promise<void> => {
    const ids = deleteIds.filter((id) => id !== 0);
    if (ids.length === 0) return;
    try {
      setDeleteOpen(false);
      for (const id of ids) {
        await imb.employees.remove(id);
        appStore.removeEmployee(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [deleteIds]);

  const toggleSelectAll = useCallback((): void => {
    // Compare against selectable rows only (the assistant is never selectable,
    // so counting every loaded row would break the toggle-to-clear branch).
    const selectableCount = employees.filter(
      (employee) => employee.id !== 0,
    ).length;
    if (multi.selectedKeys.size === selectableCount && selectableCount > 0) {
      multi.clear();
    } else {
      multi.selectAll();
    }
  }, [multi, employees]);

  const listPane = (
    <ListPane
      title={t("Employees")}
      search={
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("Filter by name or role")}
        />
      }
      footer={
        <Button block onClick={() => setRecruitOpen(true)}>
          {t("Recruit")}
        </Button>
      }
    >
      <ItemList
        items={employees}
        getItemKey={(employee) => employee.id}
        loading={loading}
        loadError={listError}
        selectable
        selectedKeys={multi.selectedKeys}
        onItemClick={(employee, index, mods) =>
          multi.onItemClick(employee, index, mods)
        }
        renderItem={(employee, { selected: isSelectedRow }) => {
          const metric = metrics.get(employee.id);
          const working = metric?.working ?? false;
          return (
          <ListRow
            active={employee.id === selectedId}
            selected={isSelectedRow}
            avatar={
              <span
                className="imb-emp-avatar-hit"
                title={t("Double-click to open private chat")}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  void openEmployeeSession(employee.id);
                }}
              >
                <EmployeeAvatar employeeId={employee.id} alt />
              </span>
            }
            name={employee.name || t("Unnamed")}
            meta={`#${employee.id}`}
            sub={employee.role || "—"}
            badge={
              working ? (
                <span className="imb-badge imb-badge-live">
                  <span className="imb-live-dot" aria-hidden="true" />
                  {t("Working")}
                </span>
              ) : employee.id === 0 ? (
                <span className="imb-badge">{t("Built-in")}</span>
              ) : undefined
            }
            extra={
              metric ? (
                <span className="imb-emp-stats">
                  <span
                    className="imb-emp-state imb-state-done"
                    title={t("Done")}
                  >
                    <IconCheck className="imb-icon imb-xs" />
                    {metric.tasks.done}
                  </span>
                  <span
                    className="imb-emp-state imb-state-running"
                    title={t("In progress")}
                  >
                    {metric.tasks.running}
                  </span>
                  <span
                    className="imb-emp-state imb-state-pending"
                    title={t("Pending")}
                  >
                    {metric.tasks.pending}
                  </span>
                  <span className="imb-emp-stat imb-emp-hours">
                    {t("Hours: ${time}", {
                      time: formatDuration(
                        working ? metric.currentRunMs : metric.totalRunMs,
                      ),
                    })}
                  </span>
                  {metric.lastAt !== null && (
                    <span
                      className="imb-emp-stat imb-emp-last"
                      title={metric.lastText ?? ""}
                    >
                      {formatChatTime(metric.lastAt, locale)}
                      {metric.lastText
                        ? ` · ${previewText(metric.lastText, 18)}`
                        : ""}
                    </span>
                  )}
                </span>
              ) : undefined
            }
            onContextMenu={(e) => {
              e.preventDefault();
              const items: ContextMenuItem[] = [
                {
                  key: "dm",
                  label: t("Private chat"),
                  onSelect: () => void openEmployeeSession(employee.id),
                },
                {
                  key: "select-all",
                  label: t("Select all"),
                  onSelect: toggleSelectAll,
                },
              ];
              if (employee.id !== 0) {
                items.push({
                  key: "delete",
                  label: t("Delete"),
                  danger: true,
                  onSelect: () => {
                    // Selection-aware: a right-click on an already-selected
                    // row deletes the whole selection; otherwise it deletes
                    // just the right-clicked employee (never a hidden
                    // select-all).
                    setDeleteIds(
                      multi.selectedKeys.has(employee.id)
                        ? [...multi.selectedKeys]
                        : [employee.id],
                    );
                    setDeleteOpen(true);
                  },
                });
              }
              setCtxMenu({ x: e.clientX, y: e.clientY, items });
            }}
          />
          );
        }}
      />
    </ListPane>
  );

  const detail = selected ? (
    <EmployeeDetail
      key={selected.id}
      employee={selected}
      mcpOptions={mcpOptions}
      skillOptions={data.skills.items.map((s) => ({
        value: s.name,
        label: s.name,
      }))}
      modelOptions={modelOptions.map((m) => ({ value: m, label: m }))}
      onPatch={(input) => patch(selected.id, input)}
      onRemove={() => void remove(selected.id)}
      onAvatarUpdated={(employee) => appStore.replaceEmployee(employee)}
    />
  ) : null;

  return (
    <>
      <ModuleView list={listPane} detail={detail} />
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("Delete employees")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button variant="danger" onClick={() => void deleteSelected()}>
              {t("Delete")}
            </Button>
          </>
        }
      >
        <p className="imb-module-note">
          {t(
            "The employee's conversation records will also be cleared. This cannot be undone.",
          )}
        </p>
      </Modal>
      <EmployeeRecruitModal
        open={recruitOpen}
        onClose={() => setRecruitOpen(false)}
        mcpOptions={mcpOptions}
        skillOptions={data.skills.items.map((s) => ({
          value: s.name,
          label: s.name,
        }))}
        modelOptions={modelOptions.map((m) => ({ value: m, label: m }))}
        onCreate={create}
      />
      {error !== null && (
        <p className="imb-error-text imb-module-error">{error}</p>
      )}
    </>
  );
}
