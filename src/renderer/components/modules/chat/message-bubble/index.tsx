import { MAX_VISIBLE_ATTACHMENTS } from "@shared/constants/attachments";
import { t } from "@shared/l10n";
import type { MessageAttachment } from "@shared/types";
import { useMemo, useState } from "react";
import { cls } from "reactutils";
import { employeeColor } from "@shared/constants/employee-colors";
import { appStore, useApp } from "../../../../app-store";
import { IconFile } from "../../../icons";
import { Markdown } from "../../../markdown";
import { formatMentionsToMarkdown } from "../mentions";
import "./index.css";

export interface MessageBubbleProps {
  /** `true` = user message (right-aligned, green bubble). */
  self: boolean;
  /** Global message id; the reveal IPC resolves the stored path from it. */
  messageId: number;
  chatId?: number;
  content: string;
  /** Selected text quoted into this message, shown above the body. */
  quotedText?: string | null;
  attachments: MessageAttachment[] | null;
  /**
   * True attachment count. May exceed `attachments.length` when an agent only
   * forwarded the first few; drives the `+N` overflow chip.
   */
  attachmentsTotal?: number | null;
  /** Avatar node (left side for other-messages, right side for self). */
  avatar: React.ReactNode;
  /** Sender display name (group chats); renders a coloured name line above the bubble. */
  senderName?: string;
  /** Sender's role, shown muted after the name (group chats). */
  senderRole?: string;
  /** Accent colour for the sender name. */
  senderColor?: string;
  /** Show the `Admin` tag next to the sender name (the assistant). */
  isAdmin?: boolean;
  /**
   * Render `content` as Markdown + KaTeX instead of plain pre-wrapped text.
   * Only free-form prose kinds opt in (`text`, `report`); system/structured
   * kinds keep the literal rendering.
   */
  markdown?: boolean;
  /** Resolve `@<id>` mentions to employee names (Markdown path only). */
  resolveMention?: (id: number) => string | null;
  /** When set, a resolved mention becomes a button that opens the agent session. */
  onMentionClick?: (id: number) => void;
}

export function MessageBubble({
  self,
  messageId,
  chatId,
  content,
  quotedText,
  attachments,
  attachmentsTotal,
  avatar,
  senderName,
  senderRole,
  senderColor,
  isAdmin = false,
  markdown = false,
  resolveMention,
  onMentionClick,
}: MessageBubbleProps): React.JSX.Element {
  const { data } = useApp();
  const employees = data.employees.items;
  const [revealError, setRevealError] = useState<string | null>(null);

  const formattedContent = useMemo(
    () => formatMentionsToMarkdown(content, employees),
    [content, employees],
  );

  const handleMentionClick = (employeeId: number): void => {
    if (chatId !== undefined) {
      void appStore.openAgentSession(employeeId, chatId);
    }
  };

  const all = attachments ?? [];
  const hasAttachments = all.length > 0;
  const visible = all.slice(0, MAX_VISIBLE_ATTACHMENTS);
  const total = Math.max(attachmentsTotal ?? all.length, all.length);
  const hidden = total - visible.length;

  const reveal = async (index: number): Promise<void> => {
    setRevealError(null);
    try {
      await imb.messages.revealAttachment(messageId, index);
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className={cls("imb-msg", self ? "imb-self" : "imb-other")}>
      {avatar}
      <div className="imb-bubble-col">
        {senderName !== undefined && (
          <div className="imb-bubble-sender" style={{ color: senderColor }}>
            <span className="imb-bubble-sender-name">{senderName}</span>
            {senderRole !== undefined && senderRole.length > 0 && (
              <span className="imb-bubble-sender-role">{senderRole}</span>
            )}
            {isAdmin && (
              <span className="imb-bubble-admin">{t("Admin")}</span>
            )}
          </div>
        )}
        <div className="imb-bubble">
        {quotedText !== undefined && quotedText !== null && quotedText.length > 0 && (
          <div className="imb-bubble-quote">
            <span className="imb-bubble-quote-mark" aria-hidden="true">
              “
            </span>
            <span className="imb-bubble-quote-text">{quotedText}</span>
          </div>
        )}
        {hasAttachments && (
          <div className="imb-bubble-attachments">
            {visible.map((attachment, index) => {
              const hasPath =
                typeof attachment.path === "string" &&
                attachment.path.length > 0;
              return (
                <button
                  key={`${attachment.name}-${attachment.size}-${index}`}
                  type="button"
                  className={cls(
                    "imb-bubble-chip",
                    !hasPath && "imb-bubble-chip-static",
                  )}
                  aria-disabled={!hasPath}
                  title={
                    hasPath
                      ? t("Show in folder")
                      : t("File location is unavailable.")
                  }
                  onClick={hasPath ? () => void reveal(index) : undefined}
                >
                  <IconFile className="imb-icon imb-sm" />
                  <span className="imb-bubble-chip-name">
                    {attachment.name}
                  </span>
                  <span className="imb-bubble-chip-size">
                    {formatSize(attachment.size)}
                  </span>
                </button>
              );
            })}
            {hidden > 0 && (
              <span
                className="imb-bubble-chip imb-bubble-chip-more"
                title={t("${count} attachments in total", {
                  count: String(total),
                })}
              >
                {`+${hidden}`}
              </span>
            )}
          </div>
        )}
        {revealError !== null && (
          <div className="imb-bubble-attachment-error">{revealError}</div>
        )}
        {content.length > 0 && (
          <Markdown
            content={formattedContent}
            inline={!markdown}
            resolveMention={resolveMention}
            onMentionClick={onMentionClick ?? handleMentionClick}
            mentionColor={employeeColor}
          />
        )}
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
