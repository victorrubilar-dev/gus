const EXTERNAL_STORAGE_TREE = "content://com.android.externalstorage.documents/tree/";

/**
 * El selector de carpetas de Android devuelve un URI de documento
 * (`content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FGus`),
 * pero el backend trabaja con rutas: se traduce a `/storage/emulated/0/Documents/Gus`.
 * Una ruta normal (escritorio) se devuelve igual.
 */
export function folderPickerPath(selected: string): string {
  if (!selected.startsWith("content://")) return selected;
  if (!selected.startsWith(EXTERNAL_STORAGE_TREE)) {
    throw new Error("Elige una carpeta del almacenamiento del teléfono");
  }
  const docId = decodeURIComponent(selected.slice(EXTERNAL_STORAGE_TREE.length).split("/")[0]);
  const colon = docId.indexOf(":");
  const volume = colon === -1 ? docId : docId.slice(0, colon);
  const rest = colon === -1 ? "" : docId.slice(colon + 1);
  // `primary` es la memoria interna; una tarjeta SD viene con su id (`1234-ABCD`).
  const root = volume === "primary" ? "/storage/emulated/0" : `/storage/${volume}`;
  return rest ? `${root}/${rest}` : root;
}
