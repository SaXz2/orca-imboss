import { t } from "@shared/l10n";
import type { ThemeMode } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { cls } from "reactutils";
import { appStore, IS_MAC, useApp } from "../../app-store";
import { useClickOutside } from "../../hooks/use-click-outside";
import { useEscapeKey } from "../../hooks/use-escape-key";
import { setTheme, THEME_PALETTES } from "../../theme";
import { IconBack, IconForward } from "../icons";
import "./index.css";

const stroke = { stroke: "currentColor", strokeWidth: 1.4 } as const;

/**
 * Full-width title bar / drag region (row 1 of `.imb-app`).
 * macOS: empty draggable strip; the native traffic lights sit on its left.
 * Windows/Linux: custom small min/max/close buttons on the right (native
 * controls are hidden via the absence of `titleBarOverlay`).
 * Both platforms get the back / forward controls just left of the window
 * controls.
 */
export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false);
  const { navHistory, navHistoryIndex } = useApp();
  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;

  useEffect(() => {
    let alive = true;
    void imb.windowControls.isMaximized().then((m) => {
      if (alive) setMaximized(m);
    });
    const unsubscribe = imb.windowControls.onMaximized((m) => {
      if (alive) setMaximized(m);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return (
    <header className="imb-titlebar">
      <div className="imb-titlebar-actions">
        <div className="imb-titlebar-toggles">
          <button
            type="button"
            className="imb-titlebar-toggle"
            aria-label={t("Back")}
            title={t("Back")}
            disabled={!canGoBack}
            onClick={() => appStore.goBack()}
          >
            <IconBack />
          </button>
          <button
            type="button"
            className="imb-titlebar-toggle"
            aria-label={t("Forward")}
            title={t("Forward")}
            disabled={!canGoForward}
            onClick={() => appStore.goForward()}
          >
            <IconForward />
          </button>
          <ThemeQuickSwitch />
        </div>
        {!IS_MAC && (
        <div className="imb-winbtns">
          <WindowButton
            label="Minimize"
            onClick={() => void imb.windowControls.minimize()}
          >
            <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3 8h10" {...stroke} />
            </svg>
          </WindowButton>
          <WindowButton
            label={maximized ? "Restore" : "Maximize"}
            onClick={() => void imb.windowControls.toggleMaximize()}
          >
            {maximized ? (
              <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="6"
                  y="3"
                  width="7"
                  height="7"
                  fill="none"
                  {...stroke}
                />
                <rect
                  x="4"
                  y="5"
                  width="7"
                  height="7"
                  fill="var(--imb-bg)"
                  {...stroke}
                />
              </svg>
            ) : (
              <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="4"
                  y="4"
                  width="8"
                  height="8"
                  fill="none"
                  {...stroke}
                />
              </svg>
            )}
          </WindowButton>
          <WindowButton
            label="Close"
            onClose
            onClick={() => void imb.windowControls.close()}
          >
            <svg className="imb-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
            </svg>
          </WindowButton>
        </div>
      )}
      </div>
    </header>
  );
}

interface WindowButtonProps {
  label: string;
  /** Marks the close button for the danger hover state. */
  onClose?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function WindowButton({
  label,
  onClose,
  className,
  onClick,
  children,
}: WindowButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cls("imb-winbtn", className, onClose && "imb-close")}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const THEME_MODES: Array<{ value: ThemeMode; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Title-bar theme shortcut: palette swatches plus a light/dark/system switch. */
function ThemeQuickSwitch(): React.JSX.Element {
  const { theme } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside([ref], () => setOpen(false), open);
  useEscapeKey(() => setOpen(false), open);

  return (
    <div className="imb-theme-quick" ref={ref}>
      <button
        type="button"
        className="imb-titlebar-toggle"
        aria-label={t("Theme")}
        title={t("Theme")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="imb-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="8.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="imb-theme-quick-panel" role="menu">
          <div className="imb-theme-quick-modes">
            {THEME_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={cls(
                  "imb-theme-quick-mode",
                  theme.mode === mode.value && "imb-is-active",
                )}
                onClick={() => void setTheme({ mode: mode.value })}
              >
                {t(mode.label)}
              </button>
            ))}
          </div>
          <div className="imb-theme-quick-palettes">
            {THEME_PALETTES.map((palette) => (
              <button
                key={palette.id}
                type="button"
                className={cls(
                  "imb-theme-quick-swatch",
                  theme.theme === palette.id && "imb-is-active",
                )}
                title={t(`theme.${palette.id}`)}
                aria-label={t(`theme.${palette.id}`)}
                style={{ background: palette.swatch[0] }}
                onClick={() =>
                  void setTheme({ theme: palette.id, color: palette.accent })
                }
              >
                <span
                  className="imb-theme-quick-swatch-dot"
                  style={{ background: palette.accent }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
