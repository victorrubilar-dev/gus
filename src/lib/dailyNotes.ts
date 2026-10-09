import { safeFileName } from "./fileName.ts";
import { getLanguage, type Language } from "./i18n/core";

/**
 * Notas diarias: una por día, en una carpeta propia y con nombre numérico
 * («Diario/2026-10-09.md»), de modo que en el explorador el orden alfabético
 * coincide con el orden cronológico.
 *
 * La extensión .ts es necesaria en los smoke tests con Node (sin el resolutor
 * de Vite), igual que en `wikiLink.ts`.
 */

/** Carpeta por defecto dentro del vault. */
export const DAILY_DEFAULT_FOLDER = "Diario";

/**
 * Plantilla de una nota nueva: `{title}` es la fecha larga y el resto de
 * huecos (`{date}`, `{weekday}`, `{month}`, `{year}`) se rellenan al crearla.
 */
export const DAILY_DEFAULT_TEMPLATE =
  "# {title}\n\n## Tareas\n\n- [ ] \n\n## Notas\n\n";

/** Profundidad máxima de la carpeta de diarios (evita rutas absurdas). */
const MAX_FOLDER_DEPTH = 4;

/** Tamaño máximo de la plantilla guardada. */
const MAX_TEMPLATE_LENGTH = 4000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Fecha en formato ISO corto, con los componentes locales del día. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** «2026-10-09.md»: el nombre del archivo de un día. */
export function dailyFileName(date: Date): string {
  return `${isoDate(date)}.md`;
}

/** Ruta relativa de la nota de un día dentro del vault. */
export function dailyRelativePath(folder: string, date: Date): string {
  return `${sanitizeDailyFolder(folder)}/${dailyFileName(date)}`;
}

/**
 * Sanea la carpeta de diarios: sin separadores sueltos ni caracteres
 * prohibidos en nombres de archivo, y con un tope de profundidad. Lo que
 * quede vacío cae a la carpeta por defecto.
 */
export function sanitizeDailyFolder(raw: unknown): string {
  if (typeof raw !== "string") return DAILY_DEFAULT_FOLDER;

  const segments = raw
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map((segment) => safeFileName(segment))
    .slice(0, MAX_FOLDER_DEPTH);

  return segments.join("/") || DAILY_DEFAULT_FOLDER;
}

/**
 * Sanea la plantilla: se normalizan los saltos de línea y se topa la
 * longitud. Una plantilla vacía es válida (nota en blanco).
 */
export function normalizeDailyTemplate(raw: unknown): string {
  if (typeof raw !== "string") return DAILY_DEFAULT_TEMPLATE;

  const template = raw.replace(/\r\n?/g, "\n");
  return template.length > MAX_TEMPLATE_LENGTH ? template.slice(0, MAX_TEMPLATE_LENGTH) : template;
}

/**
 * Un día corrido: se parte del mediodía para que el cambio de hora (que
 * arranca o acorta justo a las 00:00 o a las 02:00) no descuadre el día.
 */
export function shiftDay(date: Date, delta: number): Date {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
  base.setDate(base.getDate() + delta);
  return base;
}

/** «9 de octubre de 2026» en español, «October 9, 2026» en inglés. */
export function dailyTitle(date: Date, lang: Language = getLanguage()): string {
  return new Intl.DateTimeFormat(lang, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Fecha larga usada como título por defecto de la plantilla. */
export function dailyHeading(
  date: Date,
  lang: Language = getLanguage(),
): Record<string, string> {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang, options).format(date);

  return {
    title: dailyTitle(date, lang),
    date: isoDate(date),
    weekday: format({ weekday: "long" }),
    month: format({ month: "long" }),
    year: String(date.getFullYear()),
  };
}

/**
 * Rellena los huecos de la plantilla con la fecha. Lo que no sea un hueco
 * conocido se queda escrito, para no borrar texto por una llave suelta.
 */
export function renderDailyTemplate(
  template: string,
  date: Date,
  lang: Language = getLanguage(),
): string {
  const values = dailyHeading(date, lang);
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

const DAILY_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/i;

/**
 * ¿Es la ruta la nota diaria de algún día? Devuelve ese día o `null`.
 * Comparar carpetas va en minúsculas, como el resto de rutas del vault.
 */
export function dailyNoteDateFor(
  path: string,
  vaultPath: string,
  folder: string,
): Date | null {
  const root = normalizeSlashes(vaultPath).toLowerCase();
  const clean = normalizeSlashes(path);
  const prefix = `${root}/${normalizeSlashes(sanitizeDailyFolder(folder)).toLowerCase()}/`;

  const lower = clean.toLowerCase();
  if (!lower.startsWith(prefix)) return null;

  const name = clean.slice(prefix.length);
  if (name.includes("/")) return null;

  const match = DAILY_FILE_RE.exec(name);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);

  // Que el día exista de verdad: 2026-02-30 no es una fecha.
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

/** ¿Es hoy el día de esa nota? Comparando solo el día, no la hora. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
