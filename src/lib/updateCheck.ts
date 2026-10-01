import { APP_VERSION, GITHUB_REPO, RELEASES_URL } from "./version";

/** Versión nueva encontrada en GitHub, con dónde leer los cambios. */
export interface UpdateInfo {
  /** Versión publicada, sin la «v» inicial que suelen llevar las etiquetas. */
  version: string;
  url: string;
  publishedAt: string | null;
}

const API_BASE = "https://api.github.com/repos";
const REQUEST_TIMEOUT_MS = 8000;
/** Última versión de la que se avisó: para no repetir el mismo aviso. */
const DISMISSED_KEY = "gus.update.dismissed";

/** Quita la «v» inicial y los espacios: «v0.2.0» y «0.2.0» son lo mismo. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, "");
}

/**
 * ¿`candidate` es más nueva que `current`? Comparación numérica segmento a
 * segmento (0.10 > 0.9), que es suficiente para las etiquetas que publica el
 * proyecto y no necesita librería externa.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = normalizeVersion(candidate).split(/[.-]/);
  const b = normalizeVersion(current).split(/[.-]/);

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = Number.parseInt(a[index] ?? "0", 10);
    const right = Number.parseInt(b[index] ?? "0", 10);
    const leftNumber = Number.isFinite(left) ? left : 0;
    const rightNumber = Number.isFinite(right) ? right : 0;
    if (leftNumber !== rightNumber) return leftNumber > rightNumber;
  }
  return false;
}

/** Lanza la petición con tope de tiempo: sin red no se debe frenar el arranque. */
async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    // 403/429 (límite de peticiones) y 404 se tratan como «sin información».
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Última versión publicada en el repositorio. Primero la última *release* y,
 * si el proyecto aún no usa releases, la última etiqueta (tag): entre una y
 * otra hay que mirar ambas porque el historial puede crecer por cualquiera de
 * las dos vías.
 */
export async function fetchLatestVersion(): Promise<UpdateInfo | null> {
  const release = await fetchJson(`${API_BASE}/${GITHUB_REPO}/releases/latest`);
  if (release && typeof release === "object") {
    const data = release as Record<string, unknown>;
    const tag = typeof data.tag_name === "string" ? data.tag_name : "";
    if (tag) {
      return {
        version: normalizeVersion(tag),
        url:
          typeof data.html_url === "string" && data.html_url
            ? data.html_url
            : RELEASES_URL,
        publishedAt: typeof data.published_at === "string" ? data.published_at : null,
      };
    }
  }

  const tags = await fetchJson(`${API_BASE}/${GITHUB_REPO}/tags?per_page=1`);
  if (Array.isArray(tags) && tags.length > 0) {
    const first = tags[0] as Record<string, unknown>;
    const name = typeof first.name === "string" ? first.name : "";
    if (name) {
      return {
        version: normalizeVersion(name),
        url: `${RELEASES_URL}/tag/${encodeURIComponent(name)}`,
        publishedAt: null,
      };
    }
  }

  return null;
}

/** Resultado de una comprobación: o hay versión nueva, o se sabe que no, o no se pudo saber. */
export type UpdateCheckResult =
  | { status: "available"; info: UpdateInfo }
  | { status: "uptodate" }
  | { status: "unavailable" };

/**
 * Comprueba si hay una versión más nueva que la instalada. Cualquier fallo
 * (sin red, GitHub caído, límite de peticiones) se devuelve como
 * «unavailable»: una app local no debe fallar por no poder mirar internet.
 */
export async function checkForUpdate(
  current: string = APP_VERSION,
): Promise<UpdateCheckResult> {
  const latest = await fetchLatestVersion();
  if (!latest) return { status: "unavailable" };
  return isNewerVersion(latest.version, current)
    ? { status: "available", info: latest }
    : { status: "uptodate" };
}

/**
 * Estado que pinta la interfaz: el resultado de la última comprobación más
 * los estados de reposo y de «comprobando…».
 */
export type UpdateUiState = UpdateCheckResult | { status: "idle" } | { status: "checking" };

/** Versión de la que ya se avisó y se decidió ignorar. */
export function dismissedVersion(): string | null {
  try {
    const stored = window.localStorage.getItem(DISMISSED_KEY);
    return stored ? normalizeVersion(stored) : null;
  } catch {
    return null;
  }
}

/** Marca una versión como ya vista para no volver a avisar de ella. */
export function dismissUpdate(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, normalizeVersion(version));
  } catch {
    // Sin almacenamiento el aviso volverá a salir; es solo un molestia menor.
  }
}
