import type { CSSProperties } from "react";

export type ThemeKey =
  | "gus-oscuro"
  | "gus-claro"
  | "oled"
  | "dracula"
  | "nord"
  | "solarized-oscuro"
  | "solarized-claro";

export type ThemeScheme = "dark" | "light";

export interface ThemeDefinition {
  key: ThemeKey;
  label: string;
  hint: string;
  scheme: ThemeScheme;
  /** Color de acento propio del tema, mientras el usuario no elija otro. */
  accent: string;
  /** Variables de color de Gus que pinta este tema. */
  vars: Record<string, string>;
}

function colors(
  bg: string,
  panel: string,
  card: string,
  border: string,
  text: string,
  muted: string,
  eyes: string,
): Record<string, string> {
  return {
    "--color-gus-bg": bg,
    "--color-gus-panel": panel,
    "--color-gus-card": card,
    "--color-gus-border": border,
    "--color-gus-text": text,
    "--color-gus-muted": muted,
    "--color-gus-eyes": eyes,
  };
}

export const THEME_LIST: ThemeDefinition[] = [
  {
    key: "gus-oscuro",
    label: "Gus Oscuro",
    hint: "El de siempre",
    scheme: "dark",
    accent: "#e07a5f",
    vars: colors("#0d0e11", "#16181f", "#1f222b", "#2a2e39", "#f4f1de", "#8d99ae", "#81b29a"),
  },
  {
    key: "gus-claro",
    label: "Gus Claro",
    hint: "El de siempre, en claro",
    scheme: "light",
    accent: "#b14a31",
    vars: colors("#f2f3f5", "#ffffff", "#e9ebf0", "#d5d9e1", "#15181f", "#5d6675", "#2f7d5f"),
  },
  {
    key: "oled",
    label: "OLED",
    hint: "Negro puro",
    scheme: "dark",
    accent: "#ff7a45",
    vars: colors("#000000", "#060607", "#101013", "#232327", "#f2f2f4", "#8e8e97", "#81b29a"),
  },
  {
    key: "dracula",
    label: "Dracula",
    hint: "Morado y rosa",
    scheme: "dark",
    accent: "#bd93f9",
    vars: colors("#282a36", "#21222c", "#343746", "#44475a", "#f8f8f2", "#8b93b3", "#50fa7b"),
  },
  {
    key: "nord",
    label: "Nord",
    hint: "Azules del ártico",
    scheme: "dark",
    accent: "#88c0d0",
    vars: colors("#2e3440", "#3b4252", "#434c5e", "#4c566a", "#eceff4", "#9aa7bd", "#a3be8c"),
  },
  {
    key: "solarized-oscuro",
    label: "Solarized Oscuro",
    hint: "Arena oscura y azul",
    scheme: "dark",
    accent: "#3d9ade",
    vars: colors("#002b36", "#073642", "#0a404f", "#1c4f5e", "#e9e5d7", "#839496", "#859900"),
  },
  {
    key: "solarized-claro",
    label: "Solarized Claro",
    hint: "Arena clara",
    scheme: "light",
    accent: "#1c6fbb",
    vars: colors("#fdf6e3", "#eee8d5", "#e6dfca", "#d4cbb0", "#073642", "#586e75", "#859900"),
  },
];

export const DEFAULT_THEME: ThemeKey = "gus-oscuro";

const BY_KEY = Object.fromEntries(
  THEME_LIST.map((theme) => [theme.key, theme]),
) as Record<ThemeKey, ThemeDefinition>;

const STORAGE_KEY = "gus-theme";

export function themeDefinition(theme: ThemeKey): ThemeDefinition {
  return BY_KEY[theme] ?? BY_KEY[DEFAULT_THEME];
}

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BY_KEY, value);
}

/**
 * Variables del tema (incluido su acento) para previsualizarlo dentro de un
 * contenedor: las clases gus-* del interior pintan esa paleta y no la actual.
 */
export function themePreviewStyle(theme: ThemeKey): CSSProperties {
  const definition = themeDefinition(theme);
  return { ...definition.vars, "--color-gus-accent": definition.accent } as CSSProperties;
}

/** Pinta el tema en el documento y lo recuerda para el próximo arranque. */
export function applyTheme(theme: ThemeKey): void {
  const definition = themeDefinition(theme);
  const root = document.documentElement;

  root.dataset.theme = definition.key;
  root.dataset.scheme = definition.scheme;
  root.style.colorScheme = definition.scheme;
  for (const [name, value] of Object.entries(definition.vars)) {
    root.style.setProperty(name, value);
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, definition.key);
  } catch {
    // Sin almacenamiento no hay memoria entre sesiones; seguimos con el tema actual.
  }
}

/** Tema de la sesión anterior, para pintarlo antes de leer los ajustes. */
export function storedTheme(): ThemeKey {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isThemeKey(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
