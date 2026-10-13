import type { MessageAttachment } from "@shared/types";
import { useEffect, useState } from "react";
import "./index.css";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

/** True when an attachment can be shown inline as an image. */
export function isImageAttachment(attachment: MessageAttachment): boolean {
  if (
    typeof attachment.type === "string" &&
    attachment.type.startsWith("image/")
  ) {
    return true;
  }
  const source = attachment.path ?? attachment.name;
  const ext = source.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(ext);
}

export interface ImageAttachmentProps {
  messageId: number;
  /** Attachment index within the message (for the data IPC). */
  index: number;
  name: string;
  /** Open the file in the OS file manager. */
  onReveal: () => void;
  /** Rendered instead when the image cannot be loaded (e.g. file gone). */
  fallback: React.ReactNode;
}

/**
 * Inline image preview for a message attachment.
 *
 * The bytes are read on demand from the main process as a data URL (the
 * stored path never reaches the renderer); while loading it shows a
 * placeholder, and on failure it degrades to the caller's file chip.
 */
export function ImageAttachment({
  messageId,
  index,
  name,
  onReveal,
  fallback,
}: ImageAttachmentProps): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setFailed(false);
    imb.messages
      .attachmentData(messageId, index)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [messageId, index]);

  if (failed) return <>{fallback}</>;

  return (
    <button
      type="button"
      className="imb-bubble-image-btn"
      title={name}
      onClick={onReveal}
    >
      {src === null ? (
        <span className="imb-bubble-image-loading" aria-label={name} />
      ) : (
        <img className="imb-bubble-image" src={src} alt={name} loading="lazy" />
      )}
    </button>
  );
}
