import { employeeColor } from "@shared/constants/employee-colors";
import { describeSchedule } from "@shared/cron-describe";
import { getLocale, t } from "@shared/l10n";
import type { CronJobInfo } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { appStore, useApp } from "../../../../app-store";
import { employeeLabel } from "../../../../employee-label";
import { ModuleView } from "../../../app-shell";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconCheck, IconClock, IconPencil, IconRefresh, IconTrash } from "../../../icons";
import { formatMessageTime } from "../../chat/relative-time";
import { JobEditor } from "./job-editor";
import "./index.css";

/**
 * Scheduled tasks — everything the company runs on a timer, in one table. Each
 * job shows who runs it, what it does, when it fires next, and can be fired now,
 * paused, or removed without opening the employee that owns it.
 */
export function ScheduledModule(): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;
  const [jobs, setJobs] = useState<CronJobInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CronJobInfo | null>(null);

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
    void appStore.reloadEmployees();
    void load();
  }, [load]);

  /** Run one action on a job, then refresh the table. */
  const act = async (
    id: string,
    action: () => Promise<unknown>,
  ): Promise<void> => {
    if (busyId !== null) return;
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const enabledCount = jobs.filter((job) => job.enabled).length;

  const content = (
    <>
      <div className="imb-chat-header imb-scheduled-head">
        <div className="imb-scheduled-head-text">
          <div className="imb-chat-title">{t("Scheduled tasks")}</div>
          <div className="imb-scheduled-sub">
            {t("${enabled} of ${total} running", {
              enabled: String(enabledCount),
              total: String(jobs.length),
            })}
          </div>
        </div>
        <button
          type="button"
          className="imb-task-archive-btn"
          onClick={() => void load()}
        >
          <IconRefresh />
          {t("Refresh")}
        </button>
      </div>

      <div className="imb-scheduled-body">
        {error !== null && <p className="imb-error-text">{error}</p>}

        {!loading && jobs.length === 0 && error === null ? (
          <div className="imb-board-empty">{t("No scheduled tasks yet")}</div>
        ) : (
          <div className="imb-scheduled-list">
            {jobs.map((job) => {
              const employee = employees.find(
                (person) => person.id === job.employeeId,
              );
              const label = employee
                ? employeeLabel(employee)
                : `#${job.employeeId}`;
              return (
                <div
                  key={job.id}
                  className={cls(
                    "imb-scheduled-row",
                    !job.enabled && "imb-is-paused",
                  )}
                >
                  <EmployeeAvatar employeeId={job.employeeId} size={28} />

                  <div className="imb-scheduled-main">
                    <div className="imb-scheduled-top">
                      <span
                        className="imb-scheduled-name"
                        style={{ color: employeeColor(job.employeeId) }}
                      >
                        {label}
                      </span>
                      <span
                        className="imb-scheduled-schedule"
                        title={job.schedule}
                      >
                        <IconClock />
                        {describeSchedule(job.schedule)}
                      </span>
                      <span
                        className={cls(
                          "imb-scheduled-state",
                          job.enabled && "imb-is-on",
                        )}
                      >
                        {job.enabled ? t("Running") : t("Paused")}
                      </span>
                    </div>

                    <div className="imb-scheduled-content">{job.content}</div>

                    <div className="imb-scheduled-meta">
                      {job.nextRunAt !== null
                        ? t("Next run ${time}", {
                            time: formatMessageTime(job.nextRunAt, getLocale()),
                          })
                        : t("No further runs")}
                      {" · "}
                      {job.lastRunAt !== null
                        ? t("Last run ${time}", {
                            time: formatMessageTime(job.lastRunAt, getLocale()),
                          })
                        : t("Never run")}
                      {job.chatTitle.trim().length > 0
                        ? ` · ${job.chatTitle}`
                        : ""}
                    </div>
                  </div>

                  <div className="imb-detail-actions">
                    <button
                      type="button"
                      className="imb-detail-action"
                      disabled={busyId !== null}
                      onClick={() => setEditing(job)}
                    >
                      <IconPencil />
                      {t("Edit")}
                    </button>
                    <button
                      type="button"
                      className="imb-detail-action"
                      disabled={busyId !== null}
                      title={t("Open the session that runs this")}
                      onClick={() =>
                        void appStore.openAgentSession(
                          job.employeeId,
                          job.chatId,
                        )
                      }
                    >
                      {t("Open session")}
                    </button>
                    <button
                      type="button"
                      className="imb-detail-action"
                      disabled={busyId !== null}
                      onClick={() => void act(job.id, () => imb.cron.runNow(job.id))}
                    >
                      {t("Run now")}
                    </button>
                    <button
                      type="button"
                      className="imb-detail-action"
                      disabled={busyId !== null}
                      onClick={() =>
                        void act(job.id, () =>
                          imb.cron.setEnabled(job.id, !job.enabled),
                        )
                      }
                    >
                      {job.enabled ? (
                        t("Pause")
                      ) : (
                        <>
                          <IconCheck />
                          {t("Resume")}
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="imb-detail-action imb-is-danger"
                      disabled={busyId !== null}
                      title={t("Remove")}
                      aria-label={t("Remove")}
                      onClick={() =>
                        void act(job.id, () => imb.cron.remove(job.id))
                      }
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <ModuleView content={content} />
      <JobEditor
        open={editing !== null}
        job={editing}
        onClose={() => setEditing(null)}
        onSaved={() => void load()}
      />
    </>
  );
}
