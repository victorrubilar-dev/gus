import { t as activeT } from "./i18n/core";
import type { MessageKey } from "./i18n/core";

/**
 * Identificadores de cada atajo. Son la clave con la que se guarda el cambio:
 * si una lista de atajos se renombra o se elimina, su customization se queda
 * huérfana y `normalizeShortcuts` la descarta.
 */
export type ShortcutId =
  | "commandPalette"
  | "saveNote"
  | "newNote"
  | "newFolder"
  | "newTask"
  | "openDailyNote"
  | "exportPdf"
  | "toggleView"
  | "undo"
  | "redo"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "focusSearch"
  | "togglePanel"
  | "back"
  | "forward"
  | "parentFolder"
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "inlineCode"
  | "copyCell"
  | "cutCell"
  | "moveLineUp"
  | "moveLineDown"
  | "addRow"
  | "addColumn"
  | "applySuggestion";

export type ShortcutGroupId = "global" | "navigation" | "editor" | "format" | "tables" | "files" | "view";

export interface ShortcutDefinition {
  id: ShortcutId;
  labelKey: MessageKey;
  group: ShortcutGroupId;
  /** Combinación por defecto. Sin modificadores, solo si la tecla es segura. */
  defaultCombo: string;
  /**
   * Atajos que el webview o el sistema operativo ya usan y que no se dejan
   * cambiar (copiar, pegar, guardar…). Se muestran pero no se editan.
   */
  system?: boolean;
  /**
   * Comparte combinación con otro atajo a propósito porque atienden en
   * superficies distintas (el editor y el explorador nunca están los dos
   * activos a la vez). Entre ellos no se avisa de conflicto.
   */
  contextual?: boolean;
}

/* ------------------------------------------------------------------ */
/* Combinaciones                                                        */
/* ------------------------------------------------------------------ */

/** Separador interno: «Ctrl+Shift+K» → «ctrl+shift+k». */
function normalizeCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("+")
    .toLowerCase();
}

export interface ParsedCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** En minúsculas; para letras es la letra, para el resto el nombre de la tecla. */
  key: string;
}

/** Lee una combinación en la forma en que la guarda el ajuste. */
export function parseCombo(combo: string): ParsedCombo | null {
  const parts = normalizeCombo(combo).split("+");
  if (parts.length === 0) return null;

  let ctrl = false;
  let alt = false;
  let shift = false;
  const keys: string[] = [];

  for (const part of parts) {
    switch (part) {
      case "ctrl":
      case "mod":
      case "cmd":
      case "meta":
        ctrl = true;
        break;
      case "alt":
      case "option":
      case "opt":
        alt = true;
        break;
      case "shift":
        shift = true;
        break;
      default:
        keys.push(part);
    }
  }

  if (keys.length !== 1) return null;

  const key = keys[0];
  // O una letra o un signo suelto, o el nombre de una tecla con nombre.
  // Cualquier otra cosa («esto no es un atajo») es texto basura y se descarta.
  if (!SINGLE_KEY_RE.test(key) && !isNamedKey(key)) return null;
  return { ctrl, alt, shift, key };
}

/* ------------------------------------------------------------------ */
/* Traducción de teclas                                                 */
/* ------------------------------------------------------------------ */

/**
 * Teclas sin letra: las flechas se dibujan con su símbolo y el resto se nombra
 * en el idioma de la aplicación (el guion bajo es el nombre interno, no el
 * texto que ve la persona).
 */
const NAMED_KEYS: Record<string, MessageKey | "↑" | "↓" | "←" | "→"> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  escape: "key.escape",
  enter: "key.enter",
  backspace: "key.backspace",
  delete: "key.delete",
  tab: "key.tab",
  space: "key.space",
  home: "key.home",
  end: "key.end",
  pageup: "key.pageup",
  pagedown: "key.pagedown",
  insert: "key.insert",
};

type NamedKey = (typeof NAMED_KEYS)[string];

/** ¿Es el nombre interno de una tecla con nombre (enter, escape…)? */
function isNamedKey(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(NAMED_KEYS, name);
}

/** Nombre visible de una tecla, ya traducido al idioma activo. */
function namedKeyLabel(name: NamedKey): string {
  if (name === "↑" || name === "↓" || name === "←" || name === "→") return name;
  return activeT(name);
}

/**
 * Teclas cuya forma con Mayús es la misma a efectos de atajo: «+» es la
 * Mayús de «=» y «_» la de «-». Guardarlas por su forma sin Mayús hace que
 * Ctrl+Shift+»+» y Ctrl++ sean el mismo atajo, como espera cualquiera.
 */
const SHIFT_SIBLING: Record<string, string> = { "+": "=", "_": "-" };

/** Las mismas teclas, vistas al revés: tecla con Mayús → tecla sin Mayús. */
const SHIFT_SIBLING_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(SHIFT_SIBLING).map(([shifted, plain]) => [plain, shifted]),
);

/** Cómo se enseña una tecla en el botón del atajo. */
const PRETTY_KEY: Record<string, string> = { "=": "+", "-": "−" };

/** Un solo carácter que puede ser la tecla final de un atajo. */
const SINGLE_KEY_RE = /^[a-z0-9]$|^[+\-`=[\];'",./*]$/i;

/** La tecla tal y como se guarda, sin depender de si se pulsó con Mayús. */
function canonicalKey(key: string): string {
  return SHIFT_SIBLING[key] ?? key;
}

/** Nombre de la tecla a partir de un `KeyboardEvent`. */
export function keyNameFromEvent(event: KeyboardEvent | React.KeyboardEvent): string {
  const { key, code } = event;

  // Las teclas de letra se leen del `key` para que un teclado en otro layout
  // siga mostrando la letra que se escribe (y no «KeyQ»).
  if (/^[a-zA-Z]$/.test(key)) return key.toLowerCase();

  if (key === " ") return "space";
  if (key.length === 1) return canonicalKey(key.toLowerCase());

  if (code) {
    if (code.startsWith("Key")) return code.slice(3).toLowerCase();
    if (code.startsWith("Digit")) return code.slice(5);
    if (code.startsWith("Numpad")) {
      const digit = code.slice(6);
      return /^\d$/.test(digit) ? digit : digit.toLowerCase();
    }
  }

  const lower = canonicalKey(key.toLowerCase());
  return NAMED_KEYS[lower] ? lower : lower;
}

/** Texto que se muestra en el botón del atajo («Ctrl+Shift+K»). */
export function comboLabel(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return "";

  const parts: string[] = [];
  if (parsed.ctrl) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("⇧");

  const named = NAMED_KEYS[parsed.key];
  // «=» y «-» se enseñan como «+» y «−»: es como se dicen de viva voz.
  const pretty = PRETTY_KEY[parsed.key] ?? parsed.key;
  if (named) parts.push(namedKeyLabel(named));
  else if (pretty.length === 1) parts.push(pretty.toUpperCase());
  else parts.push(pretty.charAt(0).toUpperCase() + pretty.slice(1));

  return parts.join("+");
}

/* ------------------------------------------------------------------ */
/* Comparación con un evento                                           */
/* ------------------------------------------------------------------ */

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** Convierte un evento de teclado en la misma forma que se guarda un atajo. */
export function comboFromEvent(event: KeyLike): string {
  const key = keyNameFromEvent(event as KeyboardEvent);
  const parts: string[] = [];
  // ⌘ y Ctrl se guardan igual: el atajo vale para los dos sistemas.
  if (event.ctrlKey || event.metaKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  // El Mayús de «+» o «_» no se guarda: es la misma tecla que «=» o «-».
  if (event.shiftKey && !SHIFT_SIBLING_REVERSE[key]) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/** ¿Este evento es exactamente el atajo buscado? */
export function matchesCombo(event: KeyLike, combo: string): boolean {
  const wanted = parseCombo(combo);
  if (!wanted) return false;

  const key = keyNameFromEvent(event as KeyboardEvent);

  if (wanted.ctrl !== (event.ctrlKey || event.metaKey)) return false;
  if (wanted.alt !== event.altKey) return false;
  // En «=» y «-» el Mayús solo cambia el carácter que se escribiría, no la
  // tecla: pulsar Ctrl+Mayús+»+» tiene que agrandar igual que Ctrl+»=».
  if (!SHIFT_SIBLING_REVERSE[key] && wanted.shift !== event.shiftKey) return false;

  return key === wanted.key;
}

/* ------------------------------------------------------------------ */
/* Catálogo de atajos                                                   */
/* ------------------------------------------------------------------ */

export const SHORTCUT_GROUPS: readonly { id: ShortcutGroupId; labelKey: MessageKey }[] = [
  { id: "global", labelKey: "settings.shortcutGroup.global" },
  { id: "navigation", labelKey: "settings.shortcutGroup.navigation" },
  { id: "editor", labelKey: "settings.shortcutGroup.editor" },
  { id: "format", labelKey: "settings.shortcutGroup.format" },
  { id: "tables", labelKey: "settings.shortcutGroup.tables" },
  { id: "files", labelKey: "settings.shortcutGroup.files" },
  { id: "view", labelKey: "settings.shortcutGroup.view" },
];

export const SHORTCUT_LIST: readonly ShortcutDefinition[] = [
  // General
  { id: "commandPalette", labelKey: "shortcut.commandPalette", group: "global", defaultCombo: "ctrl+k" },
  { id: "newTask", labelKey: "shortcut.newTask", group: "global", defaultCombo: "ctrl+shift+n" },
  { id: "openDailyNote", labelKey: "shortcut.openDailyNote", group: "global", defaultCombo: "ctrl+shift+d" },
  { id: "zoomIn", labelKey: "shortcut.zoomIn", group: "global", defaultCombo: "ctrl+=" },
  { id: "zoomOut", labelKey: "shortcut.zoomOut", group: "global", defaultCombo: "ctrl+-" },
  { id: "zoomReset", labelKey: "shortcut.zoomReset", group: "global", defaultCombo: "ctrl+0" },
  {
    id: "togglePanel",
    labelKey: "shortcut.togglePanel",
    group: "global",
    defaultCombo: "ctrl+shift+b",
  },

  // Navegación
  { id: "back", labelKey: "shortcut.back", group: "navigation", defaultCombo: "alt+arrowleft" },
  { id: "forward", labelKey: "shortcut.forward", group: "navigation", defaultCombo: "alt+arrowright" },
  {
    id: "parentFolder",
    labelKey: "shortcut.parentFolder",
    group: "navigation",
    defaultCombo: "alt+arrowup",
    contextual: true,
  },
  { id: "focusSearch", labelKey: "shortcut.focusSearch", group: "navigation", defaultCombo: "ctrl+p" },

  // Editor
  { id: "saveNote", labelKey: "shortcut.saveNote", group: "editor", defaultCombo: "ctrl+s" },
  { id: "undo", labelKey: "shortcut.undo", group: "editor", defaultCombo: "ctrl+z" },
  { id: "redo", labelKey: "shortcut.redo", group: "editor", defaultCombo: "ctrl+y" },
  {
    id: "moveLineUp",
    labelKey: "shortcut.moveLineUp",
    group: "editor",
    defaultCombo: "alt+arrowup",
    contextual: true,
  },
  { id: "moveLineDown", labelKey: "shortcut.moveLineDown", group: "editor", defaultCombo: "alt+arrowdown" },
  { id: "applySuggestion", labelKey: "shortcut.applySuggestion", group: "editor", defaultCombo: "alt+enter" },

  // Formato
  { id: "bold", labelKey: "shortcut.bold", group: "format", defaultCombo: "ctrl+b" },
  { id: "italic", labelKey: "shortcut.italic", group: "format", defaultCombo: "ctrl+i" },
  { id: "underline", labelKey: "shortcut.underline", group: "format", defaultCombo: "ctrl+u", system: true },
  { id: "strikethrough", labelKey: "shortcut.strikethrough", group: "format", defaultCombo: "ctrl+shift+x" },
  { id: "inlineCode", labelKey: "shortcut.inlineCode", group: "format", defaultCombo: "ctrl+`" },

  // Tablas
  { id: "addRow", labelKey: "shortcut.addRow", group: "tables", defaultCombo: "ctrl+shift+arrowdown" },
  { id: "addColumn", labelKey: "shortcut.addColumn", group: "tables", defaultCombo: "ctrl+shift+arrowright" },
  { id: "copyCell", labelKey: "shortcut.copyCell", group: "tables", defaultCombo: "ctrl+c", system: true },
  { id: "cutCell", labelKey: "shortcut.cutCell", group: "tables", defaultCombo: "ctrl+x", system: true },

  // Archivos y vault
  { id: "newNote", labelKey: "shortcut.newNote", group: "files", defaultCombo: "ctrl+n" },
  { id: "newFolder", labelKey: "shortcut.newFolder", group: "files", defaultCombo: "ctrl+alt+n" },
  { id: "exportPdf", labelKey: "shortcut.savePdf", group: "files", defaultCombo: "ctrl+e" },
  { id: "toggleView", labelKey: "shortcut.toggleView", group: "view", defaultCombo: "ctrl+shift+v" },

  // Vista
];

/** Atajos que el sistema se queda: se ven, pero no se pueden reasignar. */
const SYSTEM_IDS = new Set(
  SHORTCUT_LIST.filter((entry) => entry.system).map((entry) => entry.id),
);

export const DEFAULT_SHORTCUTS: ShortcutMap = Object.fromEntries(
  SHORTCUT_LIST.map((entry) => [entry.id, entry.defaultCombo]),
) as ShortcutMap;

/** Atajo asignado a una acción, o cadena vacía si no tiene ninguno. */
export type ShortcutMap = Record<string, string>;

export function shortcutDefinition(id: ShortcutId): ShortcutDefinition | null {
  return SHORTCUT_LIST.find((entry) => entry.id === id) ?? null;
}

export function isEditableShortcut(id: ShortcutId): boolean {
  return !SYSTEM_IDS.has(id);
}

/** Ajustes guardados, saneados: solo atajos conocidos y combinaciones legibles. */
export function normalizeShortcuts(raw: unknown): ShortcutMap {
  const map: ShortcutMap = { ...DEFAULT_SHORTCUTS };
  if (typeof raw !== "object" || raw === null) return map;

  const data = raw as Record<string, unknown>;
  for (const entry of SHORTCUT_LIST) {
    if (!Object.prototype.hasOwnProperty.call(data, entry.id)) continue;
    const value = data[entry.id];
    if (value === null || value === "") {
      // Cadena vacía = atajo sin asignar; solo se admite si se puede editar.
      if (isEditableShortcut(entry.id)) map[entry.id] = "";
      continue;
    }
    if (typeof value !== "string") continue;
    if (!parseCombo(value)) continue;
    map[entry.id] = normalizeCombo(value);
  }

  return map;
}

/* ------------------------------------------------------------------ */
/* Comprobación de Conflicts                                           */
/* ------------------------------------------------------------------ */

/** Acción que ya usa esa combinación, si la hay. */
export function shortcutConflict(combo: string, exceptId?: ShortcutId): ShortcutDefinition | null {
  const normalized = normalizeCombo(combo);
  if (!parseCombo(normalized)) return null;

  for (const entry of SHORTCUT_LIST) {
    if (entry.id === exceptId) continue;
    if (normalizeCombo(DEFAULT_SHORTCUTS[entry.id] ?? "") !== normalized) continue;
    // Solo molesta chocar con algo que se pueda cambiar por el mismo camino.
    if (!isEditableShortcut(entry.id)) continue;
    // Dos atajos contextuales pueden coincidir: atienden en sitios distintos.
    if (entry.contextual) continue;
    const other = shortcutDefinition(exceptId ?? entry.id);
    if (other?.contextual) continue;
    return entry;
  }
  return null;
}

/**
 * Atajo vigente de una acción: el que se haya cambiado o, si no, el de siempre.
 */
export function comboFor(map: ShortcutMap | null | undefined, id: ShortcutId): string {
  const custom = map?.[id];
  if (typeof custom === "string") return custom;
  return DEFAULT_SHORTCUTS[id] ?? "";
}

export function shortcutsEqual(a: ShortcutMap | null | undefined, b: ShortcutMap): boolean {
  return SHORTCUT_LIST.every((entry) => comboFor(a, entry.id) === comboFor(b, entry.id));
}

/* ------------------------------------------------------------------ */
/* Atajos que atiende la ventana                                        */
/* ------------------------------------------------------------------ */

/** Atajos globales que se resuelven en `App`, fuera del editor. */
const GLOBAL_IDS = [
  "zoomIn",
  "zoomOut",
  "zoomReset",
  "newTask",
  "openDailyNote",
  "commandPalette",
  "focusSearch",
  "togglePanel",
] as const;

/**
 * Qué acción global corresponde a una pulsación, si alguna. Los atajos del
 * editor no se miran aquí: se atienden dentro del textarea, que es donde
 * escriben.
 */
export function globalShortcutFor(
  event: KeyLike,
  map: ShortcutMap | null | undefined,
): ShortcutId | null {
  for (const id of GLOBAL_IDS) {
    const combo = comboFor(map, id);
    if (combo && matchesCombo(event, combo)) return id;
  }
  return null;
}

/** Atajos que atiende el explorador de notas (historial y creación). */
const EXPLORER_IDS = ["back", "forward", "parentFolder", "newNote", "newFolder"] as const;

/**
 * Qué acción del explorador corresponde a una pulsación. Los atajos sin
 * modificador (como «nueva nota») solo funcionan fuera de los campos de texto,
 * para no quitarle letras a quien escribe.
 */
export function explorerShortcutFor(
  event: KeyLike,
  map: ShortcutMap | null | undefined,
): ShortcutId | null {
  const target = (event as { target?: unknown }).target;
  if (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable], [role='separator']")
  ) {
    return null;
  }

  for (const id of EXPLORER_IDS) {
    const combo = comboFor(map, id);
    if (combo && matchesCombo(event, combo)) return id;
  }
  return null;
}
