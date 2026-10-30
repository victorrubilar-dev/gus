/**
 * Estanterías de la biblioteca de PDF (REQ-02). Puras: la lectura y escritura
 * de `.gus-library.json` van por los comandos `load_library` / `save_library`.
 */
export interface LibraryStore {
  version?: number;
  /** Nombres de las estanterías, en el orden en que se muestran. */
  shelves: string[];
  /** Ruta relativa del PDF → estantería. Sin entrada = «sin estantería». */
  assign: Record<string, string>;
}

/** PDF tal como lo lista `list_vault_pdfs`. */
export interface VaultPdf {
  name: string;
  path: string;
  relative: string;
  modified_ms: number | null;
}

/** Filtro de la vista: todos, solo los sueltos o una estantería concreta. */
export type ShelfFilter = { kind: "all" } | { kind: "none" } | { kind: "shelf"; name: string };

export const EMPTY_LIBRARY: LibraryStore = { shelves: [], assign: {} };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Añade una estantería; ignora los nombres vacíos o repetidos (sin mirar mayúsculas). */
export function addShelf(store: LibraryStore, name: string): LibraryStore {
  const clean = name.trim();
  if (!clean || store.shelves.some((shelf) => sameName(shelf, clean))) return store;
  return { ...store, shelves: [...store.shelves, clean] };
}

/** Renombra una estantería llevándose sus PDF. Si el nombre nuevo ya existe, no hace nada. */
export function renameShelf(store: LibraryStore, from: string, to: string): LibraryStore {
  const clean = to.trim();
  if (!clean || from === clean) return store;
  if (store.shelves.some((shelf) => shelf !== from && sameName(shelf, clean))) return store;

  return {
    ...store,
    shelves: store.shelves.map((shelf) => (shelf === from ? clean : shelf)),
    assign: Object.fromEntries(
      Object.entries(store.assign).map(([path, shelf]) => [path, shelf === from ? clean : shelf]),
    ),
  };
}

/** Quita una estantería; sus PDF no se borran, vuelven a «sin estantería». */
export function removeShelf(store: LibraryStore, name: string): LibraryStore {
  return {
    ...store,
    shelves: store.shelves.filter((shelf) => shelf !== name),
    assign: Object.fromEntries(Object.entries(store.assign).filter(([, shelf]) => shelf !== name)),
  };
}

/** Pone un PDF en una estantería (`null` lo deja suelto). */
export function assignShelf(store: LibraryStore, relative: string, shelf: string | null): LibraryStore {
  const assign = { ...store.assign };
  if (shelf === null) delete assign[relative];
  else assign[relative] = shelf;
  return { ...store, assign };
}

/** Estantería de un PDF, o `null` si está suelto o su estantería ya no existe. */
export function shelfOf(store: LibraryStore, relative: string): string | null {
  const shelf = store.assign[relative];
  return shelf !== undefined && store.shelves.includes(shelf) ? shelf : null;
}

export function filterPdfs(
  pdfs: readonly VaultPdf[],
  store: LibraryStore,
  filter: ShelfFilter,
): VaultPdf[] {
  if (filter.kind === "all") return [...pdfs];
  return pdfs.filter((pdf) => {
    const shelf = shelfOf(store, pdf.relative);
    return filter.kind === "none" ? shelf === null : shelf === filter.name;
  });
}
