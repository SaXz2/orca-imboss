import { t } from "@shared/l10n";
import { cls } from "reactutils";
import { useEffect, useState } from "react";
import { Button } from "../../../button";
import { IconFolder } from "../../../icons";
import { Input } from "../../../input";
import { Modal } from "../../../modal";
import "./index.css";

export interface FolderEditorProps {
  open: boolean;
  /** Modal heading (e.g. "New folder" / "Rename folder"). */
  title: string;
  /** Submit button label (e.g. "Create" / "Save"). */
  submitLabel: string;
  /** Show the workspace-folder picker (create only). */
  withFolder: boolean;
  initialName?: string;
  onCancel: () => void;
  onSubmit: (name: string, folder: string | null) => void;
}

/** Shorten an absolute path to its last segment for display. */
function folderLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Create / rename a conversation folder (and, on create, pin its workspace).
 *
 * A folder is where chats live: opening it lists the chats inside, and its
 * workspace folder is the working directory those chats' sessions run in —
 * changeable at any time. The picker offers the folders used before, so a
 * workspace is one click away, plus a native browse dialog.
 */
export function FolderEditor({
  open,
  title,
  submitLabel,
  withFolder,
  initialName = "",
  onCancel,
  onSubmit,
}: FolderEditorProps): React.JSX.Element {
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setFolder(null);
  }, [open, initialName]);

  useEffect(() => {
    if (!open || !withFolder) return;
    void imb.chats.recentFolders().then(setRecent);
  }, [open, withFolder]);

  async function pick(): Promise<void> {
    const chosen = await imb.chats.pickFolder();
    if (!chosen) return;
    setFolder(chosen);
    setRecent(await imb.chats.recentFolders());
  }

  async function forget(path: string): Promise<void> {
    await imb.chats.forgetFolder(path);
    setRecent(await imb.chats.recentFolders());
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => onSubmit(name, withFolder ? folder : null)}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <Input
        value={name}
        autoFocus
        maxLength={80}
        placeholder={t("Folder name")}
        aria-label={t("Folder name")}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit(name, withFolder ? folder : null);
          }
        }}
      />
      {withFolder && (
        <>
          <p className="imb-folder-editor-label">
            {t(
              "Workspace folder (chats here use it as their working directory)",
            )}
          </p>
          <div className="imb-folder-editor-row">
            <button
              type="button"
              className={cls(
                "imb-folder-editor-path",
                folder !== null && "imb-is-set",
              )}
              title={folder ?? undefined}
              onClick={() => void pick()}
            >
              <IconFolder className="imb-icon imb-sm" />
              <span className="imb-folder-editor-path-text">
                {folder === null
                  ? t("No workspace folder")
                  : folderLabel(folder)}
              </span>
            </button>
            <Button variant="secondary" onClick={() => void pick()}>
              {t("Choose a folder")}
            </Button>
          </div>
          {recent.length > 0 && (
            <div className="imb-folder-editor-recent">
              <div className="imb-folder-editor-recent-title">
                {t("Recent folders")}
              </div>
              <div className="imb-folder-editor-recent-list">
                {recent.map((path) => (
                  <div
                    key={path}
                    className={cls(
                      "imb-folder-editor-item",
                      folder === path && "imb-is-active",
                    )}
                  >
                    <button
                      type="button"
                      className="imb-folder-editor-item-main"
                      onClick={() => setFolder(path)}
                    >
                      <IconFolder className="imb-icon imb-sm" />
                      <span className="imb-folder-editor-item-text">
                        <span className="imb-folder-editor-item-name">
                          {folderLabel(path)}
                        </span>
                        <span className="imb-folder-editor-item-path">
                          {path}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="imb-folder-editor-item-x"
                      title={t("Remove")}
                      aria-label={t("Remove")}
                      onClick={() => void forget(path)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
