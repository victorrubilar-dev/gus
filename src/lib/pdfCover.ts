import { invoke } from "@tauri-apps/api/core";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerSrc;

const COVER_WIDTH = 240;
const STORAGE_PREFIX = "gus.pdfcover.";
const memory = new Map<string, string>();
/** Cola de un solo carril: cada PDF viaja entero por IPC, de uno en uno no se atasca la app. */
let queue: Promise<unknown> = Promise.resolve();

function storageKey(path: string, modifiedMs: number | null): string {
  return `${STORAGE_PREFIX}${path}@${modifiedMs ?? 0}`;
}

async function renderCover(path: string): Promise<string> {
  const src = await invoke<string>("read_vault_pdf", { path });
  const data = new Uint8Array(await (await fetch(src)).arrayBuffer());
  const task = getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    void task.destroy();
  }
}

/**
 * Portada (primera página) de un PDF como data URL, o `null` si no se pudo
 * generar (PDF dañado, cifrado, demasiado grande…). Se recuerda por ruta y
 * fecha de modificación, así que un PDF editado regenera la suya.
 *
 * shortcut: las portadas viejas de PDF modificados quedan en localStorage;
 * limpiarlas si algún día pesan.
 */
export function pdfCover(path: string, modifiedMs: number | null): Promise<string | null> {
  const key = storageKey(path, modifiedMs);
  const cached = memory.get(key);
  if (cached) return Promise.resolve(cached);

  try {
    const stored = window.localStorage.getItem(key);
    if (stored) {
      memory.set(key, stored);
      return Promise.resolve(stored);
    }
  } catch {
    // Sin almacenamiento solo se pierde la caché entre sesiones.
  }

  const job = queue.then(async () => {
    try {
      const cover = await renderCover(path);
      memory.set(key, cover);
      try {
        window.localStorage.setItem(key, cover);
      } catch {
        // Cuota llena: la portada vive en memoria esta sesión.
      }
      return cover;
    } catch {
      return null;
    }
  });
  queue = job;
  return job;
}
