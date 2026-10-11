import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@shared/constants/locales";
import { SettingKeys } from "@shared/constants/settings";
import {
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL_KEYS,
} from "@shared/constants/thinking";
import { t } from "@shared/l10n";
import type { WorkDirState } from "@shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStore, useApp } from "../../../../app-store";
import { setLocale } from "../../../../locale";
import { DetailBody } from "../../../detail-pane/detail-body";
import { DetailHead } from "../../../detail-pane/detail-head";
import { Field } from "../../../field";
import { IconPlus, IconTrash } from "../../../icons";
import { Input } from "../../../input";
import { Select } from "../../../select";
import "./index.css";

interface EnvVar {
  key: string;
  value: string;
}

const SAVE_DEBOUNCE_MS = 400;

export function SettingsGeneral(): React.JSX.Element {
  const { locale } = useApp();
  const [defaultModel, setDefaultModel] = useState("");
  const [defaultThinking, setDefaultThinking] = useState("");
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [workdir, setWorkdir] = useState<WorkDirState | null>(null);
  const [workdirError, setWorkdirError] = useState<string | null>(null);
  const [brandNameDraft, setBrandNameDraft] = useState("");
  const [brandLogoDraft, setBrandLogoDraft] = useState<string | null>(null);
  const [brandError, setBrandError] = useState<string | null>(null);
  const brandLogoInputRef = useRef<HTMLInputElement>(null);
  const envTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistEnv = useCallback((next: EnvVar[]): void => {
    if (envTimerRef.current) clearTimeout(envTimerRef.current);
    envTimerRef.current = setTimeout(() => {
      void imb.settings.set(SettingKeys.UserEnv, JSON.stringify(next));
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [
        defaultModelStored,
        defaultThinkingStored,
        envStored,
        models,
        workDir,
        brandNameStored,
        brandLogoStored,
      ] = await Promise.all([
        imb.settings.get(SettingKeys.DefaultModel),
        imb.settings.get(SettingKeys.DefaultThinkingLevel),
        imb.settings.get(SettingKeys.UserEnv),
        imb.models.list(),
        imb.workdir.get(),
        imb.settings.get(SettingKeys.BrandName),
        imb.settings.get(SettingKeys.BrandLogo),
      ]);
      if (!alive) return;
      setDefaultModel(defaultModelStored ?? "");
      setDefaultThinking(defaultThinkingStored ?? "");
      setEnvVars(parseEnv(envStored));
      setModelOptions(models.map((m) => `${m.provider}/${m.id}`));
      setWorkdir(workDir);
      setBrandNameDraft(brandNameStored ?? "");
      setBrandLogoDraft(brandLogoStored ? brandLogoStored : null);
    })();
    return () => {
      alive = false;
      if (envTimerRef.current) clearTimeout(envTimerRef.current);
    };
  }, []);

  function changeDefaultModel(value: string): void {
    setDefaultModel(value);
    void imb.settings.set(SettingKeys.DefaultModel, value);
  }

  function changeDefaultThinking(value: string): void {
    setDefaultThinking(value);
    void imb.settings.set(SettingKeys.DefaultThinkingLevel, value);
  }

  async function chooseWorkdir(): Promise<void> {
    setWorkdirError(null);
    try {
      const next = await imb.workdir.choose();
      if (next) setWorkdir(next);
    } catch (err) {
      setWorkdirError(err instanceof Error ? err.message : String(err));
    }
  }

  function updateEnv(next: EnvVar[]): void {
    setEnvVars(next);
    persistEnv(next);
  }

  function addEnv(): void {
    const next = [...envVars, { key: "", value: "" }];
    updateEnv(next);
    requestAnimationFrame(() => {
      const rows =
        document.querySelectorAll<HTMLInputElement>(".imb-env-key-input");
      rows[rows.length - 1]?.focus();
    });
  }

  function removeEnv(index: number): void {
    updateEnv(envVars.filter((_, i) => i !== index));
  }

  function onBrandNameChange(value: string): void {
    setBrandNameDraft(value);
    appStore.setBrand(value, brandLogoDraft);
  }

  function onBrandLogoPicked(file: File | undefined): void {
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setBrandError(t("Image is too large (max 1 MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      setBrandLogoDraft(url);
      appStore.setBrand(brandNameDraft, url);
      setBrandError(null);
    };
    reader.readAsDataURL(file);
  }

  function clearBrandLogo(): void {
    setBrandLogoDraft(null);
    appStore.setBrand(brandNameDraft, null);
    setBrandError(null);
  }

  return (
    <>
      <DetailHead
        eyebrow="General"
        title={t("General")}
        sub={t("App language and basic settings")}
      />
      <DetailBody>
        <Field
          label={t("App name")}
          htmlFor="settings-brand-name"
          hint={t("Shown at the top of the sidebar. Leave empty for \"imboss\".")}
        >
          <Input
            id="settings-brand-name"
            value={brandNameDraft}
            maxLength={40}
            placeholder="imboss"
            onChange={(e) => onBrandNameChange(e.target.value)}
          />
        </Field>

        <Field
          label={t("App avatar")}
          hint={t("Upload a logo image (PNG/SVG, max 1 MB).")}
          error={brandError ?? undefined}
        >
          <div className="imb-brand-logo-row">
            {brandLogoDraft ? (
              <img className="imb-brand-logo-preview" src={brandLogoDraft} alt="" />
            ) : (
              <span className="imb-brand-logo-empty">{t("Default")}</span>
            )}
            <button
              type="button"
              className="imb-env-add-btn"
              onClick={() => brandLogoInputRef.current?.click()}
            >
              {t("Change avatar")}
            </button>
            {brandLogoDraft && (
              <button
                type="button"
                className="imb-env-add-btn"
                onClick={clearBrandLogo}
              >
                {t("Remove")}
              </button>
            )}
            <input
              ref={brandLogoInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                onBrandLogoPicked(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </Field>
        <Field
          label={t("App language")}
          hint={t(
            "Switch the interface language. Currently only Simplified Chinese and English are supported.",
          )}
        >
          <Select
            value={SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE}
            options={SUPPORTED_LOCALES.map((l) => ({
              value: l,
              label: l === "zh-CN" ? "简体中文" : "English",
            }))}
            onChange={setLocale}
          />
        </Field>

        <Field
          label={t("Default model")}
          hint={t(
            "Combines models from all providers, used as the default model for new employees / tasks.",
          )}
        >
          <Select
            value={defaultModel}
            options={[
              { value: "", label: t("None") },
              ...modelOptions.map((m) => ({ value: m, label: m })),
            ]}
            onChange={changeDefaultModel}
          />
        </Field>

        <Field
          label={t("Default thinking level")}
          hint={t(
            "The default thinking strength for new employees / tasks. Unset lets each model apply its own default.",
          )}
        >
          <Select
            value={defaultThinking}
            options={[
              { value: "", label: t("None") },
              ...THINKING_LEVELS.map((level) => ({
                value: level,
                label: t(THINKING_LEVEL_LABEL_KEYS[level]),
              })),
            ]}
            onChange={changeDefaultThinking}
          />
        </Field>

        <Field
          label={t("Working directory")}
          hint={t(
            "The working directory (cwd) for agent sessions — used by shell commands and project context files. Defaults to the app's own workdir.",
          )}
          error={workdirError ?? undefined}
        >
          <div className="imb-settings-workdir-row">
            <Input
              className="imb-workdir-path"
              value={workdir?.effective ?? ""}
              readOnly
              mono
              aria-label={t("Working directory")}
            />
            {workdir?.isDefault && (
              <span className="imb-workdir-badge">{t("Default")}</span>
            )}
            <button
              type="button"
              className="imb-env-add-btn"
              onClick={() => void chooseWorkdir()}
            >
              {t("Browse…")}
            </button>
          </div>
        </Field>

        <div className="imb-settings-env-section">
          <label className="imb-settings-env-title">
            {t("Environment variables")}
          </label>
          <span className="imb-settings-env-help">
            {t(
              "Provides runtime environment variables for MCP servers and agents. One key-value pair per line. Values support $VAR / ${VAR} references (e.g. $PATH) resolved against the app's own environment.",
            )}
          </span>
          <div className="imb-env-list">
            {envVars.length === 0 && (
              <span className="imb-settings-env-empty">
                {t("No environment variables configured")}
              </span>
            )}
            {envVars.map((env, index) => (
              <div className="imb-env-row" key={index}>
                <Input
                  className="imb-env-key-input imb-env-key"
                  value={env.key}
                  placeholder="KEY"
                  aria-label="KEY"
                  onChange={(e) =>
                    updateEnv(
                      envVars.map((item, i) =>
                        i === index ? { ...item, key: e.target.value } : item,
                      ),
                    )
                  }
                />
                <span className="imb-env-sep">=</span>
                <Input
                  className="imb-env-value-input"
                  value={env.value}
                  placeholder="value"
                  aria-label="value"
                  onChange={(e) =>
                    updateEnv(
                      envVars.map((item, i) =>
                        i === index ? { ...item, value: e.target.value } : item,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="imb-btn-icon"
                  aria-label={t("Remove environment variable")}
                  title={t("Remove environment variable")}
                  onClick={() => removeEnv(index)}
                >
                  <IconTrash className="imb-icon imb-sm" />
                </button>
              </div>
            ))}
          </div>
          <div className="imb-env-add-row">
            <button type="button" className="imb-env-add-btn" onClick={addEnv}>
              <IconPlus className="imb-icon imb-sm" />
              {t("Add environment variable")}
            </button>
          </div>
        </div>
      </DetailBody>
    </>
  );
}

function parseEnv(raw: string | null): EnvVar[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is EnvVar =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as EnvVar).key === "string" &&
          typeof (item as EnvVar).value === "string",
      )
      .map((item) => ({ key: item.key, value: item.value }));
  } catch {
    return [];
  }
}
