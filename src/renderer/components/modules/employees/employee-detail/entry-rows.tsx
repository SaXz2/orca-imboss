import { t } from "@shared/l10n";
import type { EmployeeMetric } from "@shared/types";
import { useEffect, useState } from "react";import { appStore } from "../../../../app-store";
import { IconChevronDown, IconClock, IconMemory, IconUsage } from "../../../icons";
import { formatDuration } from "../../chat/relative-time";
import { EmployeeMemoryModal } from "./memory-modal";

/**
 * The three quick entries that sit under an employee's card: what it remembers,
 * how much it has been used, and what it is scheduled to do. Each shows a live
 * one-line summary and opens the thing it summarises.
 */
export function EmployeeEntryRows({
  employeeId,
  employeeName,
}: {
  employeeId: number;
  employeeName: string;
}): React.JSX.Element {
  const [metric, setMetric] = useState<EmployeeMetric | null>(null);
  const [memory, setMemory] = useState<string>("");
  const [cronCount, setCronCount] = useState<number | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [metrics, memoryText, jobs] = await Promise.all([
        imb.employees.metrics().catch(() => [] as EmployeeMetric[]),
        imb.employees.getMemory(employeeId).catch(() => ""),
        imb.cron.listByEmployee(employeeId).catch(() => []),
      ]);
      if (!alive) return;
      setMetric(metrics.find((m) => m.employeeId === employeeId) ?? null);
      setMemory(memoryText);
      setCronCount(jobs.length);
    })();
    return () => {
      alive = false;
    };
  }, [employeeId]);

  const memorySummary =
    memory.trim().length === 0
      ? t("Empty")
      : t("${count} characters", { count: String(memory.trim().length) });

  const usageSummary = metric
    ? `${t("Hours: ${time}", { time: formatDuration(metric.totalRunMs) })} · ${t("${count} messages", { count: String(metric.messages) })}`
    : "—";

  const cronSummary =
    cronCount === null
      ? "—"
      : cronCount === 0
        ? t("None")
        : t("${count} scheduled", { count: String(cronCount) });

  /** Bring the (already rendered) cron section into view. */
  const scrollToCron = (): void => {
    document
      .getElementById(`emp-cron-${employeeId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <div className="imb-entry-rows">
        <EntryRow
          icon={<IconMemory />}
          label={t("Memory")}
          value={memorySummary}
          onClick={() => setMemoryOpen(true)}
        />
        <EntryRow
          icon={<IconUsage />}
          label={t("Usage")}
          value={usageSummary}
          onClick={() => {
            appStore.module = "usage";
          }}
        />
        <EntryRow
          icon={<IconClock />}
          label={t("Scheduled tasks")}
          value={cronSummary}
          onClick={scrollToCron}
        />
      </div>

      <EmployeeMemoryModal
        open={memoryOpen}
        employeeId={employeeId}
        employeeName={employeeName}
        onClose={() => setMemoryOpen(false)}
        onSaved={(text) => setMemory(text)}
      />
    </>
  );
}

function EntryRow({
  icon,
  label,
  value,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button type="button" className="imb-entry-row" onClick={onClick}>
      <span className="imb-entry-icon">{icon}</span>
      <span className="imb-entry-label">{label}</span>
      <span className="imb-entry-value">{value}</span>
      <IconChevronDown className="imb-icon imb-xs imb-entry-chevron" />
    </button>
  );
}
