import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/**
 * Copia `text` al portapapeles y devuelve `true` si se consiguió.
 *
 * Primero se usa el plugin de Tauri (el portapapeles del sistema); si el
 * entorno no lo tiene (p. ej. la página abierta en un navegador durante el
 * desarrollo) se recurre a la API del navegador.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await writeText(text);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
