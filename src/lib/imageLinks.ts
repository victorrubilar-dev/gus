// La extensión .ts es necesaria en los smoke tests con Node (sin el resolutor de Vite).
import { baseName, isImageName, joinPath, parentPath } from "./fileName.ts";
import { normalizeWikiText } from "./wikiLink.ts";

/** Imagen que el vault sabe abrir: misma lista que `is_image_file` de Rust. */
export function isImagePath(path: string): boolean {
  return isImageName(path);
}

/** Imagen que ofrece el selector del menú «/». */
export interface VaultImage {
  /** Nombre del archivo, con extensión. */
  name: string;
  /** Ruta absoluta dentro del vault. */
  path: string;
  /** Ruta relativa a la raíz del vault, con `/`. */
  relative: string;
  /** Última modificación en milisegundos (`null` si no se pudo leer). */
  modified_ms: number | null;
}

/**
 * Ruta del destino de un enlace de imagen, escrita para que Markdown la
 * entienda: se escapan el `%` (para que `%20` no se confunda con un escape),
 * los espacios y los paréntesis y el numeral, que romperían el destino.
 */
export function encodeImageDest(path: string): string {
  // `encodeURI` ya escapa espacios, `%` y acentos; los paréntesis y el numeral
  // se les escapan aparte porque él los deja pasar.
  return encodeURI(path).replace(
    /[()#]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Lo inverso: lo que la vista previa recibe en `src` vuelve a ser ruta. */
export function decodeImageDest(dest: string): string {
  const trimmed = dest.trim();
  if (!trimmed) return "";
  try {
    return decodeURIComponent(trimmed);
  } catch {
    // Un destino escrito a mano («%zz»): se usa tal cual.
    return trimmed;
  }
}

/** Texto alternativo de la imagen: el nombre sin extensión. */
export function imageAlt(path: string): string {
  const name = baseName(path);
  const withoutExtension = name.replace(/\.[^./\\]+$/, "").trim();
  return withoutExtension || name || "imagen";
}

/** Enlace `![alt](ruta)` listo para pegar en la nota. */
export function imageMarkdown(alt: string, destination: string): string {
  // Los corchetes cerrarían el texto alternativo y un salto de línea partiría
  // la imagen en dos, así que el texto se deja en una sola línea corriente.
  const cleanAlt = alt
    .replace(/[\r\n]+/g, " ")
    .replace(/[[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `![${cleanAlt}](${encodeImageDest(destination)})`;
}

/** Texto alternativo y destino de un enlace de imagen. */
export interface ImageLineParts {
  alt: string;
  destination: string;
}

const IMAGE_LINE = /^\s{0,3}!\[([^\]\n]*)\]\(([^()\n]+)\)\s*$/;

/**
 * Si la línea entera es un enlace de imagen, sus partes; si no, `null`.
 *
 * Es la imagen de bloque (la que ocupa una línea para sola), la que en el modo
 * edición puede crecer hasta el tamaño de su imagen real. Una imagen con texto
 * a los lados o una referencia `![alt][ref]` no lo son: esas se quedan como
 * miniatura de fila. El destino no admite paréntesis porque `imageMarkdown`
 * los escapa; escrito a mano con ellos, la línea se trata como texto.
 */
export function parseImageLine(text: string): ImageLineParts | null {
  const match = IMAGE_LINE.exec(text);
  if (!match) return null;
  return { alt: match[1], destination: match[2] };
}

/** ¿La línea entera es un enlace de imagen? (Ver `parseImageLine`.) */
export function isImageLine(text: string): boolean {
  return parseImageLine(text) !== null;
}

/**
 * Ruta de `toPath` relativa a `fromDir`, con `/` (así lo espera Markdown).
 * Si comparten pocos niveles sube con `../`; si no comparten nada (volumen
 * distinto en Windows) se devuelve la ruta tal cual.
 */
export function relativePath(fromDir: string, toPath: string): string {
  const from = fromDir.replace(/\\/g, "/");
  const to = toPath.replace(/\\/g, "/");
  if (!from || !to) return to;

  const fromParts = from.split("/").filter((part) => part !== "");
  const toParts = to.split("/").filter((part) => part !== "");
  if (fromParts.length === 0 || toParts.length === 0) return to;
  if (fromParts[0] !== toParts[0]) return to;

  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }

  const up = Array.from({ length: fromParts.length - shared }, () => "..");
  const rest = toParts.slice(shared);
  const parts = [...up, ...rest];
  return parts.length > 0 ? parts.join("/") : baseName(to);
}

/**
 * Destino que se escribe en la nota: la imagen relativa a la carpeta de la
 * nota, para que el enlace siga funcionando si se mueve la carpeta entera.
 */
export function imageDest(notePath: string, imagePath: string): string {
  return relativePath(parentPath(notePath), imagePath);
}

/**
 * Rutas absolutas que pueden contener la imagen referida por `src` en la vista
 * previa: relativa a la nota primero (como se escribe al insertarla) y, si
 * no, relativa a la raíz del vault (lo que escriba quien use rutas de vault).
 * Un `src` ya absoluto o con esquema (`data:`, `https:`) se devuelve sin más.
 */
export function imageCandidates(src: string, notePath: string, vaultPath: string | null): string[] {
  const clean = decodeImageDest(src);
  if (!clean) return [];

  // Ruta absoluta o `~/…`: no hay nada que resolver.
  if (clean.startsWith("/") || clean.startsWith("~") || /^[a-z]:[\\/]/i.test(clean)) {
    return [clean];
  }

  // Esquema ajeno al sistema de archivos (`data:`, `http:`…): lo pinta el
  // navegador. Un «C:\» ya se ha descartado arriba.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return [];

  const candidates = [joinPath(parentPath(notePath), clean)];
  if (vaultPath) {
    const fromVault = joinPath(vaultPath, clean);
    if (!candidates.includes(fromVault)) candidates.push(fromVault);
  }
  return candidates;
}

/** Carpeta de una imagen dentro del vault (`null` si está en la raíz). */
export function imageFolderLabel(image: VaultImage): string | null {
  const slash = image.relative.lastIndexOf("/");
  return slash === -1 ? null : image.relative.slice(0, slash);
}

/**
 * Imágenes que encajan con lo tecleado en el selector: gana el nombre por
 * delante de la carpeta y, a igualdad, el más reciente (que es el orden en que
 * las trae el vault).
 */
export function filterVaultImages(
  images: readonly VaultImage[],
  query: string,
  limit = 12,
): VaultImage[] {
  const wanted = normalizeWikiText(query);
  if (!wanted) return images.slice(0, limit);

  const scored: { image: VaultImage; score: number }[] = [];
  for (const image of images) {
    const base = normalizeWikiText(image.name);
    const full = normalizeWikiText(image.relative);

    let score = -1;
    if (base.startsWith(wanted)) score = 0;
    else if (full.startsWith(wanted)) score = 1;
    else if (base.includes(wanted)) score = 2;
    else if (full.includes(wanted)) score = 3;

    if (score >= 0) scored.push({ image, score });
  }

  scored.sort((a, b) => a.score - b.score || a.image.relative.localeCompare(b.image.relative));
  return scored.slice(0, limit).map((entry) => entry.image);
}
