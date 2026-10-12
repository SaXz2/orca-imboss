export type ThemeMode = "light" | "dark" | "system";

/**
 * Named surface palette layered on top of the light/dark mode. `default`
 * keeps the built-in neutral look; the rest retint surfaces, text and borders
 * (each palette ships both a light and a dark variant) while leaving the
 * accent color user-controlled.
 */
export const THEME_PALETTES = [
  "default",
  "paper",
  "sepia",
  "forest",
  "sakura",
  "ocean",
  "mono",
] as const;

export type ThemePalette = (typeof THEME_PALETTES)[number];

/** State pushed/returned by the theme IPC (`theme:get` / `theme:set`). */
export interface ThemeState {
  mode: ThemeMode;
  /** 6-digit hex accent color, e.g. `#07C160`. */
  color: string;
  /** Named surface palette. */
  theme: ThemePalette;
}

/** An installed skill under `~/.imboss/agent/skills/<name>/SKILL.md`. */
export interface InstalledSkill {
  name: string;
  /** Parsed from SKILL.md frontmatter when available. */
  description: string | null;
}
