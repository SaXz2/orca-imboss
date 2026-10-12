import { MAX_USER_ATTACHMENTS } from "@shared/constants/attachments";
import { t } from "@shared/l10n";
import type { MessageAttachment } from "@shared/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { appStore, useAppSync } from "../../../../app-store";
import {
  EMPTY_DRAFT,
  nextAttachmentId,
  toPlainAttachment,
  type PendingAttachment,
} from "../../../../chat-draft";
import { useClickOutside } from "../../../../hooks/use-click-outside";
import { useDropdownPosition } from "../../../../hooks/use-dropdown-position";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconAttach, IconFile, IconImage, IconSend } from "../../../icons";
import { Textarea } from "../../../textarea";
import { joinQuoteTexts } from "../quote-text";
import { MentionPopup } from "./mention-popup";
import "./index.css";

export interface ChatInputBarProps {
  disabled?: boolean;
  /** Chat whose draft this composer edits (drafts are per chat, on appStore). */
  chatId: number;
  /**
   * Bumped by the parent when a new chat is created. A non-zero change resets
   * the composer and focuses the textarea; `0` (the initial value) never
   * steals focus on mount.
   */
  focusToken?: number;
  /**
   * Bumped to move focus into the textarea without resetting the draft (used
   * after a selection is quoted). Unlike `focusToken`, it never clears input.
   */
  focusRequest?: number;
  onSend: (
    text: string,
    attachments: MessageAttachment[],
    quotedText?: string,
  ) => void;
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|heic|heif)$/i;

/**
 * Best-effort image detection: prefer the MIME type the picker/drag source
 * supplies, falling back to the extension because some drag sources report an
 * empty type.
 */
function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name);
}

/** True when a drag payload carries OS files (ignores text/link drags). */
function hasDroppedFiles(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files");
}

/** Small quote mark shown on a quoted-selection chip. */
function QuoteGlyph(): React.JSX.Element {
  return (
    <svg
      className="imb-quote-chip-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M7.4 6.2C5.2 7.7 4 9.9 4 12.8V18h5.7v-5.7H7.1c.1-1.6.9-2.8 2.3-3.8l-2-2.3Z" />
      <path d="M16.4 6.2c-2.2 1.5-3.4 3.7-3.4 6.6V18h5.7v-5.7h-2.6c.1-1.6.9-2.8 2.3-3.8l-2-2.3Z" />
    </svg>
  );
}

export function ChatInputBar({
  disabled = false,
  chatId,
  focusToken = 0,
  focusRequest = 0,
  onSend,
}: ChatInputBarProps): React.JSX.Element {
  // The draft is per chat and lives on appStore so it survives the chat module
  // being unmounted on a module switch. `sync: true` keeps the controlled
  // textarea's value/caret in step with the store.
  const snap = useAppSync();
  const draft = snap.chatDrafts[chatId] ?? EMPTY_DRAFT;
  const { text, attachments, quotes } = draft;

  const [notice, setNotice] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  // Mention state
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionCaret, setMentionCaret] = useState({ start: 0, end: 0 });

  const allEmployees = snap.data.employees.items;
  const filteredEmployees = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.toLowerCase().trim();
    if (!q) return allEmployees;
    return allEmployees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.role.toLowerCase().includes(q) ||
        String(e.id).includes(q),
    );
  }, [mentionOpen, mentionQuery, allEmployees]);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { panelStyle, positionPanel } = useDropdownPosition(popupRef);

  // A new chat resets the composer (draft/attachments) and lands the caret in
  // the input. `focusToken` starts at `0`, so mounting with an existing chat
  // never steals focus.
  useEffect(() => {
    if (focusToken === 0) return;
    appStore.clearChatDraft(chatId);
    setNotice(null);
    setPopupOpen(false);
    setDropActive(false);
    if (textareaRef.current) textareaRef.current.value = "";
    textareaRef.current?.focus();
  }, [focusToken, chatId]);

  // A quotation request moves focus into the textarea without touching the
  // draft (see the `focusRequest` prop).
  useEffect(() => {
    if (!focusRequest) return;
    textareaRef.current?.focus();
  }, [focusRequest]);

  // Per-chat drafts: reset transient UI when the edited chat changes so a
  // notice or an open attach menu never carries over to another chat's draft.
  useEffect(() => {
    setNotice(null);
    setPopupOpen(false);
    setDropActive(false);
    // Uncontrolled textarea: manually sync the DOM value to this chat's draft
    // (React never rewrites it, so IME composition is never interrupted).
    if (textareaRef.current) {
      textareaRef.current.value = appStore.chatDrafts[chatId]?.text ?? "";
    }
  }, [chatId]);

  // A file dropped anywhere outside the input bar would otherwise make Chromium
  // navigate the window to it. Neutralize that default globally; the input bar
  // handles its own drop (and calls preventDefault too).
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent): void => {
      if (event.dataTransfer && hasDroppedFiles(event.dataTransfer)) {
        event.preventDefault();
      }
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  // The menu is portaled to `document.body`, so it lives outside `popupRef`;
  // both count as "inside" for click-outside purposes.
  const popupOutsideRefs = useMemo(() => [popupRef, popupMenuRef], []);
  useClickOutside(popupOutsideRefs, () => setPopupOpen(false), popupOpen);
  useEscapeKey(() => setPopupOpen(false), popupOpen);

  // Reposition the portaled menu if the viewport scrolls/resizes while open.
  useEffect(() => {
    if (!popupOpen) return;
    const reposition = (): void => positionPanel();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [popupOpen, positionPanel]);

  const send = (): void => {
    const value = text.trim();
    if (disabled) return;
    if (!value && attachments.length === 0 && quotes.length === 0) return;
    // The quote rides as its own field on the message (never mixed into the
    // body) so the bubble shows it separately and the model still gets it.
    onSend(
      value,
      attachments.map((item) => toPlainAttachment(item.attachment)),
      joinQuoteTexts(quotes),
    );
    // Clear the per-chat draft; the store revokes its preview URLs.
    appStore.clearChatDraft(chatId);
    // Uncontrolled textarea: clear the DOM value directly.
    if (textareaRef.current) textareaRef.current.value = "";
    setNotice(null);
  };

  const addFiles = (files: readonly File[] | null): void => {
    if (!files || files.length === 0) return;
    setNotice(null);
    const selected = Array.from(files);
    const remaining = Math.max(MAX_USER_ATTACHMENTS - attachments.length, 0);
    if (selected.length > remaining) {
      setNotice(
        t("Up to ${count} attachments allowed.", {
          count: String(MAX_USER_ATTACHMENTS),
        }),
      );
    }
    const next: PendingAttachment[] = [];
    for (const file of selected.slice(0, remaining)) {
      // `webUtils.getPathForFile` (preload) yields "" for JS-constructed files;
      // only persist a real on-disk path so the chip is revealable.
      const path = imb.files.getPath(file);
      let previewUrl: string | undefined;
      if (isImageFile(file)) {
        previewUrl = URL.createObjectURL(file);
      }
      next.push({
        id: nextAttachmentId(),
        attachment: {
          name: file.name,
          size: file.size,
          type: file.type,
          ...(path ? { path } : {}),
        },
        ...(previewUrl ? { previewUrl } : {}),
      });
    }
    if (next.length > 0) {
      appStore.addChatDraftAttachments(chatId, next);
    }
    setPopupOpen(false);
  };

  // Pasting files (e.g. a screenshot) attaches them; plain text paste falls
  // through to the browser default.
  const onPasteAttachments = (
    event: React.ClipboardEvent<HTMLDivElement>,
  ): void => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  };

  // Folders cannot be attached, and a `File` alone cannot be told apart from an
  // empty file; Chromium's entry API distinguishes them synchronously (no IPC).
  const addDropped = (dataTransfer: DataTransfer): void => {
    const dropped: File[] = [];
    let skippedFolder = false;
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (!file) continue;
      let isDirectory = false;
      try {
        isDirectory = item.webkitGetAsEntry()?.isDirectory === true;
      } catch {
        // Some sources throw; treat the entry as a regular file.
        isDirectory = false;
      }
      if (isDirectory) {
        skippedFolder = true;
        continue;
      }
      dropped.push(file);
    }
    // Sources without `items` (or with only string items) fall back to `files`.
    if (dropped.length === 0 && !skippedFolder) {
      dropped.push(...Array.from(dataTransfer.files));
    }
    const remaining = Math.max(MAX_USER_ATTACHMENTS - attachments.length, 0);
    addFiles(dropped);
    // Only surface the folder notice when the cap notice did not take over.
    if (skippedFolder && dropped.length <= remaining) {
      setNotice(t("Folders cannot be attached."));
    }
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    // Moving over a child fires dragleave on the parent; ignore those.
    if (event.currentTarget.contains(event.relatedTarget as Node | null))
      return;
    setDropActive(false);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDroppedFiles(event.dataTransfer)) return;
    event.preventDefault();
    setDropActive(false);
    addDropped(event.dataTransfer);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (mentionOpen && filteredEmployees.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredEmployees.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (i) => (i - 1 + filteredEmployees.length) % filteredEmployees.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const chosen =
          filteredEmployees[mentionIndex] ?? filteredEmployees[0];
        if (chosen) insertMention(chosen);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionOpen(false);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const checkMentionTrigger = (val: string, cursor: number): void => {
    const before = val.slice(0, cursor);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (match) {
      const query = match[1];
      const atStart = match.index + (match[0].startsWith("@") ? 0 : 1);
      setMentionQuery(query);
      setMentionCaret({ start: atStart, end: cursor });
      setMentionOpen(true);
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
    }
  };

  const syncDraftText = (val: string, cursor?: number): void => {
    appStore.setChatDraftText(chatId, val);
    const pos = cursor ?? textareaRef.current?.selectionStart ?? val.length;
    checkMentionTrigger(val, pos);
  };

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    syncDraftText(
      e.target.value,
      e.target.selectionStart ?? e.target.value.length,
    );
  };

  const onTextSelect = (): void => {
    const textarea = textareaRef.current;
    if (textarea) {
      checkMentionTrigger(textarea.value, textarea.selectionStart ?? 0);
    }
  };

  const insertMention = (employee: {
    id: number;
    name?: string;
    role?: string;
  }): void => {
    const label = employee.name || employee.role || `#${employee.id}`;
    // “最原始”的工牌号+姓名写法，便于模型解析 (消息体含 @ID) 且显示醒目。
    const mentionTag = `@${employee.id} ${label} `;
    const prevText = text;
    const nextText =
      prevText.slice(0, mentionCaret.start) +
      mentionTag +
      prevText.slice(mentionCaret.end);
    appStore.setChatDraftText(chatId, nextText);
    setMentionOpen(false);

    setTimeout(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.value = nextText;
        textarea.focus();
        const newCursor = mentionCaret.start + mentionTag.length;
        textarea.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  // Toolbar shortcut: drop an "@" at the caret and open the mention popup.
  const triggerMention = (): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart ?? textarea.value.length;
    const next =
      textarea.value.slice(0, pos) + "@" + textarea.value.slice(pos);
    const caret = pos + 1;
    textarea.value = next;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    syncDraftText(next, caret);
  };

  return (
    <div
      className={cls("imb-chat-input-wrap", dropActive && "imb-drop-active")}
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive && (
        <div className="imb-drop-hint">{t("Drop files to attach")}</div>
      )}
      <div className="imb-chat-input-card" onPaste={onPasteAttachments}>
        {quotes.length > 0 && (
          <div className="imb-quote-chips">
            {quotes.map((quote, index) => (
              <div
                className="imb-quote-chip"
                key={`${quote.messageId ?? "q"}:${index}`}
              >
                <QuoteGlyph />
                <span className="imb-quote-chip-text">{quote.text}</span>
                <button
                  type="button"
                  className="imb-quote-chip-remove"
                  aria-label={t("Remove")}
                  onClick={() => appStore.removeChatDraftQuote(chatId, index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="imb-attached-files">
            {attachments.map((item, index) => (
              <div className="imb-attached-file-thumb" key={item.id}>
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.attachment.name} />
                ) : (
                  <div className="imb-file-icon-placeholder">
                    <IconFile />
                  </div>
                )}
                <button
                  type="button"
                  className="imb-attached-file-remove"
                  aria-label={`${t("Remove")} ${item.attachment.name}`}
                  onClick={() =>
                    appStore.removeChatDraftAttachment(chatId, index)
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {notice !== null && <div className="imb-attach-notice">{notice}</div>}
        <MentionPopup
          open={mentionOpen}
          employees={filteredEmployees}
          selectedIndex={mentionIndex}
          onSelect={insertMention}
          onHoverIndex={setMentionIndex}
        />
        <Textarea
          ref={textareaRef}
          className="imb-chat-input-textarea"
          rows={1}
          // Uncontrolled: React never rewrites the DOM value, so IME
          // composition and first keystrokes are never interrupted.
          defaultValue={text}
          placeholder={t("What are your instructions?")}
          disabled={disabled}
          minHeight={0}
          onInput={(e) =>
            syncDraftText(e.currentTarget.value, e.currentTarget.selectionStart)
          }
          onChange={onTextChange}
          onValueCommit={(val) => syncDraftText(val)}
          onSelect={onTextSelect}
          onKeyDown={onKeyDown}
        />
        <div className="imb-chat-input-actions">
          <div className="imb-input-tools">
            <div className="imb-attach-anchor" ref={popupRef}>
            <button
              type="button"
              className="imb-attach-btn"
              aria-label={t("Attach")}
              title={t("Attach")}
              onClick={() => {
                if (popupOpen) {
                  setPopupOpen(false);
                  return;
                }
                positionPanel();
                setPopupOpen(true);
              }}
            >
              <IconAttach />
            </button>
            {popupOpen &&
              panelStyle &&
              createPortal(
                <div
                  ref={popupMenuRef}
                  className="imb-attach-popup imb-open"
                  role="menu"
                  style={{
                    position: "fixed",
                    top: panelStyle.top,
                    bottom: panelStyle.bottom,
                    left: panelStyle.left,
                    width: panelStyle.width,
                    maxHeight: panelStyle.maxHeight,
                    right: "auto",
                    zIndex: 50,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="imb-attach-popup-item"
                    onClick={() => {
                      setPopupOpen(false);
                      imageInputRef.current?.click();
                    }}
                  >
                    <IconImage />
                    <span>{t("Image")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="imb-attach-popup-item"
                    onClick={() => {
                      setPopupOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <IconFile />
                    <span>{t("File")}</span>
                  </button>
                </div>,
                document.body,
              )}
            </div>
            <button
              type="button"
              className="imb-attach-btn"
              aria-label={t("Mention")}
              title={t("Mention")}
              onClick={triggerMention}
            >
              <span className="imb-mention-glyph">@</span>
            </button>
          </div>
          <button
            type="button"
            className="imb-send-btn-circle"
            aria-label={t("Send")}
            disabled={
              disabled ||
              (!text.trim() && attachments.length === 0 && quotes.length === 0)
            }
            onClick={send}
          >
            <IconSend />
          </button>
        </div>
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files ? Array.from(e.target.files) : null);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files ? Array.from(e.target.files) : null);
          e.target.value = "";
        }}
      />
    </div>
  );
}
