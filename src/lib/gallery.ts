import type { VaultImage } from "./imageLinks.ts";
import { normalizeWikiText } from "./wikiLink.ts";

/** Antigüedad máxima que deja ver el filtro de fecha. */
export type GalleryPeriod = "all" | "week" | "month" | "year";

export interface GalleryFilter {
  /** Carpeta relativa (`""` = raíz del vault) o `null` para todas. */
  folder: string | null;
  period: GalleryPeriod;
  query: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_MS: Record<Exclude<GalleryPeriod, "all">, number> = {
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};

/** Carpeta relativa de una imagen (`""` si está en la raíz). */
export function imageFolder(image: VaultImage): string {
  const slash = image.relative.lastIndexOf("/");
  return slash === -1 ? "" : image.relative.slice(0, slash);
}

/** Carpetas que tienen alguna imagen, ordenadas, con la raíz primero. */
export function galleryFolders(images: readonly VaultImage[]): string[] {
  return [...new Set(images.map(imageFolder))].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

/** Imágenes que pasan los filtros, en el orden en que llegaron (las más recientes primero). */
export function filterGallery(
  images: readonly VaultImage[],
  filter: GalleryFilter,
  now: number,
): VaultImage[] {
  const wanted = normalizeWikiText(filter.query);
  const since = filter.period === "all" ? null : now - PERIOD_MS[filter.period];

  return images.filter(
    (image) =>
      (filter.folder === null || imageFolder(image) === filter.folder) &&
      (since === null || (image.modified_ms ?? 0) >= since) &&
      (wanted === "" || normalizeWikiText(image.relative).includes(wanted)),
  );
}

/** Índice de la imagen anterior o siguiente, dando la vuelta en los extremos. */
export function stepIndex(index: number, step: 1 | -1, total: number): number {
  if (total === 0) return -1;
  return (index + step + total) % total;
}
