import { READ_CHAT_PROMPT } from "@shared/constants/prompts";
import { ipcMain, shell } from "electron";
import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute } from "path";
import { wakeAgent } from "../agent/session-queue";
import * as dbMessages from "../db/messages";
import { assertInteger, assertObject, assertString } from "./helpers";

export function registerMessageHandlers(): void {
  ipcMain.handle("messages:list", (_event, chatId: unknown) =>
    dbMessages.listMessages(assertInteger(chatId, "chat id")),
  );

  ipcMain.handle("messages:search", (_event, query: unknown) =>
    dbMessages.searchMessages(assertString(query, "query")),
  );

  ipcMain.handle(
    "messages:append",
    (_event, chatId: unknown, senderEmployeeId: unknown, content: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeSender =
        senderEmployeeId === null
          ? null
          : assertInteger(senderEmployeeId, "sender id");
      return dbMessages.appendMessage(
        safeChatId,
        safeSender,
        assertString(content, "content"),
      );
    },
  );

  // Human (or any renderer) answers an ask message: append a kind=`answer`
  // system message and wake the ask's sender agent so it can react.
  ipcMain.handle(
    "messages:answer",
    (_event, chatId: unknown, askMessageId: unknown, answers: unknown) => {
      const safeChatId = assertInteger(chatId, "chat id");
      const safeAskId = assertInteger(askMessageId, "ask message id");
      const ask = dbMessages.getMessageById(safeAskId);
      if (!ask || ask.chatId !== safeChatId || ask.kind !== "ask") {
        throw new Error("Ask message does not exist.");
      }
      // Stamp the answer with the ask it replies to so the card can rehydrate
      // its retained options/text after a reload. Set after the spread so a
      // renderer-supplied `askMessageId` can never override it.
      const payload = {
        ...assertObject(answers, "answers"),
        askMessageId: safeAskId,
      };
      const message = dbMessages.appendMessage(
        safeChatId,
        null,
        JSON.stringify(payload),
        { kind: "answer" },
      );
      if (ask.senderEmployeeId != null) {
        // `wakeAgent` redirects the assistant (id 0) from a task group chat to
        // its root-chat session.
        void wakeAgent(ask.senderEmployeeId, safeChatId, READ_CHAT_PROMPT);
      }
      return message;
    },
  );

  // Reveal a message attachment in the OS file manager. The renderer only
  // passes the message id + index; the path is read from the trusted stored
  // record so a compromised renderer can never reveal arbitrary paths.
  ipcMain.handle(
    "messages:revealAttachment",
    (_event, messageId: unknown, index: unknown) => {
      const safeId = assertInteger(messageId, "message id");
      const safeIndex = assertInteger(index, "attachment index");
      if (safeIndex < 0) {
        throw new Error("Attachment index must be non-negative.");
      }
      const message = dbMessages.getMessageById(safeId);
      if (!message) throw new Error("Message does not exist.");
      const attachments = message.attachments;
      if (!attachments || safeIndex >= attachments.length) {
        throw new Error("Attachment does not exist.");
      }
      const path = attachments[safeIndex].path;
      if (!path) throw new Error("Attachment location is unavailable.");
      if (!isAbsolute(path)) {
        throw new Error("Attachment location is invalid.");
      }
      if (!existsSync(path)) {
        throw new Error("Attachment file no longer exists.");
      }
      shell.showItemInFolder(path);
    },
  );

  // Read an image attachment's bytes as a data URL so the renderer can show it
  // inline. The path comes from the trusted stored record (never the renderer),
  // only image types are served, and the size is capped.
  ipcMain.handle(
    "messages:attachmentData",
    (_event, messageId: unknown, index: unknown) => {
      const safeId = assertInteger(messageId, "message id");
      const safeIndex = assertInteger(index, "attachment index");
      const message = dbMessages.getMessageById(safeId);
      if (!message) throw new Error("Message does not exist.");
      const attachments = message.attachments;
      if (!attachments || safeIndex < 0 || safeIndex >= attachments.length) {
        throw new Error("Attachment does not exist.");
      }
      const attachment = attachments[safeIndex];
      const path = attachment.path;
      if (!path || !isAbsolute(path) || !existsSync(path)) {
        throw new Error("Attachment file is unavailable.");
      }
      const mime = isImageMime(attachment.type)
        ? attachment.type
        : imageMimeByExtension(path);
      if (!mime) throw new Error("Attachment is not an image.");
      if (statSync(path).size > MAX_IMAGE_BYTES) {
        throw new Error("Image is too large to preview.");
      }
      return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
    },
  );
}

/** Largest image (bytes) served inline to the renderer as a preview. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

function isImageMime(type: string): boolean {
  return typeof type === "string" && type.startsWith("image/");
}

function imageMimeByExtension(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_BY_EXT[ext] ?? null;
}
