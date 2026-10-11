export interface MentionableEmployee {
  readonly id: number;
  readonly name?: string;
  readonly role?: string;
}

/**
 * 解析文本中的 `@` 员工提及与工牌号，格式化为带私聊跳转协议的 Markdown 提及链接。
 */
export function formatMentionsToMarkdown(
  text: string,
  employees: readonly MentionableEmployee[],
): string {
  if (!text || text.indexOf("@") === -1) return text;

  // 1. 保护代码块与行内代码，防止误伤代码块中的内容
  const codeBlocks: string[] = [];
  const protectedText = text.replace(/(`{1,3})[\s\S]*?\1/g, (match) => {
    const placeholder = `\x00CODE_${codeBlocks.length}\x00`;
    codeBlocks.push(match);
    return placeholder;
  });

  let processed = protectedText;

  // 2. 匹配带括号工牌号的 mentions，例如 `@全栈工程师 (#1)` 或 `@小李(#2)`
  processed = processed.replace(
    /(^|[^\w])@([^\s()]+)\s*\(#?(\d+)\)/g,
    (match, prefix, name, idStr) => {
      const id = parseInt(idStr, 10);
      const exists = employees.some((e) => e.id === id);
      if (exists) {
        return `${prefix}[@${name} (#${id})](mention:${id})`;
      }
      return match;
    },
  );

  // 3. 匹配纯工牌号 mentions，例如 `@0`, `@1`, `@12`
  processed = processed.replace(/(^|[^\w])@(\d+)\b/g, (match, prefix, idStr) => {
    const id = parseInt(idStr, 10);
    const employee = employees.find((e) => e.id === id);
    if (employee) {
      const label = employee.name || employee.role || `#${id}`;
      return `${prefix}[@${label}](mention:${id})`;
    }
    return match;
  });

  // 4. 匹配名字或角色 mentions，例如 `@Researcher`, `@助理`
  // 按照名称/角色长度降序排序，优先匹配较长的名字
  const candidates = employees
    .flatMap((e) => [
      e.name ? { term: e.name.trim(), id: e.id } : null,
      e.role ? { term: e.role.trim(), id: e.id } : null,
    ])
    .filter((c): c is { term: string; id: number } => c !== null && c.term.length > 0)
    .sort((a, b) => b.term.length - a.term.length);

  for (const { term, id } of candidates) {
    const escaped = escapeRegExp(term);
    // 匹配前导为非字符或空格的 @Term
    const regex = new RegExp(`(^|[^\\w\\[])@(${escaped})(?=$|[^\\w\\]\\)])`, "g");
    processed = processed.replace(regex, (match, prefix, matchedTerm) => {
      return `${prefix}[@${matchedTerm}](mention:${id})`;
    });
  }

  // 5. 还原保护的代码块
  return processed.replace(/\x00CODE_(\d+)\x00/g, (_match, indexStr) => {
    const index = parseInt(indexStr, 10);
    return codeBlocks[index] ?? "";
  });
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
