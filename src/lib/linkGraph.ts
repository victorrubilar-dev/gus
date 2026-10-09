import { normalizeWikiText, stripMdExtension } from "./wikiLink";

/**
 * Grafo de enlaces del vault, tal y como lo devuelve el backend (`build_link_graph`).
 * Cada nota trae sus etiquetas y sus enlaces `[[wiki]]` salientes, contados.
 */
export interface NoteLink {
  target: string;
  count: number;
}

export interface LinkNode {
  name: string;
  path: string;
  relative: string;
  modifiedMs?: number | null;
  tags: string[];
  links: NoteLink[];
}

export interface LinkGraph {
  nodes: LinkNode[];
  generatedMs: number;
}

/** Nota del grafo con la que se cuenta una mención. */
export interface BacklinkEntry {
  node: LinkNode;
  count: number;
}

/** Enlace saliente de una nota, resuelto cuando apunta a algo existente. */
export interface OutgoingEntry {
  target: string;
  count: number;
  resolved: LinkNode | null;
}

/** Carpeta de una nota («raíz» si vive en la raíz del vault). */
export function graphFolder(node: LinkNode): string {
  const slash = node.relative.lastIndexOf("/");
  return slash === -1 ? "" : node.relative.slice(0, slash);
}

/** Título visible de una nota del grafo, sin la extensión. */
export function graphTitle(node: LinkNode): string {
  return stripMdExtension(node.relative);
}

/** Normaliza un destino `[[wiki]]` para compararlo con las notas. */
function normalizeTarget(target: string): string {
  // El alias («[[destino|así se ve]]») no forma parte del destino.
  const pipe = target.indexOf("|");
  const clean = pipe === -1 ? target : target.slice(0, pipe);
  return normalizeWikiText(stripMdExtension(clean));
}

/**
 * Resuelve un destino `[[wiki]]` a la nota del grafo. Es la misma resolución
 * que al pulsar un enlace: primero el título completo (con su carpeta) y, si
 * no, el nombre base aunque haya varios con el mismo nombre.
 */
export function resolveGraphNode(
  nodes: readonly LinkNode[],
  target: string,
): LinkNode | null {
  const wanted = normalizeTarget(target);
  if (!wanted) return null;

  let byName: LinkNode | null = null;
  for (const node of nodes) {
    if (normalizeTarget(node.relative) === wanted) return node;
    if (byName === null && normalizeTarget(node.name) === wanted) byName = node;
  }

  return byName;
}

/** Notas que enlazan a `path`, con el número de menciones (entrantes). */
export function backlinksTo(graph: LinkGraph | null, path: string): BacklinkEntry[] {
  if (!graph) return [];

  const entries: BacklinkEntry[] = [];
  for (const node of graph.nodes) {
    if (node.path === path) continue;

    const count = node.links.reduce((total, link) => {
      const resolved = resolveGraphNode(graph.nodes, link.target);
      return resolved?.path === path ? total + link.count : total;
    }, 0);

    if (count > 0) entries.push({ node, count });
  }

  return entries.sort(
    (a, b) => b.count - a.count || a.node.relative.localeCompare(b.node.relative),
  );
}

/** Enlaces salientes de una nota, resueltos cuando apuntan a una nota real. */
export function outgoingFrom(graph: LinkGraph | null, path: string): OutgoingEntry[] {
  if (!graph) return [];

  const node = graph.nodes.find((entry) => entry.path === path);
  if (!node) return [];

  return node.links.map((link) => ({
    target: link.target,
    count: link.count,
    resolved: resolveGraphNode(graph.nodes, link.target),
  }));
}

/**
 * «Ruta de nota → cuántas veces se la enlaza». Es lo que pinta el contador de
 * cada enlace `[[wiki]]` en la vista previa del editor.
 */
export function incomingCountMap(graph: LinkGraph | null): Record<string, number> {
  if (!graph) return {};

  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    for (const link of node.links) {
      const resolved = resolveGraphNode(graph.nodes, link.target);
      if (!resolved) continue;
      counts[resolved.path] = (counts[resolved.path] ?? 0) + link.count;
    }
  }

  return counts;
}
