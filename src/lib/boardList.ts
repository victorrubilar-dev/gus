/** Lista de pizarras: búsqueda por nombre y orden, con las fijadas siempre arriba. */

export type BoardSort = "recent" | "oldest" | "name" | "nameDesc";

export const BOARD_SORTS: BoardSort[] = ["recent", "oldest", "name", "nameDesc"];

export interface Listable {
  name: string;
  modifiedMs: number | null;
  pinned?: boolean;
}

/** Minúsculas y sin acentos: «Ideas» se encuentra buscando «idéas». */
export function normalizeSearch(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function isBoardSort(value: unknown): value is BoardSort {
  return typeof value === "string" && (BOARD_SORTS as string[]).includes(value);
}

/** Filtra por nombre y ordena; las fijadas van primero y entre sí siguen el mismo orden. */
export function listBoards<T extends Listable>(boards: readonly T[], query: string, sort: BoardSort): T[] {
  const wanted = normalizeSearch(query);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const time = (board: T) => board.modifiedMs ?? 0;

  const compare = (a: T, b: T): number => {
    switch (sort) {
      case "oldest":
        return time(a) - time(b) || byName(a, b);
      case "name":
        return byName(a, b);
      case "nameDesc":
        return byName(b, a);
      default:
        return time(b) - time(a) || byName(a, b);
    }
  };

  return boards
    .filter((board) => wanted === "" || normalizeSearch(board.name).includes(wanted))
    .sort((a, b) => Number(b.pinned === true) - Number(a.pinned === true) || compare(a, b));
}
