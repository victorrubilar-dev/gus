import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Abre una URL fuera de la app: en Tauri con el navegador del sistema y, al
 * desarrollar en el navegador, en una pestaña nueva.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
