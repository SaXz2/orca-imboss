import { t } from "@shared/l10n";
import type { ThemeMode } from "@shared/types";
import { cls } from "reactutils";
import { useApp } from "../../../../app-store";
import { setTheme, THEME_COLORS, THEME_PALETTES } from "../../../../theme";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { SegmentedControl } from "../../../segmented-control";
import "./index.css";

export function SettingsTheme(): React.JSX.Element {
  const { theme } = useApp();

  const activeColor = THEME_COLORS.find(
    (c) => c.hex.toLowerCase() === theme.color.toLowerCase(),
  )?.id;

  return (
    <>
      <DetailHead
        eyebrow="Theme"
        title={t("Theme")}
        sub={t("Palette, accent color and mode")}
      />
      <DetailBody>
        <div className="imb-theme-section">
          <label>{t("Surface palette")}</label>
          <div
            className="imb-theme-cards"
            role="radiogroup"
            aria-label={t("Surface palette")}
          >
            {THEME_PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={theme.theme === palette.id}
                title={t(`theme.${palette.id}`)}
                aria-label={t(`theme.${palette.id}`)}
                className={cls(
                  "imb-theme-card",
                  theme.theme === palette.id && "imb-is-active",
                )}
                onClick={() =>
                  void setTheme({ theme: palette.id, color: palette.accent })
                }
              >
                <span
                  className="imb-theme-card-preview"
                  style={{ background: palette.swatch[0] }}
                >
                  <span
                    className="imb-theme-card-surface"
                    style={{ background: palette.swatch[1] }}
                  />
                  <span
                    className="imb-theme-card-dot"
                    style={{ background: palette.accent }}
                  />
                </span>
                <span className="imb-theme-card-name">
                  {t(`theme.${palette.id}`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="imb-theme-section">
          <label>{t("Accent color")}</label>
          <div
            className="imb-theme-grid"
            role="radiogroup"
            aria-label={t("Accent color")}
          >
            {THEME_COLORS.map((color) => (
              <div className="imb-theme-item" key={color.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={
                    color.hex.toLowerCase() === theme.color.toLowerCase()
                  }
                  title={t(color.id)}
                  aria-label={t(color.id)}
                  className={cls(
                    "imb-theme-swatch",
                    activeColor === color.id && "imb-is-active",
                  )}
                  style={{ background: color.hex }}
                  onClick={() => void setTheme({ color: color.hex })}
                />
                <span className="imb-theme-name">{t(color.id)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="imb-theme-section">
          <label>{t("Theme mode")}</label>
          <SegmentedControl<ThemeMode>
            value={theme.mode}
            onChange={(mode) => void setTheme({ mode })}
            options={[
              { value: "light", label: t("Light") },
              { value: "dark", label: t("Dark") },
              { value: "system", label: t("System") },
            ]}
          />
        </div>
      </DetailBody>
    </>
  );
}
