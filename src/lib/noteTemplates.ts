/** Plantillas de nota: notas normales dentro de una carpeta del vault (Ajustes → Notas). */

export const TEMPLATES_DEFAULT_FOLDER = "Plantillas";

/** Notas de `notes` que viven en `folder` (o en sus subcarpetas), sin distinguir mayúsculas. */
export function templatesIn<T extends { relative: string }>(notes: readonly T[], folder: string): T[] {
  const prefix = `${folder.replace(/\\/g, "/").toLowerCase()}/`;
  return notes.filter((note) => note.relative.replace(/\\/g, "/").toLowerCase().startsWith(prefix));
}
