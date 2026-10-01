import en from "./locales/en";
import es from "./locales/es";

export const LANGUAGES = ["es", "en"] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "es";

/** Clave de traducción: exactamente las claves definidas en el catálogo de español. */
export type MessageKey = keyof typeof es;

export type TranslateParams = Record<string, string | number>;

export interface LanguageInfo {
  value: Language;
  label: string;
  /** Nombre nativo, para no tener que traducirlo. */
  native: string;
}

export const LANGUAGE_LIST: readonly LanguageInfo[] = [
  { value: "es", label: "Spanish", native: "Español" },
  { value: "en", label: "English", native: "English" },
];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** Idioma del sistema (`navigator.language`), o `null` si no hay ninguno conocido. */
export function detectLanguage(): Language | null {
  return matchSystemLanguage(false);
}

/**
 * Idiomas afines al español: si el sistema habla uno de ellos y Gus no lo
 * traduce, la versión más cercana es la española antes que la inglesa.
 */
const SIMILAR_TO_SPANISH = new Set([
  "an", // aragonés
  "ca", // catalán
  "eo", // esperanto
  "fr", // francés
  "gl", // gallego
  "it", // italiano
  "oc", // occitano
  "pt", // portugués
  "ro", // rumano
]);

/**
 * Idioma del sistema: primero una traducción exacta (`es`, `en`) y, si no la
 * hay, la más parecida (una lengua afín al español). `null` si no encaja nada.
 */
export function detectClosestLanguage(): Language | null {
  return matchSystemLanguage(true);
}

function matchSystemLanguage(allowSimilar: boolean): Language | null {
  if (typeof navigator === "undefined") return null;
  for (const tag of [navigator.language, ...(navigator.languages ?? [])]) {
    if (typeof tag !== "string") continue;
    const base = tag.toLowerCase().split("-")[0];

    const exact = LANGUAGES.find((lang) => lang === base);
    if (exact) return exact;

    if (allowSimilar && SIMILAR_TO_SPANISH.has(base)) return "es";
  }
  return null;
}

/**
 * Idioma con el que Gus arranca la primera vez (nada está guardado aún):
 * el del sistema, la opción más parecida si no está traducido y, en último
 * término, inglés. Solo quien no tenga `navigator` (p. ej. al probar) cae al
 * español por defecto.
 */
export function resolveSystemLanguage(): Language {
  if (typeof navigator === "undefined") return DEFAULT_LANGUAGE;
  return detectClosestLanguage() ?? "en";
}

const CATALOGS: Record<Language, Record<string, string>> = { es, en };

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function interpolate(template: string, params?: TranslateParams): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Sustituye `{name}` por el valor dado; pensado para textos que no son del catálogo. */
export function fill(template: string, params: TranslateParams): string {
  return interpolate(template, params);
}

const pluralRules: Partial<Record<Language, Intl.PluralRules>> = {};

/**
 * Categoría gramatical de `count` en el idioma pedido («one», «many»…).
 * Se cachea: se consulta en cada plural de cada lista que se pinta.
 */
function pluralCategory(lang: Language, count: number): string {
  const rules = (pluralRules[lang] ??= new Intl.PluralRules(lang));
  return rules.select(count);
}

/**
 * Busca la plantilla de una clave. Con `{count}` en los parámetros se preferse
 * la variante gramatical (`clave__one`, `clave__other`, `clave__many`…), que es
 * como el español y el inglés distinguen «1 imagen» de «2 imágenes».
 */
function resolveTemplate(lang: Language, key: MessageKey, params?: TranslateParams): string {
  const catalog = CATALOGS[lang] ?? es;

  // Una cadena vacía cuenta como «sin traducir»: se cae al español antes que
  // dejar un hueco en blanco en la interfaz.
  if (params && typeof params.count === "number" && Number.isFinite(params.count)) {
    const category = pluralCategory(lang, params.count);
    const variant = `${key}__${category}` as MessageKey;
    if (catalog[variant]) return catalog[variant];
    if (es[variant]) return es[variant];
  }

  return catalog[key] || es[key] || key;
}

/**
 * Traduce una clave al idioma pedido. Si el idioma activo no la trae (un
 * catálogo sin traducir del todo) se cae al español y, en último caso, a la
 * propia clave: la interfaz nunca se queda en blanco.
 */
export function translate(lang: Language, key: MessageKey, params?: TranslateParams): string {
  return interpolate(resolveTemplate(lang, key, params), params);
}

/* ------------------------------------------------------------------ */
/* Idioma activo                                                        */
/* ------------------------------------------------------------------ */

/**
 * El idioma vive fuera de React para que los módulos que no son componentes
 * (resúmenes de archivos, prioridades, errores…) también puedan traducir. El
 * proveedor de la app lo actualiza al arrancar y en cada cambio.
 */
let current: Language = DEFAULT_LANGUAGE;

export function getLanguage(): Language {
  return current;
}

export function setLanguage(lang: Language): void {
  current = isLanguage(lang) ? lang : DEFAULT_LANGUAGE;
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
}

/** Traduce con el idioma activo. Es la función que usan casi todas las piezas. */
export function t(key: MessageKey, params?: TranslateParams): string {
  return translate(current, key, params);
}
