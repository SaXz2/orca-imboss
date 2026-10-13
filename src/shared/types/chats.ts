import type { IntegrationPlatform } from "./integrations";

/** Summary view of a chat row (includes unread count). */
export interface Chat {
  id: number;
  title: string;
  participants: number[];
  unread: number;
  /** UNIX timestamp in seconds (all date-kind fields are INTEGER seconds). */
  createdAt: number;
  /** Id of the user chat that spawned this group chat, or null for a root chat. */
  fromChatId: number | null;
  /**
   * Platform this conversation is bridged to (`null` for local-only chats).
   * Doubles as the conversation's platform label in the UI.
   */
  source: IntegrationPlatform | null;
  /** Archived conversations are hidden from the list but kept restorable. */
  archived: boolean;
  /** Pinned conversations sort above the rest of the list. */
  pinned: boolean;
  /** Conversation group ("project") this chat belongs to, or null. */
  groupId: number | null;
}

/**
 * A conversation group ("project"): a named container for chats that can also
 * pin a folder as its workspace — the working directory its sessions run in.
 */
export interface ChatGroup {
  id: number;
  name: string;
  /** Absolute path of the group's workspace folder, or null (global workdir). */
  folder: string | null;
  sortOrder: number;
  createdAt: number;
}

/** One row of the `chat_groups` table. */
export interface ChatGroupRow {
  id: number;
  name: string;
  folder: string | null;
  sort_order: number;
  created_at: number;
}

/** List item of the chat module: chat + derived last-message preview. */
export interface ChatSummary extends Chat {
  /** Last message content, truncated (null when the chat has no messages). */
  preview: string | null;
  /** UNIX timestamp in seconds of the last message (null when the chat has no messages). */
  lastAt: number | null;
  /**
   * UNIX timestamp in seconds of the chat's last message (the recency sort
   * key). For a chat with no messages this falls back to its creation time.
   */
  lastMessageAt: number;
}

/** Participant edits applied in one call (additive/removal merge). */
export interface ChatParticipantUpdate {
  add?: number[];
  remove?: number[];
}

export interface ChatRow {
  id: number;
  title: string;
  participants: string;
  unread: number;
  created_at: number;
  from_chat_id: number | null;
  source: string | null;
  archived: number;
  pinned: number;
  group_id: number | null;
}

export interface ChatSummaryRow extends ChatRow {
  preview: string | null;
  last_at: number | null;
  last_message_at: number;
}
