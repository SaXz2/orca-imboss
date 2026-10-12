import { t } from "./l10n";

/**
 * Human-readable rendering of a cron schedule.
 *
 * The stored expression stays the source of truth (and the thing you edit), but
 * a list of timers is only scannable if it reads like "每天 8:00" instead of
 * `0 0 8 * * *`. Common shapes are described; anything unusual falls back to the
 * raw expression rather than guessing.
 */

/** Field values that mean "any". */
function isAny(field: string): boolean {
  return field === "*" || field === "?";
}

/** A plain number field (`8`, `30`), or null. */
function asNumber(field: string): number | null {
  return /^\d+$/.test(field) ? Number(field) : null;
}

/** The N of a step field ("star-slash N"), or null. */
function asStep(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  return match ? Number(match[1]) : null;
}

function clock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

const WEEKDAY_KEYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Describe a schedule; falls back to the expression when it is not standard. */
export function describeSchedule(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  // 5 fields (min hour dom mon dow) or 6 (sec min hour dom mon dow).
  const fields = parts.length === 5 ? ["0", ...parts] : parts;
  if (fields.length !== 6) return schedule;

  const [second, minute, hour, day, month, weekday] = fields;
  const minuteValue = asNumber(minute);

  // Sub-hour cadences.
  const secondStep = asStep(second);
  if (
    secondStep !== null &&
    isAny(minute) &&
    isAny(hour) &&
    isAny(day) &&
    isAny(month) &&
    isAny(weekday)
  ) {
    return t("Every ${n} seconds", { n: String(secondStep) });
  }

  const minuteStep = asStep(minute);
  if (asNumber(second) === 0 && minuteStep !== null && isAny(hour)) {
    return t("Every ${n} minutes", { n: String(minuteStep) });
  }

  const hourStep = asStep(hour);
  if (asNumber(second) === 0 && minuteValue !== null && hourStep !== null) {
    return t("Every ${n} hours at :${m}", {
      n: String(hourStep),
      m: String(minuteValue).padStart(2, "0"),
    });
  }

  if (asNumber(second) === 0 && minuteValue !== null && isAny(hour)) {
    return t("Hourly at :${m}", { m: String(minuteValue).padStart(2, "0") });
  }

  // Fixed time of day.
  const hourValue = asNumber(hour);
  const weekdayNumber = asNumber(weekday);
  const dayValue = asNumber(day);
  if (asNumber(second) === 0 && minuteValue !== null && hourValue !== null) {
    const time = clock(hourValue, minuteValue);
    if (isAny(day) && month === "*") {
      if (isAny(weekday)) return t("Daily at ${time}", { time });
      if (weekdayNumber !== null && weekdayNumber >= 0 && weekdayNumber <= 6) {
        return t("Weekly on ${day} at ${time}", {
          day: t(WEEKDAY_KEYS[weekdayNumber]),
          time,
        });
      }
      if (weekday === "1-5") return t("Weekdays at ${time}", { time });
    }
    if (dayValue !== null && isAny(weekday) && month === "*") {
      return t("Monthly on day ${d} at ${time}", {
        d: String(dayValue),
        time,
      });
    }
  }

  return schedule;
}
