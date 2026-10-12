import { t } from "@shared/l10n";
import type { WorkbenchEntry, WorkbenchFile, WorkbenchListing } from "@shared/types";
import { useCallback, useEffect, useState } from "react";
import { cls } from "reactutils";
import { IconBack, IconFile, IconRefresh, IconX } from "../icons";
import "./index.css";

/**
 * The right dock: a panel beside the content that browses the folder the agents
 * work in and previews files (text and images). It is the app's workbench
 * surface — the place to look at what the team produced. It is a real grid
 * column of the app shell, so opening it pushes the content aside.
 */
export function RightDock({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const [path, setPath] = useState("");
  const [listing, setListing] = useState<WorkbenchListing | null>(null);
  const [file, setFile] = useState<WorkbenchFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (next: string): Promise<void> => {
    setLoading(true);
    try {
      const result = await imb.workbench.list(next);
      setListing(result);
      setFile(null);
      setPath(result.path);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const openFile = useCallback(async (target: string): Promise<void> => {
    setLoading(true);
    try {
      setFile(await imb.workbench.read(target));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (listing === null) void loadDir("");
  }, [listing, loadDir]);

  const onEntry = (entry: WorkbenchEntry): void => {
    if (entry.dir) void loadDir(entry.path);
    else void openFile(entry.path);
  };

  return (
    <aside className="imb-dock" aria-label={t("Workbench")}>
      <div className="imb-dock-head">
        <span className="imb-dock-title">{t("Workbench")}</span>
        <div className="imb-dock-head-actions">
          <button
            type="button"
            className="imb-dock-icon-btn"
            title={t("Refresh")}
            aria-label={t("Refresh")}
            onClick={() => void loadDir(path)}
          >
            <IconRefresh />
          </button>
          <button
            type="button"
            className="imb-dock-icon-btn"
            title={t("Close")}
            aria-label={t("Close")}
            onClick={onClose}
          >
            <IconX />
          </button>
        </div>
      </div>

      <div className="imb-dock-path" title={file ? file.path : path}>
        {file !== null ? (
          <button
            type="button"
            className="imb-dock-back"
            onClick={() => setFile(null)}
          >
            <IconBack />
            {file.name}
          </button>
        ) : (
          <span className="imb-dock-path-text">{path}</span>
        )}
      </div>

      <div className="imb-dock-body">
        {error !== null && <p className="imb-error-text">{error}</p>}

        {file !== null ? (
          <FilePreview file={file} />
        ) : (
          <div className="imb-dock-list">
            {listing !== null && listing.parent !== null && (
              <button
                type="button"
                className="imb-dock-row imb-dock-up"
                onClick={() => void loadDir(listing.parent ?? "")}
              >
                <IconBack />
                <span className="imb-dock-row-name">{t("Parent folder")}</span>
              </button>
            )}
            {listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={cls("imb-dock-row", entry.dir && "imb-is-dir")}
                onClick={() => onEntry(entry)}
              >
                <span className="imb-dock-row-icon">
                  <IconFile />
                </span>
                <span className="imb-dock-row-name">{entry.name}</span>
                {!entry.dir && (
                  <span className="imb-dock-row-size">
                    {formatSize(entry.size)}
                  </span>
                )}
              </button>
            ))}
            {!loading && listing !== null && listing.entries.length === 0 && (
              <div className="imb-board-empty">{t("This folder is empty")}</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Preview of one file: inline text, an image, or a "cannot preview" note. */
function FilePreview({ file }: { file: WorkbenchFile }): React.JSX.Element {
  if (file.kind === "image" && file.dataUrl) {
    return (
      <div className="imb-dock-preview imb-dock-preview-image">
        <img src={file.dataUrl} alt={file.name} />
      </div>
    );
  }
  if (file.kind === "text") {
    return (
      <div className="imb-dock-preview">
        <pre className="imb-dock-text">{file.text}</pre>
        {file.truncated && (
          <p className="imb-module-note">{t("Showing the first part only.")}</p>
        )}
      </div>
    );
  }
  return (
    <div className="imb-dock-preview imb-dock-preview-empty">
      <p className="imb-module-note">
        {t("This file cannot be previewed.")}
      </p>
      <span className="imb-dock-row-size">{formatSize(file.size)}</span>
    </div>
  );
}

/** Compact file size: 12 B / 3.4 KB / 1.2 MB. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
