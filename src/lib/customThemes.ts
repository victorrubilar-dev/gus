import type { ThemeScheme } from "./themes.ts";

/** Colores base que define un tema: los mismos que pinta cada tema de serie. */
export interface ThemeColors {
  bg: string;
  panel: string;
  card: string;
  border: string;
  text: string;
  muted: string;
  eyes: string;
}

/** Tema hecho por la persona. Se guarda en los ajustes (`customThemes`). */
export interface CustomTheme {
  id: string;
  name: string;
  scheme: ThemeScheme;
  accent: string;
  colors: ThemeColors;
}

export const CUSTOM_THEME_PREFIX = "custom-";
export const MAX_CUSTOM_THEMES = 50;
const MAX_NAME = 40;

export const COLOR_KEYS = ["bg", "panel", "card", "border", "text", "muted", "eyes"] as const;

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Clave de ajustes de un tema personalizado (`settings.theme`). */
export function customThemeKey(theme: Pick<CustomTheme, "id">): string {
  return `${CUSTOM_THEME_PREFIX}${theme.id}`;
}

function cleanName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_NAME) : "";
}

/** Valida un tema leído de los ajustes o de un JSON. `null` si no sirve. */
export function normalizeCustomTheme(raw: unknown): CustomTheme | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  const colors = data.colors as Record<string, unknown> | undefined;
  const id = typeof data.id === "string" && /^[a-z0-9-]{1,40}$/i.test(data.id) ? data.id : null;
  const name = cleanName(data.name);
  if (!id || !name || typeof colors !== "object" || colors === null) return null;
  if (data.scheme !== "dark" && data.scheme !== "light") return null;
  if (typeof data.accent !== "string" || !HEX_RE.test(data.accent)) return null;

  const clean = {} as ThemeColors;
  for (const key of COLOR_KEYS) {
    const value = colors[key];
    if (typeof value !== "string" || !HEX_RE.test(value)) return null;
    clean[key] = value.toLowerCase();
  }
  return { id, name, scheme: data.scheme, accent: data.accent.toLowerCase(), colors: clean };
}

/** Lista de temas de los ajustes: solo los válidos, sin ids repetidos y con tope. */
export function normalizeCustomThemes(raw: unknown): CustomTheme[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomTheme[] = [];
  for (const item of raw) {
    const theme = normalizeCustomTheme(item);
    if (!theme || seen.has(theme.id)) continue;
    seen.add(theme.id);
    out.push(theme);
    if (out.length === MAX_CUSTOM_THEMES) break;
  }
  return out;
}

/** Id corto y único para un tema nuevo. */
export function newThemeId(taken: readonly CustomTheme[]): string {
  const ids = new Set(taken.map((theme) => theme.id));
  let id = "";
  do id = Math.random().toString(36).slice(2, 10);
  while (id === "" || ids.has(id));
  return id;
}

/** JSON con el que se comparte un tema: sin id, que es cosa de cada equipo. */
export function exportThemeJson(theme: CustomTheme): string {
  const { name, scheme, accent, colors } = theme;
  return `${JSON.stringify({ gusTheme: 1, name, scheme, accent, colors }, null, 2)}\n`;
}

/** Lee un tema exportado. Lanza un error con un texto para la persona si no sirve. */
export function importThemeJson(text: string, id: string): CustomTheme {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("invalidJson");
  }
  const theme = normalizeCustomTheme({ ...(data as object), id });
  if (!theme) throw new Error("invalidTheme");
  return theme;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores `#rrggbb` (de 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pares de un tema que no llegan al 4,5:1 de WCAG AA para texto normal. */
export function lowContrastPairs(theme: Pick<CustomTheme, "accent" | "colors">): ("text" | "muted" | "accent")[] {
  const { colors } = theme;
  const surfaces = [colors.bg, colors.panel, colors.card];
  const worst = (fg: string) => Math.min(...surfaces.map((surface) => contrastRatio(fg, surface)));
  return (["text", "muted", "accent"] as const).filter(
    (key) => worst(key === "accent" ? theme.accent : colors[key]) < 4.5,
  );
}
