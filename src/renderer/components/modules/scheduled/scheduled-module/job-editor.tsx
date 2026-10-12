import { t } from "@shared/l10n";
import type { CronJobInfo } from "@shared/types";
import { useEffect, useState } from "react";
import { Button } from "../../../button";
import { Field } from "../../../field";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import { Textarea } from "../../../textarea";

/**
 * Editor for one scheduled task: its cron schedule and the instruction the
 * employee receives when it fires. The owner and the chat are fixed — editing
 * a task never moves it to another session.
 */
export function JobEditor({
  open,
  job,
  onClose,
  onSaved,
}: {
  open: boolean;
  job: CronJobInfo | null;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element | null {
  const [schedule, setSchedule] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !job) return;
    setSchedule(job.schedule);
    setContent(job.content);
    setError(null);
  }, [open, job]);

  if (!open || !job) return null;

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      // Main validates the expression (croner) and normalizes it to 6 fields.
      await imb.cron.update(job.id, {
        schedule: schedule.trim(),
        content: content.trim(),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("Edit scheduled task")}
      sub={t("Change when it runs and what the employee is asked to do.")}
      error={error}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={saving || schedule.trim().length === 0}
          >
            {saving ? t("Saving…") : t("Confirm")}
          </Button>
        </>
      }
    >
      <div className="imb-job-editor">
        <Field
          label={t("Schedule")}
          htmlFor="cron-schedule"
          hint={t(
            "Cron expression, 5 fields (minute hour day month weekday). Seconds optional.",
          )}
        >
          <Input
            id="cron-schedule"
            value={schedule}
            mono
            autoFocus
            placeholder="0 8 * * *"
            onChange={(event) => setSchedule(event.target.value)}
          />
        </Field>

        <Field
          label={t("Instruction")}
          htmlFor="cron-content"
          hint={t("The message this employee receives when the task fires.")}
        >
          <Textarea
            id="cron-content"
            value={content}
            minHeight={140}
            maxHeight={320}
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
