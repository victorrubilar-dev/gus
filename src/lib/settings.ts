import { isLanguage, DEFAULT_LANGUAGE, type Language } from "./i18n/core";
import type { MessageKey } from "./i18n/core";
import {
  DAILY_DEFAULT_FOLDER,
  DAILY_DEFAULT_TEMPLATE,
  normalizeDailyTemplate,
  sanitizeDailyFolder,
} from "./dailyNotes";
import {
  DEFAULT_SPELL_LANGS,
  SPELL_LANGUAGES,
  normalizeSpellLangs,
  type SpellLang,
} from "./spellCheck";
import { DEFAULT_SHORTCUTS, normalizeShortcuts, type ShortcutMap } from "./shortcuts";
import { DEFAULT_THEME, isThemeKey, themeDefinition, type ThemeKey } from "./themes";

export type AccentKey = "terracota" | "menta" | "marfil" | "cielo";

/** Color de acento: uno fijo o el que traiga el tema activo. */
export type AccentChoice = AccentKey | "tema";

export interface AppSettings {
  openLastVault: boolean;
  alwaysNotesTab: boolean;
  animations: boolean;
  accent: AccentChoice;
  theme: ThemeKey;
  editorFontSize: number;
  uiZoom: number;
  autoSave: boolean;
  hideCompletedTasks: boolean;
  calendarShowCompleted: boolean;
  /** Corrector: uno o varios diccionarios a la vez. Vacío = apagado. */
  spellLangs: SpellLang[];
  spellWords: string[];
  /** Atajos de teclado cambiados a mano por la persona. */
  shortcuts: ShortcutMap;
  /** Carpeta del vault donde viven las notas diarias. */
  dailyNotesFolder: string;
  /** Plantilla con la que se crea la nota de un día nuevo. */
  dailyNotesTemplate: string;
}

/**
 * El idioma no se guarda aquí: es una preferencia de la persona y no del vault,
 * así que vive en `localStorage` (ver `lib/i18n`). Se exporta aparte para que
 * los componentes que no reciben los ajustes (el explorador, el editor) puedan
 * consultarlo.
 */
export type { Language } from "./i18n/core";

export const ACCENTS: Record<AccentKey, { labelKey: MessageKey; hex: string }> = {
  terracota: { labelKey: "accent.terracota", hex: "#e07a5f" },
  menta: { labelKey: "accent.menta", hex: "#81b29a" },
  marfil: { labelKey: "accent.marfil", hex: "#f4f1de" },
  cielo: { labelKey: "accent.cielo", hex: "#89b4fa" },
};

export const FONT_SIZES = [13, 14, 16, 18] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  openLastVault: true,
  alwaysNotesTab: false,
  animations: true,
  accent: "tema",
  theme: DEFAULT_THEME,
  editorFontSize: 14,
  uiZoom: 100,
  autoSave: true,
  hideCompletedTasks: false,
  calendarShowCompleted: true,
  spellLangs: [...DEFAULT_SPELL_LANGS],
  spellWords: [],
  shortcuts: { ...DEFAULT_SHORTCUTS },
  dailyNotesFolder: DAILY_DEFAULT_FOLDER,
  dailyNotesTemplate: DAILY_DEFAULT_TEMPLATE,
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const data = raw as Record<string, unknown>;

  const accent = data.accent;
  const fontSize = data.editorFontSize;

  return {
    openLastVault: asBool(data.openLastVault, DEFAULT_SETTINGS.openLastVault),
    alwaysNotesTab: asBool(data.alwaysNotesTab, DEFAULT_SETTINGS.alwaysNotesTab),
    animations: asBool(data.animations, DEFAULT_SETTINGS.animations),
    accent:
      accent === "tema" || (typeof accent === "string" && accent in ACCENTS)
        ? (accent as AccentChoice)
        : DEFAULT_SETTINGS.accent,
    theme: isThemeKey(data.theme) ? data.theme : DEFAULT_SETTINGS.theme,
    editorFontSize:
      typeof fontSize === "number" && Number.isFinite(fontSize)
        ? Math.min(22, Math.max(12, Math.round(fontSize)))
        : DEFAULT_SETTINGS.editorFontSize,
    uiZoom:
      typeof data.uiZoom === "number" && Number.isFinite(data.uiZoom)
        ? Math.min(200, Math.max(50, Math.round(data.uiZoom / 10) * 10))
        : DEFAULT_SETTINGS.uiZoom,
    autoSave: asBool(data.autoSave, DEFAULT_SETTINGS.autoSave),
    hideCompletedTasks: asBool(data.hideCompletedTasks, DEFAULT_SETTINGS.hideCompletedTasks),
    calendarShowCompleted: asBool(
      data.calendarShowCompleted,
      DEFAULT_SETTINGS.calendarShowCompleted,
    ),
    spellLangs: normalizeSpellLangs(data.spellLangs ?? legacySpellLangs(data.spellLang)),
    spellWords: normalizeSpellWords(data.spellWords),
    shortcuts: normalizeShortcuts(data.shortcuts),
    dailyNotesFolder: sanitizeDailyFolder(data.dailyNotesFolder),
    dailyNotesTemplate: normalizeDailyTemplate(data.dailyNotesTemplate),
  };
}

/** Ajustes guardados antes de los diccionarios múltiples: un único idioma. */
function legacySpellLangs(raw: unknown): unknown {
  return typeof raw === "string" ? [raw] : undefined;
}

/** Ajustes guardados antes del idioma de aplicación (se usaba siempre español). */
export function readLegacyLanguage(data: Record<string, unknown> | null): Language {
  const value = data?.language;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

function normalizeSpellWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_SETTINGS.spellWords;

  const words: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const word = item.trim();
    if (word === "" || word.length > 64 || words.includes(word)) continue;
    words.push(word);
  }
  return words;
}

export function accentHex(accent: AccentChoice, theme: ThemeKey): string {
  if (accent === "tema") return themeDefinition(theme).accent;
  return ACCENTS[accent]?.hex ?? ACCENTS.terracota.hex;
}

export type SettingsCategoryId =
  | "general"
  | "appearance"
  | "notes"
  | "tasks"
  | "calendar"
  | "language"
  | "shortcuts";

export interface SettingsCategory {
  id: SettingsCategoryId;
  labelKey: MessageKey;
  /** Palabras para el buscador de Ajustes, en ambos idiomas. */
  keywords: string;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "general",
    labelKey: "settings.cat.general",
    keywords: "inicio arranque vault abrir general start launch open",
  },
  {
    id: "appearance",
    labelKey: "settings.cat.appearance",
    keywords:
      "tema color animaciones movimiento diseño escala zoom tamaño theme color animations design scale",
  },
  {
    id: "notes",
    labelKey: "settings.cat.notes",
    keywords:
      "editor texto letra tamaño autoguardado guardar corrector ortografia idioma notes editor text autosave spell",
  },
  {
    id: "tasks",
    labelKey: "settings.cat.tasks",
    keywords: "lista completadas pendientes tasks list completed pending",
  },
  {
    id: "calendar",
    labelKey: "settings.cat.calendar",
    keywords: "fecha vencimiento mes calendar date due month",
  },
  {
    id: "language",
    labelKey: "settings.cat.language",
    keywords: "idioma lengua traduccion español ingles language translation spanish english",
  },
  {
    id: "shortcuts",
    labelKey: "settings.cat.shortcuts",
    keywords: "atajos teclado combinaciones teclas shortcuts keyboard hotkeys keys",
  },
];

export type ToggleKey =
  | "openLastVault"
  | "alwaysNotesTab"
  | "animations"
  | "autoSave"
  | "hideCompletedTasks"
  | "calendarShowCompleted";

interface DefinitionBase {
  category: SettingsCategoryId;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  keywords: string;
}

export type SettingDefinition = DefinitionBase &
  (
    | { kind: "toggle"; key: ToggleKey }
    | { kind: "choice"; key: "editorFontSize"; options: readonly number[] }
    | { kind: "zoom"; key: "uiZoom" }
    /** Varios diccionarios del corrector a la vez (o ninguno: queda apagado). */
    | { kind: "spell"; key: "spellLangs"; options: readonly { value: SpellLang; label: string }[] }
    /** Un solo idioma para toda la aplicación. */
    | { kind: "language"; key: "language" }
    | { kind: "accent"; key: "accent" }
    | { kind: "theme"; key: "theme" }
    | { kind: "shortcuts"; key: "shortcuts" }
    /** Campo de una línea (p. ej. la carpeta de las notas diarias). */
    | { kind: "text"; key: "dailyNotesFolder"; maxLength: number; placeholderKey: MessageKey }
    /** Campo de varias líneas (p. ej. la plantilla de las notas diarias). */
    | {
        kind: "textarea";
        key: "dailyNotesTemplate";
        maxLength: number;
        rows: number;
        hintKey: MessageKey;
      }
    /** Botón con efecto propio (no guarda nada en los ajustes del vault). */
    | { kind: "action"; key: "tour" | "updateCheck" }
  );

export const SETTINGS_DEFINITIONS: SettingDefinition[] = [
  {
    kind: "toggle",
    category: "general",
    key: "openLastVault",
    labelKey: "settings.openLastVault",
    descriptionKey: "settings.openLastVault.desc",
    keywords: "autoabrir continuar sesion arranque reopen continue session",
  },
  {
    kind: "toggle",
    category: "general",
    key: "alwaysNotesTab",
    labelKey: "settings.alwaysNotesTab",
    descriptionKey: "settings.alwaysNotesTab.desc",
    keywords: "pestaña notas reset cambiar vault inicio resumen tab reset change start",
  },
  {
    kind: "action",
    category: "general",
    key: "tour",
    labelKey: "settings.tour",
    descriptionKey: "settings.tour.desc",
    keywords:
      "tour recorrido guia ayuda introduccion presentacion novedades tour guide help walkthrough start",
  },
  {
    kind: "action",
    category: "general",
    key: "updateCheck",
    labelKey: "settings.update",
    descriptionKey: "settings.update.desc",
    keywords:
      "actualizar actualizacion version github release novedades update upgrade release version news",
  },
  {
    kind: "language",
    category: "language",
    key: "language",
    labelKey: "settings.language",
    descriptionKey: "settings.language.desc",
    keywords: "idioma lengua traduccion español ingles language translation spanish english",
  },
  {
    kind: "theme",
    category: "appearance",
    key: "theme",
    labelKey: "settings.theme",
    descriptionKey: "settings.theme.desc",
    keywords:
      "tema estilo apariencia oscuro claro oled dracula nord solarized modo paleta colores theme style dark light palette",
  },
  {
    kind: "toggle",
    category: "appearance",
    key: "animations",
    labelKey: "settings.animations",
    descriptionKey: "settings.animations.desc",
    keywords: "movimiento transiciones efectos reducir motion transitions effects reduce",
  },
  {
    kind: "accent",
    category: "appearance",
    key: "accent",
    labelKey: "settings.accent",
    descriptionKey: "settings.accent.desc",
    keywords: "color tema paleta terracota menta marfil cielo acento colour accent",
  },
  {
    kind: "zoom",
    category: "appearance",
    key: "uiZoom",
    labelKey: "settings.uiZoom",
    descriptionKey: "settings.uiZoom.desc",
    keywords: "zoom escala tamaño agrandar achicar grande pequeño atajo interfaz scale size zoom",
  },
  {
    kind: "choice",
    category: "notes",
    key: "editorFontSize",
    labelKey: "settings.editorFontSize",
    descriptionKey: "settings.editorFontSize.desc",
    options: FONT_SIZES,
    keywords: "letra texto fuente tamaño px editor markdown font text size",
  },
  {
    kind: "spell",
    category: "notes",
    key: "spellLangs",
    labelKey: "settings.spellLangs",
    descriptionKey: "settings.spellLangs.desc",
    options: SPELL_LANGUAGES,
    keywords:
      "corrector ortografia faltas mal escritas idioma resaltar subrayar spellcheck spell dictionary",
  },
  {
    kind: "toggle",
    category: "notes",
    key: "autoSave",
    labelKey: "settings.autoSave",
    descriptionKey: "settings.autoSave.desc",
    keywords: "guardar automatico debounce escribir autosave automatic writing",
  },
  {
    kind: "text",
    category: "notes",
    key: "dailyNotesFolder",
    labelKey: "settings.dailyNotesFolder",
    descriptionKey: "settings.dailyNotesFolder.desc",
    maxLength: 64,
    placeholderKey: "settings.dailyNotesFolderPlaceholder",
    keywords:
      "diario daily nota dia fecha carpeta folder journal day daily note",
  },
  {
    kind: "textarea",
    category: "notes",
    key: "dailyNotesTemplate",
    labelKey: "settings.dailyNotesTemplate",
    descriptionKey: "settings.dailyNotesTemplate.desc",
    maxLength: 4000,
    rows: 5,
    hintKey: "settings.dailyNotesTemplate.hint",
    keywords:
      "plantilla template diario daily estructura scaffold plantilla diaria",
  },
  {
    kind: "toggle",
    category: "tasks",
    key: "hideCompletedTasks",
    labelKey: "settings.hideCompletedTasks",
    descriptionKey: "settings.hideCompletedTasks.desc",
    keywords: "filtrar lista tareas terminadas hechas filter list tasks done",
  },
  {
    kind: "toggle",
    category: "calendar",
    key: "calendarShowCompleted",
    labelKey: "settings.calendarShowCompleted",
    descriptionKey: "settings.calendarShowCompleted.desc",
    keywords: "calendario dias completadas mostrar ocultar calendar days completed show hide",
  },
  {
    kind: "shortcuts",
    category: "shortcuts",
    key: "shortcuts",
    labelKey: "settings.shortcuts",
    descriptionKey: "settings.shortcuts.desc",
    keywords: "atajos teclado combinaciones teclas shortcut keyboard hotkey",
  },
];
