import type {
  WorkbenchEntry,
  WorkbenchFile,
  WorkbenchListing,
} from "@shared/types";
import { promises as fs } from "fs";
import { basename, extname, isAbsolute, relative, resolve } from "path";
import { resolveWorkDir } from "./agent/workdir";

/**
 * The workbench: the folder the agents work in, exposed to the right dock so it
 * can be browsed and files previewed. Read-only, and every path is confined to
 * the workbench root — a request that escapes it is refused.
 */

/** Largest text file the preview will inline. */
const MAX_TEXT_BYTES = 400_000;

/** Largest image the preview will inline as a data URL. */
const MAX_IMAGE_BYTES = 8_000_000;

/** Extensions previewed as images. */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
]);

/** The workbench root (the agents' working directory). */
export function workbenchRoot(): string {
  return resolve(resolveWorkDir());
}

/** Resolve a request path into the workbench, refusing anything outside it. */
function safePath(input: string): string {
  const root = workbenchRoot();
  const target = isAbsolute(input) ? resolve(input) : resolve(root, input);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the workbench.");
  }
  return target;
}

/** List one directory. `""` lists the root. */
export async function listWorkbenchDir(
  input: string,
): Promise<WorkbenchListing> {
  const dir = safePath(input);
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: WorkbenchEntry[] = [];
  for (const dirent of dirents) {
    const path = resolve(dir, dirent.name);
    let size = 0;
    let mtime = 0;
    try {
      const stat = await fs.stat(path);
      size = stat.size;
      mtime = stat.mtimeMs;
    } catch {
      // A file that vanished or is unreadable still shows as a name.
    }
    entries.push({
      name: dirent.name,
      path,
      dir: dirent.isDirectory(),
      size,
      mtime,
    });
  }
  entries.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const root = workbenchRoot();
  return { path: dir, parent: dir === root ? null : resolve(dir, ".."), entries };
}

/** Read a file for preview: text inline, images as data URLs, else metadata. */
export async function readWorkbenchFile(input: string): Promise<WorkbenchFile> {
  const path = safePath(input);
  const stat = await fs.stat(path);
  if (!stat.isFile()) throw new Error("Not a file.");

  const name = basename(path);
  const base: WorkbenchFile = { path, name, kind: "binary", size: stat.size };
  const extension = extname(name).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    if (stat.size > MAX_IMAGE_BYTES) return base;
    const buffer = await fs.readFile(path);
    const mime =
      extension === ".svg" ? "image/svg+xml" : `image/${extension.slice(1)}`;
    return {
      ...base,
      kind: "image",
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  }

  const buffer = await fs.readFile(path);
  // A NUL byte in the first block is the usual "this is not text" tell.
  if (buffer.subarray(0, 4096).includes(0)) return base;

  const truncated = buffer.byteLength > MAX_TEXT_BYTES;
  const slice = truncated ? buffer.subarray(0, MAX_TEXT_BYTES) : buffer;
  return {
    ...base,
    kind: "text",
    text: slice.toString("utf8"),
    truncated,
  };
}
