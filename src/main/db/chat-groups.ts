import type { ChatGroup, ChatGroupRow } from "@shared/types";
import { getDB } from "./index";

/**
 * Conversation groups ("projects").
 *
 * A group is a named container for chats that may also pin a folder as its
 * workspace: the working directory its sessions run in. It is a piece of
 * organization, not a scoping rule — membership decides nothing about who may
 * talk, only how the list is browsed and where new work starts.
 */

const MAX_NAME = 80;

/** All groups, in display order (sort_order, then creation). */
export function listGroups(): ChatGroup[] {
  return (
    getDB()
      .prepare("SELECT * FROM chat_groups ORDER BY sort_order ASC, id ASC")
      .all() as ChatGroupRow[]
  ).map(toGroup);
}

export function getGroup(id: number): ChatGroup | null {
  const row = getDB()
    .prepare("SELECT * FROM chat_groups WHERE id = ?")
    .get(id) as ChatGroupRow | undefined;
  return row ? toGroup(row) : null;
}

/** Create a group; an empty name is allowed (shown as the default at render). */
export function createGroup(name: string, folder: string | null): ChatGroup {
  const safeName = name.trim().slice(0, MAX_NAME);
  const db = getDB();
  const maxRow = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM chat_groups")
    .get() as { m: number };
  const result = db
    .prepare(
      "INSERT INTO chat_groups (name, folder, sort_order, created_at) " +
        "VALUES (?, ?, ?, CAST(strftime('%s', 'now') AS INTEGER))",
    )
    .run(safeName, normalizeFolder(folder), maxRow.m + 1);
  return getGroup(Number(result.lastInsertRowid)) as ChatGroup;
}

export function renameGroup(id: number, name: string): ChatGroup | null {
  const safeName = name.trim().slice(0, MAX_NAME);
  const changes = getDB()
    .prepare("UPDATE chat_groups SET name = ? WHERE id = ?")
    .run(safeName, id).changes;
  return changes > 0 ? getGroup(id) : null;
}

/** Set (or clear) the group's workspace folder. */
export function setGroupFolder(
  id: number,
  folder: string | null,
): ChatGroup | null {
  const changes = getDB()
    .prepare("UPDATE chat_groups SET folder = ? WHERE id = ?")
    .run(normalizeFolder(folder), id).changes;
  return changes > 0 ? getGroup(id) : null;
}

/** Delete a group; its chats survive and become ungrouped. */
export function deleteGroup(id: number): boolean {
  const db = getDB();
  return db.transaction(() => {
    db.prepare("UPDATE chats SET group_id = NULL WHERE group_id = ?").run(id);
    return (
      db.prepare("DELETE FROM chat_groups WHERE id = ?").run(id).changes > 0
    );
  })();
}

/**
 * Move a chat into a group (`groupId` null clears it). Returns false when the
 * chat does not exist or the target group is unknown.
 */
export function setChatGroup(chatId: number, groupId: number | null): boolean {
  const db = getDB();
  if (groupId !== null && !getGroup(groupId)) return false;
  const changes = db
    .prepare("UPDATE chats SET group_id = ? WHERE id = ?")
    .run(groupId, chatId).changes;
  return changes > 0;
}

/** Workspace folder of the group a chat belongs to, or null when ungrouped. */
export function folderForChat(chatId: number): string | null {
  const row = getDB()
    .prepare(
      "SELECT g.folder AS folder FROM chats c JOIN chat_groups g ON g.id = c.group_id " +
        "WHERE c.id = ?",
    )
    .get(chatId) as { folder: string | null } | undefined;
  return row?.folder ?? null;
}

function normalizeFolder(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toGroup(row: ChatGroupRow): ChatGroup {
  return {
    id: row.id,
    name: row.name ?? "",
    folder: row.folder ?? null,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
  };
}
