import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Compass,
  Keyboard,
  Languages,
  ListTodo,
  Minus,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import {
  ACCENTS,
  DEFAULT_SETTINGS,
  SETTINGS_CATEGORIES,
  SETTINGS_DEFINITIONS,
  accentHex,
  type AccentChoice,
  type AccentKey,
  type AppSettings,
  type Language,
  type SettingDefinition,
  type SettingsCategoryId,
} from "../lib/settings";
import { THEME_LIST } from "../lib/themes";
import { LANGUAGE_LIST, useT } from "../lib/i18n";
import { APP_VERSION } from "../lib/version";
import { openExternal } from "../lib/externalLink";
import type { UpdateUiState } from "../lib/updateCheck";
import type { SpellLang } from "../lib/spellCheck";
import {
  SHORTCUT_GROUPS,
  SHORTCUT_LIST,
  comboFor,
  comboLabel,
  comboFromEvent,
  isEditableShortcut,
  shortcutConflict,
  type ShortcutDefinition,
  type ShortcutId,
  type ShortcutMap,
} from "../lib/shortcuts";
import ThemeCard from "./ThemeCard";

const CATEGORY_ICONS: Record<SettingsCategoryId, LucideIcon> = {
  general: SlidersHorizontal,
  appearance: Palette,
  notes: StickyNote,
  tasks: ListTodo,
  calendar: CalendarDays,
  language: Languages,
  shortcuts: Keyboard,
};

const INPUT_CLASS =
  "rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors focus:border-gus-accent/60 placeholder:text-gus-muted";

export interface SettingsPanelProps {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  /** El idioma vive fuera del vault: se guarda y se aplica por separado. */
  language: Language;
  onLanguageChange: (lang: Language) => void;
  /** Vuelve a lanzar el recorrido guiado por la app. */
  onStartTour: () => void;
  /** Pregunta a GitHub si hay una versión más nueva. */
  onCheckUpdate: () => void;
  /** Resultado de la última comprobación de actualizaciones. */
  updateState: UpdateUiState;
}

function Toggle({
  on,
  onPressed,
  label,
}: {
  on: boolean;
  onPressed: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onPressed(!on)}
      className={clsx(
        "relative h-6 w-11 shrink-0 rounded-full border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
        on ? "border-gus-accent bg-gus-accent" : "border-gus-border bg-gus-panel",
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-all",
          on ? "left-[calc(100%-1.375rem)]" : "left-0.5 bg-gus-muted",
        )}
      />
    </button>
  );
}

/** Una tecla por casilla: se pueden activar varios diccionarios a la vez. */
function SpellLanguagePicker({
  options,
  selected,
  onToggle,
  label,
}: {
  options: readonly { value: SpellLang; label: string }[];
  selected: readonly SpellLang[];
  onToggle: (lang: SpellLang) => void;
  label: string;
}) {
  const t = useT();

  return (
    <div className="flex min-w-[13rem] flex-col gap-1.5">
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap gap-1.5 rounded-lg border border-gus-border bg-gus-panel p-1.5"
      >
        {options.map((option) => {
          const isActive = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role="checkbox"
              aria-checked={isActive}
              onClick={() => onToggle(option.value)}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                isActive
                  ? "bg-gus-accent text-gus-bg"
                  : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
              )}
            >
              {isActive && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] leading-snug text-gus-muted">{t("settings.spellLangsHint")}</p>
    </div>
  );
}

/** Botón que captura la pulsación siguiente y la guarda como atajo. */
function ShortcutRecorder({
  definition,
  combo,
  onChange,
}: {
  definition: ShortcutDefinition;
  combo: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  const [conflict, setConflict] = useState<ShortcutDefinition | null>(null);

  const editable = isEditableShortcut(definition.id);
  const label = combo ? comboLabel(combo) : "";

  function finish(next: string) {
    setRecording(false);
    const clash = shortcutConflict(next, definition.id);
    setConflict(clash);
    if (clash) return;
    onChange(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();

    // Supr (sin modificadores) quita el atajo en vez de asignarlo.
    if (event.key === "Delete" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      finish("");
      return;
    }
    // Escape cancela sin guardar.
    if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      setRecording(false);
      return;
    }
    // Los modificadores sueltos no forman combinación: se espera al resto.
    if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;

    // Sin modificador solo se aceptan teclas que no escriban texto: si no, el
    // atajo robaría la escritura normal de una nota.
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const name = event.key.toLowerCase();
      const safe =
        event.key === "F1" ||
        /^f([1-9]|1[0-9]|2[0-4])$/.test(event.key.toLowerCase()) ||
        ["pageup", "pagedown", "home", "end", "insert"].includes(name);
      if (!safe) return;
    }

    finish(comboFromEvent(event.nativeEvent));
  }

  if (!editable) {
    return (
      <span
        title={t("settings.shortcutsBrowser")}
        className="inline-flex h-8 cursor-not-help items-center gap-1 rounded-lg border border-gus-border bg-gus-panel px-2.5 text-xs text-gus-muted/70"
      >
        {label || "—"}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        aria-label={`${t("settings.shortcuts")}: ${t(definition.labelKey)}`}
        onClick={() => {
          setConflict(null);
          setRecording((value) => !value);
        }}
        onBlur={() => setRecording(false)}
        onKeyDown={handleKeyDown}
        className={clsx(
          "inline-flex h-8 min-w-[7.5rem] items-center justify-center gap-1 rounded-lg border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
          recording
            ? "border-gus-accent bg-gus-accent/15 text-gus-accent"
            : "border-gus-border bg-gus-card text-gus-text hover:border-gus-accent/50",
        )}
      >
        {recording
          ? t("settings.shortcutsRecording")
          : label || t("settings.shortcutsUnassigned")}
      </button>

      {conflict && (
        <p role="alert" className="max-w-[16rem] text-right text-[10px] text-amber-400">
          {t("settings.shortcutsConflict", { name: t(conflict.labelKey) })}
        </p>
      )}
    </div>
  );
}

function ShortcutsEditor({
  shortcuts,
  onChange,
}: {
  shortcuts: ShortcutMap;
  onChange: (next: ShortcutMap) => void;
}) {
  const t = useT();

  function setCombo(id: ShortcutId, combo: string) {
    onChange({ ...shortcuts, [id]: combo });
  }

  function resetAll() {
    onChange({ ...DEFAULT_SETTINGS.shortcuts });
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-[11px] text-gus-muted">{t("settings.shortcutsHint")}</p>

      {SHORTCUT_GROUPS.map((group) => {
        const entries = SHORTCUT_LIST.filter((entry) => entry.group === group.id);
        if (entries.length === 0) return null;

        return (
          <div key={group.id} className="flex flex-col gap-1.5">
            <h4 className="text-[10px] font-semibold tracking-wider text-gus-muted uppercase">
              {t(group.labelKey)}
            </h4>

            <div className="flex flex-col divide-y divide-gus-border overflow-hidden rounded-lg border border-gus-border">
              {entries.map((definition) => (
                <div
                  key={definition.id}
                  className="flex items-center justify-between gap-4 bg-gus-card px-3 py-2"
                >
                  <span className="min-w-0 truncate text-xs text-gus-text">
                    {t(definition.labelKey)}
                  </span>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <ShortcutRecorder
                      definition={definition}
                      combo={comboFor(shortcuts, definition.id)}
                      onChange={(next) => setCombo(definition.id, next)}
                    />

                    {isEditableShortcut(definition.id) &&
                      comboFor(shortcuts, definition.id) !==
                        (SHORTCUT_LIST.find((entry) => entry.id === definition.id)
                          ?.defaultCombo ?? "") && (
                        <button
                          type="button"
                          aria-label={`${t("common.restore")}: ${t(definition.labelKey)}`}
                          title={t("common.restore")}
                          onClick={() =>
                            setCombo(
                              definition.id,
                              SHORTCUT_LIST.find((entry) => entry.id === definition.id)
                                ?.defaultCombo ?? "",
                            )
                          }
                          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gus-border bg-gus-card text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <button
          type="button"
          onClick={resetAll}
          title={t("settings.shortcutsResetAllTitle")}
          className={clsx(
            INPUT_CLASS,
            "inline-flex items-center gap-1.5 text-xs text-gus-muted hover:text-gus-text",
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t("settings.shortcutsResetAll")}
        </button>
      </div>
    </div>
  );
}

/**
 * Campo de texto (una o varias líneas) con guardado con retardo: el config
 * del vault se reescribe en disco en cada guardado, así que no se manda cada
 * tecla, sino al parar de escribir o al salir del campo.
 */
function TextSetting({
  value,
  onChange,
  maxLength,
  placeholder,
  label,
  rows,
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength: number;
  placeholder?: string;
  label: string;
  rows?: number;
  hint?: string;
}) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // El valor de fuera manda (p. ej. al pulsar «Restablecer»).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function schedule(next: string) {
    setDraft(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onChangeRef.current(next.slice(0, maxLength));
    }, 400);
  }

  function commitNow() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = draft.slice(0, maxLength);
    if (next !== value) onChangeRef.current(next);
  }

  const field = rows ? (
    <textarea
      value={draft}
      rows={rows}
      maxLength={maxLength}
      aria-label={label}
      spellCheck={false}
      onChange={(event) => schedule(event.target.value)}
      onBlur={commitNow}
      className={clsx(INPUT_CLASS, "w-full min-w-[18rem] resize-y font-mono text-xs leading-relaxed")}
    />
  ) : (
    <input
      type="text"
      value={draft}
      maxLength={maxLength}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(event) => schedule(event.target.value)}
      onBlur={commitNow}
      className={clsx(INPUT_CLASS, "w-64")}
    />
  );

  if (!hint) return field;

  return (
    <div className="flex w-full max-w-[24rem] flex-col gap-1.5">
      {field}
      <p className="text-[11px] leading-snug text-gus-muted">{hint}</p>
    </div>
  );
}

export default function SettingsPanel({
  settings,
  onChange,
  language,
  onLanguageChange,
  onStartTour,
  onCheckUpdate,
  updateState,
}: SettingsPanelProps) {
  const t = useT();
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>("general");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const searching = normalizedQuery.length > 0;

  const searchable = useMemo(
    () =>
      SETTINGS_DEFINITIONS.map((definition) => {
        const category = SETTINGS_CATEGORIES.find((entry) => entry.id === definition.category);
        const haystack = [
          t(definition.labelKey),
          t(definition.descriptionKey),
          definition.keywords,
          category ? t(category.labelKey) : "",
          category?.keywords ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return { definition, haystack };
      }),
    [t],
  );

  const groups = useMemo(() => {
    const matches = searchable.filter(({ haystack }) => haystack.includes(normalizedQuery));

    const wanted = searching
      ? SETTINGS_CATEGORIES.map((category) => category.id)
      : [activeCategory];

    return wanted
      .map((categoryId) => ({
        category: SETTINGS_CATEGORIES.find((entry) => entry.id === categoryId)!,
        items: matches
          .map(({ definition }) => definition)
          .filter((definition) => definition.category === categoryId),
      }))
      .filter((group) => group.items.length > 0);
  }, [searchable, normalizedQuery, searching, activeCategory]);

  function update<Key extends keyof AppSettings>(key: Key, value: AppSettings[Key]) {
    onChange({ ...settings, [key]: value });
  }

  function renderControl(definition: SettingDefinition) {
    if (definition.kind === "toggle") {
      const on = settings[definition.key];
      return (
        <Toggle
          on={on}
          onPressed={(next) => update(definition.key, next)}
          label={t(definition.labelKey)}
        />
      );
    }

    if (definition.kind === "choice") {
      const current = settings[definition.key];
      return (
        <div className="flex items-center gap-1 rounded-lg border border-gus-border bg-gus-panel p-1">
          {definition.options.map((size) => {
            const isActive = current === size;
            return (
              <button
                key={size}
                type="button"
                aria-pressed={isActive}
                onClick={() => update(definition.key, size)}
                style={{ fontSize: `${Math.max(12, size - 2)}px` }}
                className={clsx(
                  "rounded-md px-2.5 py-1 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                  isActive
                    ? "bg-gus-accent text-gus-bg"
                    : "text-gus-muted hover:text-gus-text",
                )}
              >
                {size}px
              </button>
            );
          })}
        </div>
      );
    }

    if (definition.kind === "zoom") {
      const current = settings[definition.key];
      const clamp = (value: number) => Math.min(200, Math.max(50, value));
      return (
        <div className="flex items-center gap-1 rounded-lg border border-gus-border bg-gus-panel p-1">
          <button
            type="button"
            aria-label={t("settings.zoomOut")}
            disabled={current <= 50}
            onClick={() => update(definition.key, clamp(current - 10))}
            className="rounded-md p-1.5 text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            title={t("settings.zoomReset")}
            onClick={() => update(definition.key, 100)}
            className="min-w-[3.5rem] rounded-md px-2 py-1 text-sm font-medium tabular-nums text-gus-text outline-none transition-colors hover:text-gus-accent focus-visible:ring-2 focus-visible:ring-gus-accent/70"
          >
            {current}%
          </button>
          <button
            type="button"
            aria-label={t("settings.zoomIn")}
            disabled={current >= 200}
            onClick={() => update(definition.key, clamp(current + 10))}
            className="rounded-md p-1.5 text-gus-muted outline-none transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      );
    }

    if (definition.kind === "spell") {
      const selected = settings.spellLangs;
      return (
        <SpellLanguagePicker
          options={definition.options}
          selected={selected}
          label={t(definition.labelKey)}
          onToggle={(lang) => {
            // Al quitar el último diccionario el corrector se apaga (no vuelve al
            // de por defecto): es una decisión de quien edita, no una sorpresa.
            update(
              "spellLangs",
              selected.includes(lang)
                ? selected.filter((entry) => entry !== lang)
                : [...selected, lang],
            );
          }}
        />
      );
    }

    if (definition.kind === "language") {
      return (
        <div className="flex flex-col items-end gap-1">
          <div
            role="radiogroup"
            aria-label={t(definition.labelKey)}
            className="flex items-center gap-1 rounded-lg border border-gus-border bg-gus-panel p-1"
          >
            {LANGUAGE_LIST.map((entry) => {
              const isActive = language === entry.value;
              return (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => onLanguageChange(entry.value)}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                    isActive
                      ? "bg-gus-accent text-gus-bg"
                      : "text-gus-muted hover:text-gus-text",
                  )}
                >
                  {entry.native}
                </button>
              );
            })}
          </div>
          <p className="max-w-[16rem] text-right text-[11px] leading-snug text-gus-muted">
            {t("settings.languageHint")}
          </p>
        </div>
      );
    }

    if (definition.kind === "action") {
      if (definition.key === "tour") {
        return (
          <button
            type="button"
            onClick={onStartTour}
            className={clsx(
              INPUT_CLASS,
              "inline-flex items-center gap-1.5 text-xs text-gus-muted hover:text-gus-text",
            )}
          >
            <Compass className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            {t("settings.tour")}
          </button>
        );
      }

      const available = updateState.status === "available" ? updateState.info : null;
      const checking = updateState.status === "checking";

      return (
        <div className="flex max-w-[22rem] flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={onCheckUpdate}
            disabled={checking}
            className={clsx(
              INPUT_CLASS,
              "inline-flex items-center gap-1.5 text-xs text-gus-muted hover:text-gus-text",
              checking && "opacity-60",
            )}
          >
            <RefreshCw
              className={clsx("h-3.5 w-3.5", checking && "animate-spin")}
              strokeWidth={1.75}
              aria-hidden="true"
            />
            {checking ? t("update.checking") : t("settings.update")}
          </button>

          <div role="status" aria-live="polite" className="text-right text-[11px] leading-snug">
            {available && (
              <p className="text-gus-accent">
                {t("update.available", { version: available.version, current: APP_VERSION })}{" "}
                <button
                  type="button"
                  onClick={() => void openExternal(available.url)}
                  className="underline decoration-gus-accent/50 underline-offset-2 hover:decoration-gus-accent"
                >
                  {t("update.openRelease")}
                </button>
              </p>
            )}

            {updateState.status === "uptodate" && (
              <p className="text-gus-muted">{t("update.upToDate", { version: APP_VERSION })}</p>
            )}

            {updateState.status === "unavailable" && (
              <p className="text-amber-400">{t("update.failed")}</p>
            )}
          </div>
        </div>
      );
    }

    if (definition.kind === "shortcuts") {
      return (
        <ShortcutsEditor
          shortcuts={settings.shortcuts}
          onChange={(next) => update("shortcuts", next)}
        />
      );
    }

    if (definition.kind === "text") {
      return (
        <TextSetting
          value={settings[definition.key]}
          onChange={(next) => update(definition.key, next)}
          maxLength={definition.maxLength}
          label={t(definition.labelKey)}
          placeholder={t(definition.placeholderKey)}
        />
      );
    }

    if (definition.kind === "textarea") {
      return (
        <TextSetting
          value={settings[definition.key]}
          onChange={(next) => update(definition.key, next)}
          maxLength={definition.maxLength}
          rows={definition.rows}
          label={t(definition.labelKey)}
          hint={t(definition.hintKey)}
        />
      );
    }

    if (definition.kind === "theme") {
      return (
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-2">
          {THEME_LIST.map((entry) => (
            <ThemeCard
              key={entry.key}
              theme={entry.key}
              selected={settings.theme === entry.key}
              onSelect={() => update("theme", entry.key)}
            />
          ))}
        </div>
      );
    }

    const options: { key: AccentChoice; label: string; hex: string }[] = [
      {
        key: "tema",
        label: t("settings.accentFromTheme"),
        hex: accentHex("tema", settings.theme),
      },
      ...(Object.keys(ACCENTS) as AccentKey[]).map((key) => ({
        key: key as AccentChoice,
        label: t(ACCENTS[key].labelKey),
        hex: ACCENTS[key].hex,
      })),
    ];

    const selected = settings[definition.key];
    return (
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => {
          const isSelected = selected === option.key;
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={isSelected}
              aria-label={t("settings.accentLabel", { name: option.label })}
              title={option.label}
              onClick={() => update("accent", option.key)}
              style={{ backgroundColor: option.hex }}
              className={clsx(
                "flex h-8 w-8 items-center justify-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                isSelected
                  ? "ring-2 ring-gus-accent ring-offset-2 ring-offset-gus-card"
                  : "ring-1 ring-gus-border hover:ring-gus-muted",
              )}
            >
              {isSelected && (
                <Check className="h-4 w-4 text-gus-bg" strokeWidth={3} aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  const totalResults = groups.reduce((total, group) => total + group.items.length, 0);

  return (
    <section className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gus-border px-6 py-4">
        <div>
          <h2 className="text-sm font-semibold tracking-wider text-gus-muted uppercase">
            {t("settings.title")}
          </h2>
          <p className="text-xs text-gus-muted">{t("settings.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 h-4 w-4 text-gus-muted"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchLabel")}
              className={clsx(INPUT_CLASS, "w-60 py-2 pr-8 pl-9")}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("settings.clearSearch")}
                className="absolute right-2 flex h-5 w-5 items-center justify-center rounded-full text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </label>

          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
            title={t("settings.resetTitle")}
            className={clsx(
              INPUT_CLASS,
              "inline-flex items-center gap-1.5 text-xs text-gus-muted hover:text-gus-text",
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t("settings.reset")}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("settings.categoriesLabel")}
          className="gus-scrollbar flex w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-gus-border p-3"
        >
          {SETTINGS_CATEGORIES.map((category) => {
            const Icon = CATEGORY_ICONS[category.id];
            const isActive = !searching && activeCategory === category.id;
            const count = SETTINGS_DEFINITIONS.filter(
              (definition) => definition.category === category.id,
            ).length;

            return (
              <button
                key={category.id}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setActiveCategory(category.id);
                  setQuery("");
                }}
                className={clsx(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/70",
                  isActive
                    ? "bg-gus-accent/15 text-gus-accent"
                    : "text-gus-muted hover:bg-gus-card hover:text-gus-text",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                <span className="truncate">{t(category.labelKey)}</span>
                <span className="ml-auto text-[10px] text-gus-muted">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="gus-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {searching && (
            <p className="mb-4 text-xs text-gus-muted" role="status">
              {t("settings.results", { count: totalResults, query: query.trim() })}
            </p>
          )}

          {groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gus-border py-14 text-center">
              <Search className="h-5 w-5 text-gus-muted" aria-hidden="true" />
              <p className="text-sm text-gus-muted">
                {t("settings.noResults", { query: query.trim() })}
              </p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className={clsx(INPUT_CLASS, "text-xs text-gus-muted hover:text-gus-text")}
              >
                {t("settings.clearSearch")}
              </button>
            </div>
          ) : (
            groups.map((group) => {
              const Icon = CATEGORY_ICONS[group.category.id];
              return (
                <div key={group.category.id} className="mb-6 last:mb-0">
                  <div className="mb-2.5 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
                    <h3 className="text-xs font-semibold tracking-wider text-gus-muted uppercase">
                      {t(group.category.labelKey)}
                    </h3>
                    <span aria-hidden="true" className="h-px flex-1 bg-gus-border" />
                  </div>

                  <div className="flex flex-col gap-2">
                    {group.items.map((definition) => (
                      <div
                        key={definition.key}
                        className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gus-border bg-gus-card px-4 py-3.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gus-text">
                            {t(definition.labelKey)}
                          </p>
                          <p className="mt-0.5 text-xs text-gus-muted">
                            {t(definition.descriptionKey)}
                          </p>
                        </div>

                        <div
                          className={
                            definition.kind === "theme" ||
                            definition.kind === "shortcuts" ||
                            definition.kind === "textarea"
                              ? "w-full"
                              : "shrink-0"
                          }
                        >
                          {renderControl(definition)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
