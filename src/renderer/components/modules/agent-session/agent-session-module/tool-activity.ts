import { t } from "@shared/l10n";

/**
 * Human-readable description of an agent tool call for the session view's
 * "activity rows" (e.g. `imb_create_chat` → "Setting up task chat" with the
 * participants' avatars inline).
 */

export interface ToolActivity {
  /** Friendly label (falls back to the raw tool name). */
  label: string;
  /** Employee ids to show as inline mini avatars (empty when none apply). */
  employeeIds: number[];
}

/** Translation key per built-in team tool. */
const TOOL_LABELS: Record<string, string> = {
  imb_send_message: "Sending message",
  imb_read_chat: "Reading chat",
  imb_progress: "Updating progress",
  imb_ask: "Asking question",
  imb_notify: "Notifying",
  imb_set_employees: "Recruiting employee",
  imb_create_chat: "Setting up task chat",
  imb_add_participant: "Adding member",
  imb_set_cronjob: "Set cron job",
  imb_remove_cronjob: "Remove cron job",
};

function parseArgs(detail?: string): Record<string, unknown> {
  if (!detail) return {};
  try {
    const value: unknown = JSON.parse(detail);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function numberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => typeof v === "number")
    : [];
}

export function describeToolActivity(
  name: string,
  detail?: string,
): ToolActivity {
  const args = parseArgs(detail);
  let employeeIds: number[] = [];

  if (name === "imb_set_employees") {
    const list = Array.isArray(args.employees)
      ? (args.employees as unknown[])
      : [];
    employeeIds = list
      .map((item) =>
        item && typeof item === "object"
          ? (item as { id?: unknown }).id
          : undefined,
      )
      .filter((id): id is number => typeof id === "number");
  } else if (name === "imb_create_chat" || name === "imb_add_participant") {
    employeeIds = numberArray(args.participants);
  }

  const key = TOOL_LABELS[name];
  return { label: key ? t(key) : name, employeeIds };
}
