import { employeeColor } from "@shared/constants/employee-colors";
import { t } from "@shared/l10n";
import type { Department, EmployeeMetric, StatDaily } from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { employeeLabel } from "../../../../employee-label";
import { ModuleView } from "../../../app-shell";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconCheck } from "../../../icons";
import { formatDuration } from "../../chat/relative-time";
import "./index.css";

/**
 * Usage — where the team's working time went. Aggregates the same live metrics
 * the employees list uses (work hours, messages, deliverables, board tasks)
 * into one ranked ledger, so the assistant's cost of running is legible.
 */

interface UsageRow {
  id: number;
  label: string;
  color: string;
  hoursMs: number;
  messages: number;
  reports: number;
  pending: number;
  running: number;
  done: number;
}

export function UsageModule(): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;

  const [metrics, setMetrics] = useState<Map<number, EmployeeMetric>>(
    new Map(),
  );
  const [departments, setDepartments] = useState<Department[]>([]);
  const [stats, setStats] = useState<StatDaily[]>([]);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const list = await imb.employees.metrics();
      setMetrics(new Map(list.map((m) => [m.employeeId, m])));
    } catch {
      // Best-effort: keep the last snapshot.
    }
  }, []);

  useEffect(() => {
    void appStore.reloadEmployees();
    void reload();
    void imb.departments
      .graph()
      .then((graph) => setDepartments(graph.departments))
      .catch(() => undefined);
    void imb.stats
      .list()
      .then(setStats)
      .catch(() => undefined);
    const off = imb.employees.onActivity(() => void reload());
    const timer = window.setInterval(() => void reload(), 5000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [reload]);

  // Persistent per-employee totals from the daily rollup (survive chat
  // deletion); messages/reports/hours come from here, tasks stay live.
  const statTotals = useMemo(() => {
    const map = new Map<
      number,
      { runMs: number; messages: number; reports: number }
    >();
    for (const s of stats) {
      const cur = map.get(s.employeeId) ?? {
        runMs: 0,
        messages: 0,
        reports: 0,
      };
      cur.runMs += s.runMs;
      cur.messages += s.messages;
      cur.reports += s.reports;
      map.set(s.employeeId, cur);
    }
    return map;
  }, [stats]);

  const rows = useMemo<UsageRow[]>(() => {
    return employees
      .map((employee) => {
        const metric = metrics.get(employee.id);
        const st = statTotals.get(employee.id);
        return {
          id: employee.id,
          label: employeeLabel(employee),
          color: employeeColor(employee.id),
          hoursMs: st?.runMs ?? metric?.totalRunMs ?? 0,
          messages: st?.messages ?? metric?.messages ?? 0,
          reports: st?.reports ?? metric?.reports ?? 0,
          pending: metric?.tasks.pending ?? 0,
          running: metric?.tasks.running ?? 0,
          done: metric?.tasks.done ?? 0,
        };
      })
      .sort((a, b) => b.hoursMs - a.hoursMs || b.messages - a.messages);
  }, [employees, metrics, statTotals]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => ({
        hoursMs: acc.hoursMs + row.hoursMs,
        messages: acc.messages + row.messages,
        reports: acc.reports + row.reports,
        done: acc.done + row.done,
      }),
      { hoursMs: 0, messages: 0, reports: 0, done: 0 },
    );
  }, [rows]);

  const maxHours = Math.max(1, ...rows.map((r) => r.hoursMs));

  // Per-department performance: output (done + reports) vs worked hours. A
  // person in several departments counts toward each; the ratio is output per
  // hour, shown only once there is enough time to be meaningful.
  const deptRows = useMemo(() => {
    return departments
      .map((d) => {
        let output = 0;
        let hoursMs = 0;
        for (const m of d.members) {
          const st = statTotals.get(m.employeeId);
          const metric = metrics.get(m.employeeId);
          output += (st?.reports ?? 0) + (metric?.tasks.done ?? 0);
          hoursMs += st?.runMs ?? 0;
        }
        return {
          id: d.id,
          name: d.name || t("Unnamed department"),
          color: deptColor(d),
          output,
          hoursMs,
        };
      })
      .sort((a, b) => b.output - a.output || a.id - b.id);
  }, [departments, metrics, statTotals]);

  const content = (
    <>
      <div className="imb-chat-header imb-usage-head">
        <div className="imb-usage-head-text">
          <div className="imb-chat-title">{t("Usage")}</div>
          <div className="imb-usage-sub">
            {t("Where the team's working time went.")}
          </div>
        </div>
      </div>

      <div className="imb-usage">
        <div className="imb-usage-stats">
          <StatCard
            label={t("Total hours")}
            value={formatDuration(totals.hoursMs)}
          />
          <StatCard
            label={t("Messages")}
            value={t("${count}", { count: String(totals.messages) })}
          />
          <StatCard
            label={t("Deliverables")}
            value={t("${count}", { count: String(totals.reports) })}
          />
          <StatCard
            label={t("Completed tasks")}
            value={t("${count}", { count: String(totals.done) })}
          />
        </div>

        <div className="imb-usage-list">
          {rows.map((row, index) => (
            <UsageRowView
              key={row.id}
              rank={index + 1}
              row={row}
              share={row.hoursMs / maxHours}
            />
          ))}
          {rows.length === 0 && (
            <div className="imb-usage-empty">{t("No employees yet")}</div>
          )}
        </div>

        {deptRows.length > 0 && (
          <>
            <div className="imb-usage-section-title">
              {t("Department performance")}
            </div>
            <div className="imb-usage-list">
              {deptRows.map((row, index) => (
                <div className="imb-usage-row" key={row.id}>
                  <span className="imb-usage-rank">{index + 1}</span>
                  <span className="imb-usage-person">
                    <span
                      className="imb-usage-name"
                      style={{ color: row.color }}
                    >
                      {row.name}
                    </span>
                  </span>
                  <span className="imb-usage-states">
                    <span
                      className="imb-emp-state imb-state-done"
                      title={t("Output")}
                    >
                      <IconCheck className="imb-icon imb-xs" />
                      {row.output}
                    </span>
                    <span className="imb-emp-state imb-emp-hours">
                      {t("Hours")} {formatDuration(row.hoursMs)}
                    </span>
                    <span className="imb-emp-state">
                      {t("Value")}{" "}
                      {row.hoursMs >= 360_000
                        ? (row.output / (row.hoursMs / 3_600_000)).toFixed(1)
                        : "—"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );

  return <ModuleView content={content} />;
}

/** Department badge color (stored color, else the palette). */
function deptColor(d: Department): string {
  if (d.color) return d.color;
  if (d.kind === "pool") return "#9b8b73";
  const palette = [
    "#e64980",
    "#4c6ef5",
    "#0ca678",
    "#f59f00",
    "#7950f2",
    "#1098ad",
  ];
  return palette[d.id % palette.length];
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className="imb-usage-stat">
      <div className="imb-usage-stat-value">{value}</div>
      <div className="imb-usage-stat-label">{label}</div>
    </div>
  );
}

function UsageRowView({
  rank,
  row,
  share,
}: {
  rank: number;
  row: UsageRow;
  share: number;
}): React.JSX.Element {
  return (
    <div className="imb-usage-row">
      <span className="imb-usage-rank">{rank}</span>

      <button
        type="button"
        className="imb-usage-person"
        title={t("See ${name}'s tasks", { name: row.label })}
        onClick={() => void appStore.focusEmployee(row.id)}
      >
        <EmployeeAvatar employeeId={row.id} size={28} />

        <span className="imb-usage-id">
          <span className="imb-usage-name" style={{ color: row.color }}>
            {row.label}
          </span>
          <span className="imb-usage-meta">
            {t("${count} messages", { count: String(row.messages) })}
            {" · "}
            {t("${count} deliverables", { count: String(row.reports) })}
          </span>
        </span>
      </button>

      <span className="imb-usage-states">
        <span className="imb-emp-state imb-state-done" title={t("Done")}>
          <IconCheck className="imb-icon imb-xs" />
          {row.done}
        </span>
        <span
          className="imb-emp-state imb-state-running"
          title={t("In progress")}
        >
          {row.running}
        </span>
        <span className="imb-emp-state imb-state-pending" title={t("Pending")}>
          {row.pending}
        </span>
      </span>

      <span className="imb-usage-bar" aria-hidden="true">
        <span
          className="imb-usage-bar-fill"
          style={{
            width: `${Math.round(share * 100)}%`,
            background: row.color,
          }}
        />
      </span>

      <span className="imb-usage-hours">{formatDuration(row.hoursMs)}</span>
    </div>
  );
}
