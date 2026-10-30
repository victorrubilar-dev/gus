/**
 * Qué hacer con la nota abierta cuando algo ajeno a la app toca su archivo
 * (REQ-13). Pura para poder probarla; la lectura del disco la hace App.
 */
export type ExternalAction = "ignore" | "reload" | "conflict";

/**
 * - `ignore`: el disco ya dice lo mismo que la última versión guardada (eco de
 *   nuestro propio guardado, o un `touch`).
 * - `reload`: cambió fuera y no hay nada sin guardar que perder.
 * - `conflict`: cambió fuera y el editor tiene texto sin guardar; decide el usuario.
 */
export function externalAction(
  diskContent: string,
  savedContent: string,
  editorDirty: boolean,
): ExternalAction {
  if (diskContent === savedContent) return "ignore";
  return editorDirty ? "conflict" : "reload";
}
