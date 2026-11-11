import type { CSSProperties } from "react";
import type { MessageKey } from "./i18n/core";
import { CUSTOM_THEME_PREFIX, customThemeKey, type CustomTheme } from "./customThemes.ts";

export type ThemeKey =
  | "gus-oscuro"
  | "gus-claro"
  | "oled"
  | "dracula"
  | "nord"
  | "solarized-oscuro"
  | "solarized-claro";

export type ThemeScheme = "dark" | "light";

/** Lo que hace falta para pintar un tema, sea de serie o personalizado. */
export interface ThemePalette {
  /** Clave de `settings.theme`: la de serie o `custom-<id>`. */
  key: string;
  scheme: ThemeScheme;
  accent: string;
  vars: Record<string, string>;
}

export interface ThemeDefinition extends ThemePalette {
  key: ThemeKey;
  labelKey: MessageKey;
  hintKey: MessageKey;
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
    labelKey: "theme.gus-dark",
    hintKey: "theme.gusDarkHint",
    scheme: "dark",
    // Paleta del logo: negro y blanco cálidos, con el bermellón como acento.
    accent: "#f26a4a",
    vars: colors("#141414", "#1c1c1c", "#232323", "#2e2e2e", "#f1ebe8", "#a39c9a", "#81b29a"),
  },
  {
    key: "gus-claro",
    labelKey: "theme.gus-light",
    hintKey: "theme.gusLightHint",
    scheme: "light",
    accent: "#be391d",
    vars: colors("#f8f8f8", "#ffffff", "#efeae8", "#d6cfcc", "#141414", "#5f5856", "#2f7d5f"),
  },
  {
    key: "oled",
    labelKey: "theme.oled",
    hintKey: "theme.oledHint",
    scheme: "dark",
    accent: "#ff7a45",
    vars: colors("#000000", "#060607", "#101013", "#232327", "#f2f2f4", "#8e8e97", "#81b29a"),
  },
  {
    key: "dracula",
    labelKey: "theme.dracula",
    hintKey: "theme.draculaHint",
    scheme: "dark",
    accent: "#bd93f9",
    vars: colors("#282a36", "#21222c", "#343746", "#44475a", "#f8f8f2", "#9aa1bd", "#50fa7b"),
  },
  {
    key: "nord",
    labelKey: "theme.nord",
    hintKey: "theme.nordHint",
    scheme: "dark",
    accent: "#93c6d4",
    vars: colors("#2e3440", "#3b4252", "#434c5e", "#4c566a", "#eceff4", "#b4bece", "#a3be8c"),
  },
  {
    key: "solarized-oscuro",
    labelKey: "theme.solarized-dark",
    hintKey: "theme.solarizedDarkHint",
    scheme: "dark",
    accent: "#62ade4",
    vars: colors("#002b36", "#073642", "#0a404f", "#1c4f5e", "#e9e5d7", "#9ba8aa", "#859900"),
  },
  {
    key: "solarized-claro",
    labelKey: "theme.solarized-light",
    hintKey: "theme.solarizedLightHint",
    scheme: "light",
    accent: "#1963a6",
    vars: colors("#fdf6e3", "#eee8d5", "#e6dfca", "#d4cbb0", "#073642", "#51656c", "#859900"),
  },
];

export const DEFAULT_THEME: ThemeKey = "gus-oscuro";

const BY_KEY = Object.fromEntries(
  THEME_LIST.map((theme) => [theme.key, theme]),
) as Record<ThemeKey, ThemeDefinition>;

const STORAGE_KEY = "gus-theme";
/** Paleta del tema personalizado activo: al arrancar todavía no se han leído los ajustes. */
const CUSTOM_STORAGE_KEY = "gus-theme-custom";

export function themeDefinition(theme: ThemeKey): ThemeDefinition {
  return BY_KEY[theme] ?? BY_KEY[DEFAULT_THEME];
}

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BY_KEY, value);
}

/** Paleta de un tema personalizado, con las mismas variables que uno de serie. */
export function customPalette(theme: CustomTheme): ThemePalette {
  const { bg, panel, card, border, text, muted, eyes } = theme.colors;
  return {
    key: customThemeKey(theme),
    scheme: theme.scheme,
    accent: theme.accent,
    vars: colors(bg, panel, card, border, text, muted, eyes),
  };
}

/** Paleta de `settings.theme`: un tema de serie o uno de `customs`; si no existe, el de por defecto. */
export function resolveTheme(key: string, customs: readonly CustomTheme[]): ThemePalette {
  if (key.startsWith(CUSTOM_THEME_PREFIX)) {
    const custom = customs.find((theme) => customThemeKey(theme) === key);
    if (custom) return customPalette(custom);
  }
  return themeDefinition(isThemeKey(key) ? key : DEFAULT_THEME);
}

/**
 * Variables del tema (incluido su acento) para previsualizarlo dentro de un
 * contenedor: las clases gus-* del interior pintan esa paleta y no la actual.
 */
export function themePreviewStyle(theme: ThemePalette): CSSProperties {
  return { ...theme.vars, "--color-gus-accent": theme.accent } as CSSProperties;
}

/** Pinta el tema en el documento y lo recuerda para el próximo arranque. */
export function applyTheme(definition: ThemePalette): void {
  const root = document.documentElement;

  root.dataset.theme = definition.key;
  root.dataset.scheme = definition.scheme;
  root.style.colorScheme = definition.scheme;
  for (const [name, value] of Object.entries(definition.vars)) {
    root.style.setProperty(name, value);
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, definition.key);
    if (definition.key.startsWith(CUSTOM_THEME_PREFIX)) {
      window.localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(definition));
    } else {
      window.localStorage.removeItem(CUSTOM_STORAGE_KEY);
    }
  } catch {
    // Sin almacenamiento no hay memoria entre sesiones; seguimos con el tema actual.
  }
}

/** Tema de la sesión anterior, para pintarlo antes de leer los ajustes. */
export function storedTheme(): ThemePalette {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw?.startsWith(CUSTOM_THEME_PREFIX)) {
      const saved = JSON.parse(window.localStorage.getItem(CUSTOM_STORAGE_KEY) ?? "null") as ThemePalette | null;
      // Solo se fía de lo que tenga forma de paleta: lo demás espera a los ajustes.
      if (saved?.key === raw && (saved.scheme === "dark" || saved.scheme === "light") && typeof saved.vars === "object") {
        return saved;
      }
    }
    return themeDefinition(isThemeKey(raw) ? raw : DEFAULT_THEME);
  } catch {
    return themeDefinition(DEFAULT_THEME);
  }
}
