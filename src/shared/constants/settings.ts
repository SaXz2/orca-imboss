// Setting keys
export const SettingKeys = {
  Locale: "app.locale",
  DefaultModel: "agent.defaultModel",
  DefaultThinkingLevel: "agent.defaultThinkingLevel",
  UserEnv: "agent.userEnv",
  WorkDir: "agent.workdir",
  /** Outbound HTTP(S) proxy URL for model/provider traffic (empty = direct). */
  HttpProxy: "network.httpProxy",
  ThemeMode: "ui.theme.mode",
  ThemeColor: "ui.theme.color",
  ThemePalette: "ui.theme.palette",
  NavCollapse: "ui.navCollapsed",
  Module: "ui.module",
  WindowState: "ui.window",
  /** Folder id of the last opened mini app (restored on next launch). */
  MiniAppActive: "ui.miniAppActive",
  /** Custom app/brand name shown in the sidebar (empty = "imboss"). */
  BrandName: "ui.brand.name",
  /** Custom brand logo image as a data URL (empty = built-in logo). */
  BrandLogo: "ui.brand.logo",
  UpdateNotifiedVersion: "app.updateNotifiedVersion",
};
