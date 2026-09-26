import { SPELL_LANGUAGES, type SpellLang } from "./spellCheck";

export type AccentKey = "terracota" | "menta" | "marfil" | "cielo";

export interface AppSettings {
  openLastVault: boolean;
  alwaysNotesTab: boolean;
  animations: boolean;
  accent: AccentKey;
  editorFontSize: number;
  autoSave: boolean;
  hideCompletedTasks: boolean;
  calendarShowCompleted: boolean;
  spellLang: SpellLang;
  spellWords: string[];
}

export const ACCENTS: Record<AccentKey, { label: string; hex: string }> = {
  terracota: { label: "Terracota", hex: "#e07a5f" },
  menta: { label: "Menta", hex: "#81b29a" },
  marfil: { label: "Marfil", hex: "#f4f1de" },
  cielo: { label: "Cielo", hex: "#89b4fa" },
};

export const FONT_SIZES = [13, 14, 16, 18] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  openLastVault: true,
  alwaysNotesTab: false,
  animations: true,
  accent: "terracota",
  editorFontSize: 14,
  autoSave: true,
  hideCompletedTasks: false,
  calendarShowCompleted: true,
  spellLang: "es",
  spellWords: [],
};

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const data = raw as Record<string, unknown>;

  const accent = data.accent;
  const fontSize = data.editorFontSize;
  const spellLang = data.spellLang;

  return {
    openLastVault: asBool(data.openLastVault, DEFAULT_SETTINGS.openLastVault),
    alwaysNotesTab: asBool(data.alwaysNotesTab, DEFAULT_SETTINGS.alwaysNotesTab),
    animations: asBool(data.animations, DEFAULT_SETTINGS.animations),
    accent:
      typeof accent === "string" && accent in ACCENTS
        ? (accent as AccentKey)
        : DEFAULT_SETTINGS.accent,
    editorFontSize:
      typeof fontSize === "number" && Number.isFinite(fontSize)
        ? Math.min(22, Math.max(12, Math.round(fontSize)))
        : DEFAULT_SETTINGS.editorFontSize,
    autoSave: asBool(data.autoSave, DEFAULT_SETTINGS.autoSave),
    hideCompletedTasks: asBool(data.hideCompletedTasks, DEFAULT_SETTINGS.hideCompletedTasks),
    calendarShowCompleted: asBool(
      data.calendarShowCompleted,
      DEFAULT_SETTINGS.calendarShowCompleted,
    ),
    spellLang:
      typeof spellLang === "string" &&
      SPELL_LANGUAGES.some((entry) => entry.value === spellLang)
        ? (spellLang as SpellLang)
        : DEFAULT_SETTINGS.spellLang,
    spellWords: normalizeSpellWords(data.spellWords),
  };
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

export function accentHex(accent: AccentKey): string {
  return ACCENTS[accent]?.hex ?? ACCENTS.terracota.hex;
}

export type SettingsCategoryId = "general" | "appearance" | "notes" | "tasks" | "calendar";

export interface SettingsCategory {
  id: SettingsCategoryId;
  label: string;
  keywords: string;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "general",
    label: "General",
    keywords: "inicio arranque vault abrir",
  },
  {
    id: "appearance",
    label: "Apariencia",
    keywords: "tema color animaciones movimiento diseño",
  },
  {
    id: "notes",
    label: "Notas",
    keywords: "editor texto letra tamaño autoguardado guardar corrector ortografia idioma",
  },
  {
    id: "tasks",
    label: "Tareas",
    keywords: "lista completadas pendientes",
  },
  {
    id: "calendar",
    label: "Calendario",
    keywords: "fecha vencimiento mes",
  },
];

export type ToggleKey =
  | "openLastVault"
  | "alwaysNotesTab"
  | "animations"
  | "autoSave"
  | "hideCompletedTasks"
  | "calendarShowCompleted";

export type SettingDefinition =
  | {
      kind: "toggle";
      category: SettingsCategoryId;
      key: ToggleKey;
      label: string;
      description: string;
      keywords: string;
    }
  | {
      kind: "choice";
      category: SettingsCategoryId;
      key: "editorFontSize";
      label: string;
      description: string;
      keywords: string;
      options: readonly number[];
    }
  | {
      kind: "select";
      category: SettingsCategoryId;
      key: "spellLang";
      label: string;
      description: string;
      keywords: string;
      options: readonly { value: SpellLang; label: string }[];
    }
  | {
      kind: "accent";
      category: SettingsCategoryId;
      key: "accent";
      label: string;
      description: string;
      keywords: string;
    };

export const SETTINGS_DEFINITIONS: SettingDefinition[] = [
  {
    kind: "toggle",
    category: "general",
    key: "openLastVault",
    label: "Reabrir el último vault",
    description: "Al arrancar Gus vuelve al vault que usabas la última vez.",
    keywords: "autoabrir continuar sesion arranque",
  },
  {
    kind: "toggle",
    category: "general",
    key: "alwaysNotesTab",
    label: "Empezar en «Notas» al cambiar de vault",
    description:
      "Al abrir un vault se muestra el Resumen; con este ajuste se va directo a la pestaña de notas.",
    keywords: "pestaña notas reset cambiar vault inicio resumen",
  },
  {
    kind: "toggle",
    category: "appearance",
    key: "animations",
    label: "Animaciones",
    description: "Transiciones y efectos de la interfaz. Desactívalas para un Gus más plano.",
    keywords: "movimiento transiciones efectos reducir",
  },
  {
    kind: "accent",
    category: "appearance",
    key: "accent",
    label: "Color de acento",
    description: "Color de botones, resaltados y acentos de toda la aplicación.",
    keywords: "color tema paleta terracota menta marfil cielo",
  },
  {
    kind: "choice",
    category: "notes",
    key: "editorFontSize",
    label: "Tamaño de letra del editor",
    description: "Tamaño del texto al escribir notas en markdown.",
    options: FONT_SIZES,
    keywords: "letra texto fuente tamaño px editor markdown",
  },
  {
    kind: "select",
    category: "notes",
    key: "spellLang",
    label: "Corrector ortográfico",
    description:
      "Subraya en rojo las palabras que no estén en el diccionario del idioma elegido.",
    options: SPELL_LANGUAGES,
    keywords: "corrector ortografia faltas mal escritas idioma resaltar subrayar spellcheck",
  },
  {
    kind: "toggle",
    category: "notes",
    key: "autoSave",
    label: "Autoguardado",
    description:
      "Guarda la nota con un pequeño retardo mientras escribes. Ctrl+S guarda al momento.",
    keywords: "guardar automatico debounce escribir",
  },
  {
    kind: "toggle",
    category: "tasks",
    key: "hideCompletedTasks",
    label: "Ocultar completadas",
    description: "La lista de tareas solo muestra las pendientes.",
    keywords: "filtrar lista tareas terminadas hechas",
  },
  {
    kind: "toggle",
    category: "calendar",
    key: "calendarShowCompleted",
    label: "Mostrar completadas en el calendario",
    description:
      "Las tareas terminadas aparecen tachadas en los días y en el detalle del día.",
    keywords: "calendario dias completadas mostrar ocultar",
  },
];
