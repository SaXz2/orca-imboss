import { employeeColor } from "@shared/constants/employee-colors";
import { getLocale, t } from "@shared/l10n";
import type { CronJobInfo } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { appStore, useApp } from "../../app-store";
import { employeeLabel } from "../../employee-label";
import { EmployeeAvatar } from "../employee-avatar";
import { IconClock, IconRefresh, IconTrash, IconX } from "../icons";
import { formatMessageTime } from "../modules/chat/relative-time";
import "./index.css";

/**
 * The right dock: the company's scheduled tasks, in one place. Every cron job
 * from every employee is listed with when it runs next, so the automation side
 * of the team is visible at a glance instead of buried in one employee's page.
 */
export function RightDock({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setJobs(await imb.cron.listAll());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string): Promise<void> => {
    try {
      await imb.cron.remove(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className="imb-dock" aria-label={t("Scheduled tasks")}>
      <div className="imb-dock-head">
        <span className="imb-dock-title">{t("Scheduled tasks")}</span>
        <div className="imb-dock-head-actions">
          <button
            type="button"
            className="imb-dock-icon-btn"
            title={t("Refresh")}
            aria-label={t("Refresh")}
            onClick={() => void load()}
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="imb-dock-icon-btn"
            title={t("Close")}
            aria-label={t("Close")}
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>
      </div>

      <div className="imb-dock-body">
        {error !== null && <p className="imb-error-text">{error}</p>}

        {!loading && jobs.length === 0 && error === null ? (
          <div className="imb-board-empty">{t("No scheduled tasks yet")}</div>
        ) : (
          <div className="imb-dock-list">
            {jobs.map((job) => {
              const employee = employees.find(
                (person) => person.id === job.employeeId,
              );
              const label = employee
                ? employeeLabel(employee)
                : `#${job.employeeId}`;
              return (
                <div key={job.id} className="imb-cron-row">
                  <EmployeeAvatar employeeId={job.employeeId} size={26} />

                  <button
                    type="button"
                    className="imb-cron-main"
                    title={t("Open the session that runs this")}
                    onClick={() =>
                      void appStore.openAgentSession(
                        job.employeeId,
                        job.chatId,
                      )
                    }
                  >
                    <span className="imb-cron-name-row">
                      <span
                        className="imb-cron-name"
                        style={{ color: employeeColor(job.employeeId) }}
                      >
                        {label}
                      </span>
                      <span className="imb-cron-schedule" title={job.schedule}>
                        <IconClock />
                        {job.schedule}
                      </span>
                    </span>
                    <span className="imb-cron-content">{job.content}</span>
                    <span className="imb-cron-meta">
                      {job.nextRunAt !== null
                        ? t("Next run ${time}", {
                            time: formatMessageTime(job.nextRunAt, getLocale()),
                          })
                        : t("No further runs")}
                      {job.chatTitle.trim().length > 0
                        ? ` · ${job.chatTitle}`
                        : ""}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="imb-cron-remove"
                    title={t("Remove")}
                    aria-label={t("Remove")}
                    onClick={() => void remove(job.id)}
                  >
                    <IconTrash />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
