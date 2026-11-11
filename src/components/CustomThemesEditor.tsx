import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { Download, Pencil, Plus, Trash2, TriangleAlert, Upload } from "lucide-react";
import ThemeCard from "./ThemeCard";
import { useT, type MessageKey } from "../lib/i18n";
import type { AppSettings } from "../lib/settings";
import { resolveTheme } from "../lib/themes";
import {
  customThemeKey,
  exportThemeJson,
  importThemeJson,
  lowContrastPairs,
  MAX_CUSTOM_THEMES,
  newThemeId,
  type CustomTheme,
  type ThemeColors,
} from "../lib/customThemes";

/** Un tema exportado ocupa menos de 1 KB: más que esto no es un tema. */
const MAX_IMPORT_BYTES = 64 * 1024;

const FIELD =
  "rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60";

/** Colores que se tocan a mano; `eyes` se hereda del tema de partida. */
const EDITABLE: { key: keyof ThemeColors; labelKey: MessageKey }[] = [
  { key: "bg", labelKey: "themes.color.bg" },
  { key: "panel", labelKey: "themes.color.panel" },
  { key: "card", labelKey: "themes.color.card" },
  { key: "border", labelKey: "themes.color.border" },
  { key: "text", labelKey: "themes.color.text" },
  { key: "muted", labelKey: "themes.color.muted" },
];

const WARNING_LABEL: Record<"text" | "muted" | "accent", MessageKey> = {
  text: "themes.color.text",
  muted: "themes.color.muted",
  accent: "themes.color.accent",
};

interface CustomThemesEditorProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  /** Tema en edición, para que la app entera se pinte con él (`null` al terminar). */
  onPreview: (theme: CustomTheme | null) => void;
}

/** Colores del tema activo como punto de partida de uno nuevo. */
function draftFrom(settings: AppSettings, id: string, name: string): CustomTheme {
  const palette = resolveTheme(settings.theme, settings.customThemes);
  const v = (name: string) => palette.vars[`--color-gus-${name}`];
  return {
    id,
    name,
    scheme: palette.scheme,
    accent: palette.accent,
    colors: { bg: v("bg"), panel: v("panel"), card: v("card"), border: v("border"), text: v("text"), muted: v("muted"), eyes: v("eyes") },
  };
}

/**
 * Temas personalizados (interfaz REQ-03): crear, editar con la app como vista
 * previa en vivo, borrar, exportar a JSON e importar.
 */
export default function CustomThemesEditor({ settings, onChange, onPreview }: CustomThemesEditorProps) {
  const t = useT();
  const customs = settings.customThemes;
  /** Tema en edición; mientras existe, la app entera se pinta con él. */
  const [draft, setDraft] = useState<CustomTheme | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = customs.length >= MAX_CUSTOM_THEMES;

  // Vista previa en vivo: la app entera se pinta con el borrador; al salir de Ajustes se suelta.
  useEffect(() => onPreview(draft), [draft, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  function saveDraft() {
    if (!draft || draft.name.trim() === "") return;
    const clean = { ...draft, name: draft.name.trim() };
    const exists = customs.some((theme) => theme.id === clean.id);
    const nextList = exists ? customs.map((theme) => (theme.id === clean.id ? clean : theme)) : [...customs, clean];
    onChange({ ...settings, customThemes: nextList, theme: customThemeKey(clean), accent: "tema" });
    setDraft(null);
  }

  function remove(theme: CustomTheme) {
    const nextList = customs.filter((item) => item.id !== theme.id);
    const wasActive = settings.theme === customThemeKey(theme);
    onChange({ ...settings, customThemes: nextList, ...(wasActive ? { theme: theme.scheme === "light" ? "gus-claro" : "gus-oscuro" } : {}) });
  }

  async function exportTheme(theme: CustomTheme) {
    try {
      const path = await save({
        defaultPath: `${theme.name}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const saved = await invoke<string>("write_json_file", { path, content: exportThemeJson(theme) });
      setNotice({ ok: true, text: t("themes.exported", { path: saved }) });
    } catch (reason: unknown) {
      setNotice({ ok: false, text: String(reason) });
    }
  }

  async function importFile(file: File) {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("invalidTheme");
      const theme = importThemeJson(await file.text(), newThemeId(customs));
      onChange({ ...settings, customThemes: [...customs, theme], theme: customThemeKey(theme), accent: "tema" });
      setNotice({ ok: true, text: t("themes.imported", { name: theme.name }) });
    } catch (reason: unknown) {
      const code = reason instanceof Error ? reason.message : "";
      setNotice({ ok: false, text: t(code === "invalidJson" ? "themes.invalidJson" : "themes.invalidTheme") });
    }
  }

  const warnings = draft ? lowContrastPairs(draft) : [];

  return (
    <div className="mt-4 flex w-full flex-col gap-3 border-t border-gus-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-body font-medium text-gus-text">{t("themes.custom")}</h4>
        {!draft && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={full}
              onClick={() => setDraft(draftFrom(settings, newThemeId(customs), t("themes.newName")))}
              className="gus-btn gus-btn-secondary"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("themes.new")}
            </button>
            <button type="button" disabled={full} onClick={() => fileRef.current?.click()} className="gus-btn gus-btn-secondary">
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t("themes.import")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className={clsx("break-words text-body", notice.ok ? "text-gus-muted" : "text-rose-400")}>
          {notice.text}
        </p>
      )}

      {draft ? (
        <form
          aria-label={t("themes.editorTitle")}
          className="flex flex-col gap-3 rounded-xl border border-gus-accent/40 bg-gus-panel p-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveDraft();
          }}
        >
          <p className="text-meta text-gus-muted">{t("themes.livePreview")}</p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={draft.name}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              aria-label={t("themes.name")}
              placeholder={t("themes.name")}
              className={clsx(FIELD, "min-w-0 flex-1")}
            />
            <select
              aria-label={t("themes.scheme")}
              value={draft.scheme}
              onChange={(event) => setDraft({ ...draft, scheme: event.target.value as CustomTheme["scheme"] })}
              className={FIELD}
            >
              <option value="dark">{t("themes.dark")}</option>
              <option value="light">{t("themes.light")}</option>
            </select>
          </div>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
            {EDITABLE.map(({ key, labelKey }) => (
              <label key={key} className="flex items-center gap-2 text-body text-gus-text">
                <input
                  type="color"
                  value={draft.colors[key]}
                  onChange={(event) => setDraft({ ...draft, colors: { ...draft.colors, [key]: event.target.value } })}
                  className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gus-border bg-transparent"
                />
                {t(labelKey)}
              </label>
            ))}
            <label className="flex items-center gap-2 text-body text-gus-text">
              <input
                type="color"
                value={draft.accent}
                onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
                className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gus-border bg-transparent"
              />
              {t("themes.color.accent")}
            </label>
          </div>

          {warnings.length > 0 && (
            <p className="flex items-start gap-1.5 text-body text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("themes.lowContrast", {
                list: warnings.map((key) => t(WARNING_LABEL[key])).join(", "),
              })}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="gus-btn gus-btn-ghost">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={draft.name.trim() === ""} className="gus-btn gus-btn-primary">
              {t("common.save")}
            </button>
          </div>
        </form>
      ) : customs.length === 0 ? (
        <p className="text-body text-gus-muted">{t("themes.none")}</p>
      ) : (
        <ul className="grid w-full grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
          {customs.map((theme) => (
            <li key={theme.id} className="flex flex-col gap-1">
              <ThemeCard
                theme={theme}
                selected={settings.theme === customThemeKey(theme)}
                onSelect={() => onChange({ ...settings, theme: customThemeKey(theme), accent: "tema" })}
              />
              <div className="flex justify-center gap-1">
                <button type="button" onClick={() => setDraft(theme)} title={t("themes.edit")} aria-label={t("themes.editNamed", { name: theme.name })} className="gus-btn gus-btn-icon">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => void exportTheme(theme)} title={t("themes.export")} aria-label={t("themes.exportNamed", { name: theme.name })} className="gus-btn gus-btn-icon">
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => remove(theme)} title={t("themes.delete")} aria-label={t("themes.deleteNamed", { name: theme.name })} className="gus-btn gus-btn-icon">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
