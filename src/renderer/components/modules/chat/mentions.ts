export interface MentionableEmployee {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}

/**
 * 把聊天文本中的员工提及渲染为可点击的 Markdown 链接。
 *
 * 采用“最原始”的 `@工牌号+姓名` 写法：保留原文，不做姓名替换，只把匹配到的
 * 原文（如 `@12 桃夭` 或单独的 `@12` / `@桃夭`）包成跳转链接，由样式统一染成橙色。
 */
export function formatMentionsToMarkdown(
  text: string,
  employees: readonly MentionableEmployee[],
): string {
  if (!text || text.indexOf("@") === -1) return text;

  // 1. 保护代码块与行内代码，防止误伤代码块中的内容。
  const codeBlocks: string[] = [];
  let processed = text.replace(/(`{1,3})[\s\S]*?\1/g, (match) => {
    const placeholder = `\x00CODE_${codeBlocks.length}\x00`;
    codeBlocks.push(match);
    return placeholder;
  });

  // 2. `@工牌号 [姓名]`：工牌号命中员工时，把它（以及紧跟在后的同名）整体作为链接。
  processed = processed.replace(
    /(^|[^\w])@(\d+)(?:([ \t]*)([^\s@\[\]()，。、！？；：“”‘’《》（）【】,.!?;:]+))?/g,
    (match, prefix, idStr, gap, token) => {
      const id = parseInt(idStr, 10);
      const employee = employees.find((e) => e.id === id);
      if (!employee) return match;
      const name = employee.name?.trim();
      // 紧跟的整词正好是该员工姓名时，合并为 `@工牌号 姓名` 一起高亮。
      if (token && name && token === name) {
        return `${prefix}[@${idStr} ${token}](mention:${id})`;
      }
      // 否则仅高亮工牌号，并把原样文本还原回去。
      return `${prefix}[@${idStr}](mention:${id})${gap ?? ""}${token ?? ""}`;
    },
  );

  // 3. `@姓名` / `@角色`：按长度降序优先匹配较长的名字，避免前缀误判。
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
    const escaped = escapeRegExp(term);
    const regex = new RegExp(
      `(^|[^\\w\\[])@(${escaped})(?=$|[^\\w\\]\\)])`,
      "g",
    );
    processed = processed.replace(
      regex,
      (match, prefix, matchedTerm) =>
        `${prefix}[@${matchedTerm}](mention:${id})`,
    );
  }

  // 4. 还原保护的代码块。
  return processed.replace(/\x00CODE_(\d+)\x00/g, (_match, indexStr) => {
    const index = parseInt(indexStr, 10);
    return codeBlocks[index] ?? "";
  });
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
