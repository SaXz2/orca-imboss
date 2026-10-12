import { ASSISTANT_ID } from "@shared/constants/employees";
import { employeeColor } from "@shared/constants/employee-colors";
import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import { appStore, useApp } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import { useMentionResolver } from "../../../markdown/use-mention";
import { AnswerCard } from "../answer-card";
import { AskCard } from "../ask-card";
import { ChatCard } from "../chat-card";
import { MessageBubble } from "../message-bubble";
import { ProgressCard } from "../progress-card";

export interface MessageItemProps {
  message: Message;
  /** Read-only rendering (group-chat view): interactive cards are static. */
  readonly?: boolean;
  /** Show the sender's name (with its accent colour) above the bubble. */
  showSender?: boolean;
  /** Whether this is the latest progress card in the chat thread. */
  isLatestProgress?: boolean;
  /** Called after a successful ask-card answer (interactive mode only). */
  onAnswered?: () => void;
  /** The answer message folded into this ask card, when one exists. */
  askAnswer?: Message;
}

/**
 * Renders one message according to its `kind`, shared by the interactive chat
 * module and the read-only group-chat module so the two views never drift.
 */
export function MessageItem({
  message,
  readonly = false,
  showSender = false,
  isLatestProgress = true,
  onAnswered,
  askAnswer,
}: MessageItemProps): React.JSX.Element {
  const { data } = useApp();
  // `@<id>` mentions in chat bubbles render as clickable employee names that
  // open the same agent session as the avatar for this chat.
  const mentions = useMentionResolver(message.chatId, true);
  // Clicking an employee/assistant avatar opens that sender's agent session for
  // this chat. The user (null sender) has no session session avatar.
  const sender = message.senderEmployeeId;
  const openSession =
    sender === null
      ? undefined
      : () => void appStore.openAgentSession(sender, message.chatId);

  const senderEmployee =
    sender === null
      ? null
      : (data.employees.items.find((e) => e.id === sender) ?? null);
  const senderName =
    showSender && sender !== null
      ? senderEmployee?.name || senderEmployee?.role || `#${sender}`
      : undefined;
  const senderColor = sender === null ? undefined : employeeColor(sender);
  const isAdmin = sender === ASSISTANT_ID;

  switch (message.kind) {
    case "ask":
      return (
        <AskCard
          message={message}
          readonly={readonly}
          onAnswered={onAnswered ?? (() => undefined)}
          answer={askAnswer}
          onAvatarClick={openSession}
          resolveMention={mentions.resolveMention}
        />
      );
    case "answer":
      return <AnswerCard message={message} onAvatarClick={openSession} />;
    case "progress":
      return (
        <div className="imb-msg imb-other">
          <EmployeeAvatar
            employeeId={message.senderEmployeeId ?? 0}
            size={34}
          />
          <ProgressCard
            title={message.content}
            steps={message.steps ?? []}
            chatId={message.chatId}
            isLatest={isLatestProgress}
          />
        </div>
      );
    case "chat":
      return <ChatCard message={message} onAvatarClick={openSession} />;
    case "ack":
      // App-generated receipt: stored content is empty, the label is localized
      // at render time so it follows locale switches.
      return (
        <MessageBubble
          self={false}
          messageId={message.id}
          chatId={message.chatId}
          content={t("ACK")}
          attachments={null}
          attachmentsTotal={null}
          senderName={senderName}
          senderColor={senderColor}
          isAdmin={isAdmin}
          avatar={
            <EmployeeAvatar
              employeeId={message.senderEmployeeId}
              size={34}
              onClick={openSession}
            />
          }
        />
      );
    default:
      return (
        <MessageBubble
          self={message.senderEmployeeId === null}
          messageId={message.id}
          chatId={message.chatId}
          content={message.content}
          attachments={message.attachments}
          attachmentsTotal={message.attachmentsTotal}
          markdown={message.kind === "text" || message.kind === "report"}
          senderName={senderName}
          senderColor={senderColor}
          isAdmin={isAdmin}
          resolveMention={mentions.resolveMention}
          onMentionClick={mentions.onMentionClick}
          avatar={
            <EmployeeAvatar
              employeeId={message.senderEmployeeId}
              size={34}
              onClick={openSession}
            />
          }
        />
      );
  }
}
