/** Operaciones sobre pizarras del vault: cargar, duplicar, renombrar y exportar (una o varias). */
import { invoke } from "@tauri-apps/api/core";
import { writeImage } from "@tauri-apps/plugin-clipboard-manager";
import { parseBoard, serializeBoard, type Board, type BoardElement } from "./board";
import { bytesToBase64, EXPORT_BACKGROUND, EXPORT_PALETTE, svgToPng, utf8ToBase64 } from "./boardExport";
import { renderBoardSvg, type BoardSvg } from "./boardSvg";
import { copyName } from "./boardNames";
import { joinPath, safeFileName } from "./fileName";
import { createTaskId } from "./taskStore";

export type ExportFormat = "svg" | "png";

export interface BoardRef {
  id: string;
  name: string;
}

export async function loadBoard(vaultPath: string, id: string, fallbackName: string): Promise<Board> {
  return parseBoard(await invoke<string>("load_board", { vaultPath, id }), fallbackName);
}

/** Lee del vault las imágenes que usa una pizarra (las que faltan se quedan fuera). */
export async function loadBoardImages(vaultPath: string, elements: readonly BoardElement[]): Promise<Record<string, string>> {
  const sources = [...new Set(elements.flatMap((el) => (el.type === "image" ? [el.src] : [])))];
  const entries = await Promise.all(
    sources.map(async (src) => {
      try {
        return [src, await invoke<string>("read_vault_image", { path: joinPath(vaultPath, src) })] as const;
      } catch {
        return null; // movida o borrada: sale como hueco
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

/** Dibujo exportable de una pizarra: fondo blanco, tinta real e imágenes incrustadas. `null` si está vacía. */
export function drawForExport(elements: readonly BoardElement[], images: Record<string, string>): BoardSvg | null {
  return renderBoardSvg(elements, { palette: EXPORT_PALETTE, images, background: EXPORT_BACKGROUND });
}

/** Contenido del archivo (Base64, como viaja hasta el backend) en el formato pedido. */
export async function encodeExport(drawn: BoardSvg, format: ExportFormat): Promise<string> {
  return format === "svg" ? utf8ToBase64(drawn.svg) : bytesToBase64(await svgToPng(drawn));
}

/** Copia una pizarra con otro id y un nombre libre; devuelve el id de la copia. */
export async function duplicateBoard(vaultPath: string, source: BoardRef, takenNames: readonly string[], copyLabel: string): Promise<string> {
  const { pinned: _pinned, ...board } = await loadBoard(vaultPath, source.id, source.name);
  const id = createTaskId();
  // La copia conserva el color pero no la fijada: esa es de la original.
  await invoke("save_board", { vaultPath, id, json: serializeBoard({ ...board, name: copyName(source.name, takenNames, copyLabel) }) });
  return id;
}

export async function renameBoard(vaultPath: string, id: string, name: string): Promise<void> {
  const board = await loadBoard(vaultPath, id, name);
  await invoke("save_board", { vaultPath, id, json: serializeBoard({ ...board, name }) });
}

/** Cambia la etiqueta de una pizarra (fijarla o ponerle color; `color: null` la quita) sin tocar su contenido. */
export async function setBoardLabel(vaultPath: string, id: string, fallbackName: string, change: { pinned?: boolean; color?: string | null }): Promise<void> {
  const board = await loadBoard(vaultPath, id, fallbackName);
  const next: Board = { ...board };
  if (change.pinned !== undefined) {
    if (change.pinned) next.pinned = true;
    else delete next.pinned;
  }
  if (change.color !== undefined) {
    if (change.color) next.color = change.color;
    else delete next.color;
  }
  await invoke("save_board", { vaultPath, id, json: serializeBoard(next) });
}

/** Copia la pizarra entera como imagen PNG al portapapeles; `false` si está vacía. */
export async function copyBoardImage(elements: readonly BoardElement[], images: Record<string, string>): Promise<boolean> {
  const drawn = drawForExport(elements, images);
  if (!drawn) return false;
  await writeImage(await svgToPng(drawn));
  return true;
}

export interface BatchResult {
  saved: number;
  /** Pizarras vacías: no hay nada que dibujar. */
  empty: number;
  failed: string[];
}

/** Exporta varias pizarras a una carpeta, una por archivo; si el nombre ya existe no se pisa. */
export async function exportBoardsToFolder(vaultPath: string, boards: readonly BoardRef[], format: ExportFormat, folder: string): Promise<BatchResult> {
  const result: BatchResult = { saved: 0, empty: 0, failed: [] };
  for (const ref of boards) {
    try {
      const board = await loadBoard(vaultPath, ref.id, ref.name);
      const drawn = drawForExport(board.elements, await loadBoardImages(vaultPath, board.elements));
      if (!drawn) {
        result.empty += 1;
        continue;
      }
      await invoke("write_image_file", {
        path: joinPath(folder, safeFileName(board.name || ref.name)),
        data: await encodeExport(drawn, format),
        format,
        unique: true,
      });
      result.saved += 1;
    } catch {
      result.failed.push(ref.name);
    }
  }
  return result;
}
