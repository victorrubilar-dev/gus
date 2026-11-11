// La extensión .ts es necesaria en los smoke tests con Node (sin el resolutor de Vite).
import { baseName, isInsidePath } from "./fileName.ts";
import {
  normalizeWikiText,
  stripMdExtension,
  wikiInsertText,
  wikiNoteBaseTitle,
  wikiNoteTitle,
  type WikiNote,
} from "./wikiLink.ts";

/** Una nota o carpeta que pasó de `from` a `to` (rutas absolutas). */
export interface PathMove {
  from: string;
  to: string;
}

/** Nota del grafo (ya con las rutas nuevas) con los destinos de sus enlaces. */
export interface LinkingNote extends WikiNote {
  links: readonly { target: string }[];
}

/** Nota que hay que reescribir: destino normalizado viejo → destino nuevo. */
export interface LinkRewrite {
  path: string;
  targets: Map<string, string>;
}

/** Clave con la que se compara un destino `[[wiki]]`. */
function targetKey(target: string): string {
  return normalizeWikiText(stripMdExtension(target));
}

/** Igual que `findWikiNote`, pero con índices para no recorrer el vault en cada enlace. */
function wikiResolver(notes: readonly WikiNote[]): (target: string) => WikiNote | null {
  const byTitle = new Map<string, WikiNote>();
  const byBase = new Map<string, WikiNote>();
  for (const note of notes) {
    const title = normalizeWikiText(wikiNoteTitle(note));
    const base = normalizeWikiText(wikiNoteBaseTitle(note));
    if (!byTitle.has(title)) byTitle.set(title, note);
    if (!byBase.has(base)) byBase.set(base, note);
  }
  return (target) => {
    const wanted = targetKey(target);
    return wanted ? byTitle.get(wanted) ?? byBase.get(wanted) ?? null : null;
  };
}

/** Ruta que tenía antes de los movimientos lo que ahora vive en `path`. */
function pathBefore(path: string, moves: readonly PathMove[]): string {
  for (const { from, to } of moves) {
    if (isInsidePath(path, to)) return from + path.slice(to.length);
  }
  return path;
}

function relativeTo(vaultPath: string, path: string): string {
  return path.slice(vaultPath.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
}

/**
 * Qué enlaces hay que reescribir tras renombrar o mover notas o carpetas.
 * `notes` es el grafo leído DESPUÉS del movimiento; el estado anterior se
 * reconstruye deshaciendo `moves`. Un enlace se reescribe solo si antes
 * apuntaba a una nota y ahora ya no apunta a esa misma nota.
 */
export function planLinkRewrites(
  notes: readonly LinkingNote[],
  vaultPath: string,
  moves: readonly PathMove[],
): LinkRewrite[] {
  const after = notes;
  const before = notes.map((note) => {
    const path = pathBefore(note.path, moves);
    return { ...note, path, name: baseName(path), relative: relativeTo(vaultPath, path) };
  });
  const afterByBeforePath = new Map(before.map((note, index) => [note.path, after[index]]));
  const resolveBefore = wikiResolver(before);
  const resolveAfter = wikiResolver(after);

  const out: LinkRewrite[] = [];
  for (const note of after) {
    const targets = new Map<string, string>();
    for (const { target } of note.links) {
      const was = resolveBefore(target);
      if (!was) continue;
      const moved = afterByBeforePath.get(was.path);
      if (!moved || resolveAfter(target)?.path === moved.path) continue;
      targets.set(targetKey(target), wikiInsertText(after, moved).slice(2, -2));
    }
    if (targets.size > 0) out.push({ path: note.path, targets });
  }
  return out;
}

const WIKI_LINK = /\[\[([^\[\]\n]+)\]\]/g;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Cambia el destino de los `[[enlaces]]` de `targets` (clave normalizada) y
 * conserva el alias. No toca bloques de código ni comillas invertidas, igual
 * que el grafo del backend (`extract_wiki_targets`).
 */
export function rewriteWikiLinks(text: string, targets: ReadonlyMap<string, string>): string {
  let fence: { char: string; length: number } | null = null;

  return text
    .split("\n")
    .map((line) => {
      const marker = FENCE.exec(line);
      if (fence) {
        if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) {
          fence = null;
        }
        return line;
      }
      if (marker && !marker[2].includes(marker[1][0])) {
        fence = { char: marker[1][0], length: marker[1].length };
        return line;
      }

      // Los trozos impares están entre comillas invertidas.
      return line
        .split("`")
        .map((part, index) =>
          index % 2 === 1
            ? part
            : part.replace(WIKI_LINK, (whole, inner: string) => {
                const pipe = inner.indexOf("|");
                const next = targets.get(targetKey(pipe === -1 ? inner : inner.slice(0, pipe)));
                return next === undefined ? whole : `[[${next}${pipe === -1 ? "" : inner.slice(pipe)}]]`;
              }),
        )
        .join("`");
    })
    .join("\n");
}
