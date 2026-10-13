import { getLocale, t } from "@shared/l10n";
import type { ArchivedTask } from "@shared/types";
import { appStore } from "../../../../app-store";
import { IconArchive, IconBack, IconChat, IconEmployees } from "../../../icons";
import { formatMessageTime } from "../../chat/relative-time";

/**
 * The archive: every task that was taken off the board, newest first. Rows keep
 * the same two doors as the task itself (its conversation and its working
 * group) plus a restore action that puts it back on the board.
 */
export function TaskArchiveList({
  archived,
  onBack,
  onRestore,
}: {
  archived: readonly ArchivedTask[];
  onBack: () => void;
  onRestore: (entry: ArchivedTask) => void;
}): React.JSX.Element {
  const openChat = (chatId: number): void => {
    appStore.focusChatId = chatId;
    appStore.module = "chat";
  };

  const openWorkChat = async (chatId: number): Promise<void> => {
    const summary = await imb.chats.summary(chatId);
    if (summary) appStore.openChat(summary);
  };

  return (
    <div className="imb-task-detail">
      <div className="imb-task-detail-bar">
        <button type="button" className="imb-task-back" onClick={onBack}>
          <IconBack />
          {t("Back to board")}
        </button>
      </div>

      <div className="imb-task-detail-scroll">
        <div className="imb-task-detail-pane">
          <div className="imb-task-detail-title">
            <h2>{t("Archived tasks")}</h2>
          </div>

          {archived.length === 0 ? (
            <div className="imb-board-empty">{t("Nothing archived yet")}</div>
          ) : (
            <div className="imb-archive-list">
              {archived.map((entry) => (
                <div key={entry.key} className="imb-archive-row">
                  <span className="imb-archive-icon" aria-hidden="true">
                    <IconArchive />
                  </span>

                  <div className="imb-archive-body">
                    <span className="imb-archive-title">{entry.title}</span>
                    <span className="imb-archive-time">
                      {formatMessageTime(
                        Math.floor(entry.archivedAt / 1000),
                        getLocale(),
                      )}
                    </span>
                  </div>

                  <div className="imb-detail-actions">
                    {entry.chatId !== null && (
                      <button
                        type="button"
                        className="imb-detail-action"
                        onClick={() => openChat(entry.chatId as number)}
                      >
                        <IconChat />
                        {t("Open chat")}
                      </button>
                    )}
                    {entry.workChatId !== null &&
                      entry.workChatId !== entry.chatId && (
                        <button
                          type="button"
                          className="imb-detail-action"
                          onClick={() =>
                            void openWorkChat(entry.workChatId as number)
                          }
                        >
                          <IconEmployees />
                          {t("Open task group")}
                        </button>
                      )}
                    <button
                      type="button"
                      className="imb-detail-action imb-is-accent"
                      onClick={() => onRestore(entry)}
                    >
                      {t("Restore")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
