/**
 * Right-dock workbench types: a read-only view of the folder the agents work
 * in — directory listings and file previews.
 */

/** One entry in a directory listing. */
export interface WorkbenchEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  /** Epoch milliseconds of the last modification. */
  mtime: number;
}

/** One directory's listing. */
export interface WorkbenchListing {
  /** Absolute directory path. */
  path: string;
  /** Parent directory, or null at the workbench root. */
  parent: string | null;
  entries: WorkbenchEntry[];
}

/** A file prepared for preview. */
export interface WorkbenchFile {
  path: string;
  name: string;
  kind: "text" | "image" | "binary";
  /** Present for `text`. */
  text?: string;
  /** Present for `image`. */
  dataUrl?: string;
  size: number;
  /** True when a text file was cut off at the preview limit. */
  truncated?: boolean;
}
