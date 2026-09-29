import { invoke } from "@tauri-apps/api/core";

/** Un archivo juzgado por el comando `import_files_to_vault`. */
export interface ImportItem {
  /** Ruta original en el equipo. */
  source: string;
  /** Dónde acabó en el vault (`null` si no se pudo añadir). */
  path: string | null;
  /** Motivo del fallo o del «ya estaba ahí». */
  error: string | null;
}

/**
 * Extensiones que el vault sabe abrir. Tiene que cuadrar con `is_importable`
 * de Rust, o el archivo se elegirá y luego se rechazará con su motivo.
 */
const IMAGE_EXTENSIONS = [
  "png",
  "apng",
  "jpg",
  "jpeg",
  "jpe",
  "jfif",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
  "cur",
  "tif",
  "tiff",
  "heic",
  "heif",
  "jxl",
  "pnm",
  "ppm",
  "pgm",
  "pbm",
  "qoi",
  "xbm",
];

/** Filtros del diálogo «Añadir archivos». */
export const IMPORT_FILTERS: { name: string; extensions: string[] }[] = [
  {
    name: "Notas, PDF e imágenes",
    extensions: ["md", "pdf", ...IMAGE_EXTENSIONS],
  },
  { name: "Todos los archivos", extensions: ["*"] },
];

/** Copia archivos del equipo al vault (no se mueven: el original queda donde estaba). */
export async function importFilesIntoVault(
  sources: string[],
  destDir: string,
): Promise<ImportItem[]> {
  return invoke<ImportItem[]>("import_files_to_vault", { sources, destDir });
}

/** Carpeta destino mostrada como la vería el usuario: relativa al vault. */
export function relativeFolderLabel(dest: string, vault: string): string {
  if (vault && dest.startsWith(vault)) {
    const rest = dest.slice(vault.length).replace(/^[\\/]+/, "");
    return rest || "raíz del vault";
  }
  return dest;
}

export interface ImportSummary {
  ok: boolean;
  message: string;
}

/**
 * Frase corta para avisar del resultado: cuántos entraron, en qué carpeta y,
 * si hubo, el motivo (solo los distintos, que un lote grande dice lo mismo).
 */
export function summarizeImport(items: ImportItem[], destLabel: string): ImportSummary {
  if (items.length === 0) {
    return { ok: true, message: "No se seleccionó ningún archivo." };
  }

  const added = items.filter((item) => item.path && !item.error);
  const problems = items.filter((item) => item.error).map((item) => item.error as string);
  const reasons = [...new Set(problems)];
  const extra = reasons.length > 2 ? ` (+${reasons.length - 2})` : "";
  const motive = `${reasons.slice(0, 2).join(" · ")}${extra}`;

  if (added.length === 0) {
    return { ok: false, message: `No se añadió ningún archivo: ${motive}.` };
  }

  const head = `Añadido${added.length === 1 ? "" : "s"} ${added.length} archivo${added.length === 1 ? "" : "s"} a «${destLabel}»`;
  const tail = problems.length > 0 ? ` ${problems.length} sin añadir: ${motive}.` : ".";

  return { ok: problems.length === 0, message: `${head}${tail}` };
}
