import type { DraftQuote } from "../../../chat-draft";

/** Longest quoted span kept (chars); longer selections are clipped. */
export const MAX_QUOTE_CHARS = 2000;

/** Trim and clip a raw selection into a quote body. */
export function clipQuoteText(raw: string): string {
  const text = raw.trim();
  return text.length > MAX_QUOTE_CHARS ? text.slice(0, MAX_QUOTE_CHARS) : text;
}

/**
 * Fold the composer's quoted selections into the outgoing message as a leading
 * markdown blockquote. The model sees the quoted context and the user's bubble
 * renders it as a quote block, with the user's own text below.
 */
export function appendQuotesToText(
  text: string,
  quotes: readonly DraftQuote[],
): string {
  if (quotes.length === 0) return text;
  const block = quotes
    .map((quote) => {
      const body = quote.text
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
      return quote.sourceLabel
        ? `> **引用 · ${quote.sourceLabel}**\n>\n${body}`
        : body;
    })
    .join("\n\n>\n\n");
  const trimmed = text.trim();
  return trimmed.length > 0 ? `${block}\n\n${trimmed}` : block;
}
