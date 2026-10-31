/**
 * Actualización automática: el plugin de Tauri baja una versión firmada y la
 * instala; aquí solo vive el progreso de la descarga y la comprobación.
 * Donde la app no puede reemplazarse a sí misma (un .deb o un .rpm instalado
 * en el sistema) `checkSelfUpdate` lo dice y se sigue con el aviso manual.
 */
import { invoke } from "@tauri-apps/api/core";
import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const CHECK_TIMEOUT_MS = 8000;

export interface DownloadProgress {
  downloaded: number;
  /** `null` si el servidor no dijo el tamaño: la barra queda indeterminada. */
  total: number | null;
}

export const START_PROGRESS: DownloadProgress = { downloaded: 0, total: null };

/** Estado del aviso de actualización automática. */
export type SelfUpdateState =
  | { phase: "downloading"; version: string; progress: DownloadProgress }
  | { phase: "ready"; version: string }
  | { phase: "installing"; version: string }
  | { phase: "error"; version: string; message: string };

export function reduceDownload(state: DownloadProgress, event: DownloadEvent): DownloadProgress {
  switch (event.event) {
    case "Started":
      return { downloaded: 0, total: event.data.contentLength ?? null };
    case "Progress":
      return { ...state, downloaded: state.downloaded + event.data.chunkLength };
    case "Finished":
      return { ...state, downloaded: state.total ?? state.downloaded };
  }
}

/** Porcentaje entero 0–100, o `null` si no se conoce el total. */
export function percentDone(progress: DownloadProgress): number | null {
  if (progress.total === null || progress.total <= 0) return null;
  return Math.min(100, Math.floor((progress.downloaded / progress.total) * 100));
}

export type SelfUpdateCheck =
  | { capable: false }
  | { capable: true; failed: true }
  | { capable: true; failed: false; update: Update | null };

/**
 * Busca una versión firmada nueva. Cualquier fallo (sin red, firma que no
 * cuadra, manifiesto ausente) se devuelve como `failed`, igual que la
 * comprobación manual: una app local no debe fallar por no poder mirar internet.
 */
export async function checkSelfUpdate(): Promise<SelfUpdateCheck> {
  let capable = false;
  try {
    capable = await invoke<boolean>("can_self_update");
  } catch {
    // Sin el comando (navegador, pruebas) se trata como no compatible.
  }
  if (!capable) return { capable: false };

  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    return { capable: true, failed: false, update: await check({ timeout: CHECK_TIMEOUT_MS }) };
  } catch {
    return { capable: true, failed: true };
  }
}
