import { t } from "@shared/l10n";

/**
 * A chat's display title: the trimmed title, or a localized fallback when it is
 * missing / empty / whitespace-only.
 *
 * Use this everywhere a chat title is rendered. Two shorthand forms silently
 * fail to treat an empty title as empty: `title ?? fallback` (nullish
 * coalescing ignores `""`) and a raw `{title}` (renders blank).
 */
export function displayChatTitle(
  title: string | null | undefined,
  fallbackKey = "New Chat",
): string {
  const trimmed = (title ?? "").trim();
  return trimmed.length > 0 ? trimmed : t(fallbackKey);
}
