import type { LinkGraph } from "./linkGraph";
import { graphFolder, graphTitle, resolveGraphNode } from "./linkGraph";

/** Nota del modelo de grafo: lo mínimo para dibujarla y colocarla. */
export interface GraphModelNode {
  /** Ruta absoluta de la nota: es su identificador. */
  id: string;
  label: string;
  folder: string;
  tags: string[];
  /** Número de conexiones (entrantes y salientes, contadas una vez). */
  degree: number;
}

/** Conexión entre dos notas, sin dirección: la pesa el nº de menciones. */
export interface GraphModelEdge {
  source: string;
  target: string;
  weight: number;
}

export interface GraphModel {
  nodes: GraphModelNode[];
  edges: GraphModelEdge[];
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Cuántas notas entran en el dibujo. Más allá de este tope solo se quedan las
 * más enlazadas: el cálculo de fuerzas es cuadrático y el dibujo, React.
 */
export const MAX_GRAPH_NODES = 300;

/**
 * Modelo dibujable a partir del grafo parseado: las notas se quedan aunque no
 * enlacen con nadie (son islas, y verlas es parte del mapa), los enlaces se
 * fusionan en las dos direcciones y se contienen las menciones repetidas.
 */
export function buildGraphModel(
  graph: LinkGraph | null,
  maxNodes = MAX_GRAPH_NODES,
): GraphModel {
  if (!graph || graph.nodes.length === 0) return { nodes: [], edges: [] };

  const weights = new Map<string, number>();
  const degree = new Map<string, number>();

  const bump = (id: string) => degree.set(id, (degree.get(id) ?? 0) + 1);

  for (const node of graph.nodes) {
    for (const link of node.links) {
      const resolved = resolveGraphNode(graph.nodes, link.target);
      if (!resolved || resolved.path === node.path) continue;

      // La misma conexión escrita en los dos sentidos es una sola arista.
      const [from, to] = [node.path, resolved.path].sort();
      const key = `${from}\u0000${to}`;
      if (!weights.has(key)) {
        bump(from);
        bump(to);
      }
      weights.set(key, (weights.get(key) ?? 0) + link.count);
    }
  }

  let kept = graph.nodes;
  if (kept.length > maxNodes) {
    kept = [...kept]
      .sort((a, b) => (degree.get(b.path) ?? 0) - (degree.get(a.path) ?? 0))
      .slice(0, maxNodes);
  }
  const visible = new Set(kept.map((node) => node.path));

  const edges: GraphModelEdge[] = [];
  for (const [key, weight] of weights) {
    const [source, target] = key.split("\u0000");
    if (!visible.has(source) || !visible.has(target)) continue;
    edges.push({ source, target, weight });
  }
  edges.sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source));

  const nodes: GraphModelNode[] = kept.map((node) => ({
    id: node.path,
    label: graphTitle(node),
    folder: graphFolder(node),
    tags: node.tags.map((tag) => tag.toLowerCase()),
    degree: degree.get(node.path) ?? 0,
  }));
  nodes.sort((a, b) => a.label.localeCompare(b.label));

  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Posiciones y simulación de fuerzas                                   */
/* ------------------------------------------------------------------ */

/** Generador pseudoaleatorio determinista (mulberry32). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Colocación inicial en espiral (ángulo áureo): los nodos quedan repartidos
 * sin solaparse y con la misma semilla siempre, para que el mapa no baile de
 * una apertura a otra.
 */
export function seedPositions(
  nodes: readonly GraphModelNode[],
  width: number,
  height: number,
  rng: () => number = Math.random,
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const cx = width / 2;
  const cy = height / 2;
  const spread = Math.max(60, Math.min(width, height) / 2.6);

  nodes.forEach((node, index) => {
    const angle = index * 2.39996322972865332;
    const radius = spread * Math.sqrt((index + 0.5) / Math.max(1, nodes.length));
    positions.set(node.id, {
      x: cx + Math.cos(angle) * radius + (rng() - 0.5) * 12,
      y: cy + Math.sin(angle) * radius + (rng() - 0.5) * 12,
    });
  });

  return positions;
}

export interface SimulationOptions {
  /** Fuerza con que se separan los nodos. */
  repulsion: number;
  /** Longitud de reposo de un enlace. */
  springLength: number;
  /** Fuerza con que un enlace acerca a sus dos nodos. */
  springPull: number;
  /** Fuerza con que todo vuelve al centro. */
  gravity: number;
  /** Amortiguación de la velocidad (por debajo de 1 frena). */
  damping: number;
}

export const DEFAULT_SIMULATION: SimulationOptions = {
  repulsion: 5200,
  springLength: 90,
  springPull: 0.045,
  gravity: 0.014,
  damping: 0.86,
};

/**
 * Un paso de la simulación: repulsión entre vecinos, tracción de los enlaces
 * y gravedad al centro. Devuelve el mayor desplazamiento, que es lo que
 * sirve para parar cuando el mapa se ha quieto.
 */
export function simulationStep(
  positions: Map<string, Point>,
  velocities: Map<string, Point>,
  edges: readonly GraphModelEdge[],
  center: Point,
  options: SimulationOptions = DEFAULT_SIMULATION,
): number {
  const items = [...positions.entries()];
  const push = (id: string, x: number, y: number) => {
    const velocity = velocities.get(id);
    if (!velocity) return;
    velocity.x += x;
    velocity.y += y;
  };

  // Repulsión entre pares cercanos (los lejanos no se mueven entre sí).
  const cutoff = options.springLength * 2.4;
  const cutoffSq = cutoff * cutoff;
  for (let i = 0; i < items.length; i += 1) {
    const [idA, pointA] = items[i];
    for (let j = i + 1; j < items.length; j += 1) {
      const [idB, pointB] = items[j];
      const dx = pointA.x - pointB.x;
      const dy = pointA.y - pointB.y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq > cutoffSq || distanceSq === 0) continue;

      const distance = Math.sqrt(distanceSq);
      const force = options.repulsion / Math.max(distanceSq, 64);
      const nx = (dx / distance) * force;
      const ny = (dy / distance) * force;
      push(idA, nx, ny);
      push(idB, -nx, -ny);
    }
  }

  // Tracción de los enlaces hacia su longitud de reposo.
  for (const edge of edges) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 0.001;
    const pull = ((distance - options.springLength) / distance) * options.springPull;

    push(edge.source, dx * pull, dy * pull);
    push(edge.target, -dx * pull, -dy * pull);
  }

  // Gravedad y amortiguación, con el desplazamiento como medida de quietud.
  let movement = 0;
  for (const [id, point] of items) {
    const velocity = velocities.get(id);
    if (!velocity) continue;

    velocity.x += (center.x - point.x) * options.gravity;
    velocity.y += (center.y - point.y) * options.gravity;
    velocity.x *= options.damping;
    velocity.y *= options.damping;

    point.x += velocity.x;
    point.y += velocity.y;
    movement = Math.max(movement, Math.abs(velocity.x) + Math.abs(velocity.y));
  }

  return movement;
}

/** Velocidades a cero, para empezar una simulación desde el reposo. */
export function zeroVelocities(positions: Map<string, Point>): Map<string, Point> {
  const velocities = new Map<string, Point>();
  for (const [id] of positions) velocities.set(id, { x: 0, y: 0 });
  return velocities;
}

/* ------------------------------------------------------------------ */
/* Encuadre (zoom y pan)                                                */
/* ------------------------------------------------------------------ */

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom manteniendo quieto el punto del lienzo bajo el cursor: el nodo que se
 * mira no se va de encuadre al girar la rueda.
 */
export function zoomAt(
  view: { scale: number; x: number; y: number },
  factor: number,
  originX: number,
  originY: number,
): { scale: number; x: number; y: number } {
  const scale = clampScale(view.scale * factor);
  const applied = scale / view.scale;

  return {
    scale,
    x: originX - (originX - view.x) * applied,
    y: originY - (originY - view.y) * applied,
  };
}

/** Encuadre que deja todo el modelo a la vista, con un margen alrededor. */
export function fitView(
  positions: Map<string, Point>,
  width: number,
  height: number,
  padding = 48,
): { scale: number; x: number; y: number } {
  const points = [...positions.values()];
  if (points.length === 0 || width <= 0 || height <= 0) return { scale: 1, x: 0, y: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = clampScale(
    Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY),
  );

  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  };
}

/** Coordenada del modelo correspondiente a un punto del lienzo. */
export function toGraphPoint(
  view: { scale: number; x: number; y: number },
  clientX: number,
  clientY: number,
): Point {
  return {
    x: (clientX - view.x) / view.scale,
    y: (clientY - view.y) / view.scale,
  };
}

/** Carpetas del vault con notas, ordenadas (la raíz no aparece). */
export function graphFolders(graph: LinkGraph | null): string[] {
  if (!graph) return [];
  const folders = new Set<string>();
  for (const node of graph.nodes) {
    const folder = graphFolder(node);
    if (folder) folders.add(folder);
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
}

/** Etiquetas del vault, en minúsculas y sin repetir. */
export function graphTags(graph: LinkGraph | null): string[] {
  if (!graph) return [];
  const tags = new Set<string>();
  for (const node of graph.nodes) {
    for (const tag of node.tags) tags.add(tag.toLowerCase());
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Subgrafo que cumple los filtros: por carpeta (igual o por debajo) y por
 * etiqueta. Los enlaces que cruzan fuera del filtro se descartan.
 */
export function filterGraph(
  graph: LinkGraph | null,
  folder: string,
  tag: string,
): LinkGraph | null {
  if (!graph) return null;
  if (!folder && !tag) return graph;

  const prefix = folder ? `${folder}/` : null;
  const nodes = graph.nodes.filter((node) => {
    const nodeFolder = graphFolder(node);
    const inFolder = !prefix || nodeFolder === folder || nodeFolder.startsWith(prefix);
    const inTag = !tag || node.tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
    return inFolder && inTag;
  });

  return { nodes, generatedMs: graph.generatedMs };
}

/** Vecindad de un nodo: sus conexiones directas, para resaltarlas. */
export function neighborhood(model: GraphModel, id: string | null): {
  nodes: Set<string>;
  edges: Set<string>;
} {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (!id) return { nodes, edges };

  nodes.add(id);
  for (const edge of model.edges) {
    if (edge.source !== id && edge.target !== id) continue;
    edges.add(`${edge.source}\u0000${edge.target}`);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }

  return { nodes, edges };
}

/** Clave estable de una arista, para compararla con `neighborhood`. */
export function edgeKey(edge: GraphModelEdge): string {
  return `${edge.source}\u0000${edge.target}`;
}
