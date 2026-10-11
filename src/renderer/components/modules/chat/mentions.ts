export interface MentionableEmployee {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}

/**
 * Render employee mentions as clickable Markdown links, using ONE canonical
 * form everywhere: `@<工号> <名称>`. The model (and users) write mentions in
 * inconsistent ways (`@12`, `@桃夭`, `@12 桃夭`); this normalises them all so the
 * transcript never mixes forms. The link colour is supplied per employee by the
 * renderer (`mentionColor`), so each person keeps their own accent.
 */
export function formatMentionsToMarkdown(
  text: string,
  employees: readonly MentionableEmployee[],
): string {
  if (!text || text.indexOf("@") === -1) return text;

  // 1. Protect code blocks / inline code from mention rewriting.
  const codeBlocks: string[] = [];
  let processed = text.replace(/(`{1,3})[\s\S]*?\1/g, (match) => {
    const placeholder = `\x00CODE_${codeBlocks.length}\x00`;
    codeBlocks.push(match);
    return placeholder;
  });

  const byId = new Map(employees.map((e) => [e.id, e]));
  const nameOf = (e: MentionableEmployee | undefined): string =>
    (e?.name || e?.role || "").trim();

  // 2. `@<工号> [名称]` → `@<工号> <名称>` (name appended / trailing duplicate consumed).
  processed = processed.replace(
    /(^|[^\w])@(\d+)(?:([ \t]*)([^\s@\[\]()，。、！？；：“”‘’《》（）【】,.!?;:]+))?/g,
    (match, prefix, idStr, gap, token) => {
      const id = parseInt(idStr, 10);
      const employee = byId.get(id);
      if (!employee) return match;
      const name = nameOf(employee);
      const label = name ? `@${idStr} ${name}` : `@${idStr}`;
      // Consume a trailing token only when it is exactly this employee's name.
      const consumed = token && name && token === name;
      return `${prefix}[${label}](mention:${id})${consumed ? "" : `${gap ?? ""}${token ?? ""}`}`;
    },
  );

  // 3. `@<名称>` / `@<角色>` → `@<工号> <名称>` (longest terms first).
  const candidates = employees
    .flatMap((e) => [
      e.name ? { term: e.name.trim(), id: e.id } : null,
      e.role ? { term: e.role.trim(), id: e.id } : null,
    ])
    .filter(
      (c): c is { term: string; id: number } => c !== null && c.term.length > 0,
    )
    .sort((a, b) => b.term.length - a.term.length);

  for (const { term, id } of candidates) {
    const name = nameOf(byId.get(id));
    const label = name ? `@${id} ${name}` : `@${id}`;
    const regex = new RegExp(
      `(^|[^\\w\\[])@(${escapeRegExp(term)})(?=$|[^\\w\\]\\)])`,
      "g",
    );
    processed = processed.replace(regex, (match, prefix) => {
      return `${prefix}[${label}](mention:${id})`;
    });
  }

  // 4. Restore protected code blocks.
  return processed.replace(/\x00CODE_(\d+)\x00/g, (_match, indexStr) => {
    const index = parseInt(indexStr, 10);
    return codeBlocks[index] ?? "";
  });
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
