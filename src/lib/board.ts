/**
 * Pizarra (REQ-03). Lógica pura del lienzo: modelo, geometría, selección,
 * historial y lectura segura del JSON. El dibujo y los gestos viven en
 * `components/BoardEditor.tsx`.
 */

export type BoxShape = "rect" | "ellipse" | "diamond";
export type Point = [number, number];

interface Colored {
  id: string;
  color: string;
}

export type BoardElement =
  | (Colored & { type: "pen"; width: number; points: Point[] })
  | (Colored & { type: BoxShape; x: number; y: number; w: number; h: number; fill: boolean })
  | (Colored & { type: "line" | "arrow"; x1: number; y1: number; x2: number; y2: number })
  | (Colored & { type: "text"; x: number; y: number; text: string; size: number })
  | (Colored & { type: "note"; x: number; y: number; w: number; h: number; text: string })
  /** `src` es la ruta de la imagen relativa al vault, para que la pizarra viaje con él. */
  | { type: "image"; id: string; x: number; y: number; w: number; h: number; src: string };

export interface Board {
  name: string;
  elements: BoardElement[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface View {
  x: number;
  y: number;
  scale: number;
}

export const MIN_BOX = 24;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;
export const TEXT_LINE_HEIGHT = 1.3;
const HISTORY_LIMIT = 100;

/** Trazos: el primero sigue el tema; el resto son colores fijos legibles en claro y oscuro. */
export const INK_COLORS = ["var(--color-gus-text)", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];
/** Papel de los post-it (el texto siempre va en oscuro). */
export const NOTE_COLORS = ["#fde68a", "#fbcfe8", "#bbf7d0", "#bfdbfe"];

/* ---------------------------- geometría ---------------------------- */

function textLines(text: string): string[] {
  return text.split("\n");
}

export function bounds(el: BoardElement): Rect {
  switch (el.type) {
    case "pen": {
      const xs = el.points.map((p) => p[0]);
      const ys = el.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "line":
    case "arrow":
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
    case "text": {
      const lines = textLines(el.text);
      const longest = Math.max(1, ...lines.map((line) => line.length));
      return { x: el.x, y: el.y, w: longest * el.size * 0.6, h: lines.length * el.size * TEXT_LINE_HEIGHT };
    }
    default:
      return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
}

/** Rectángulo normalizado entre dos esquinas, arrastres hacia cualquier lado. */
export function boxFrom(a: Point, b: Point): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

export function translate(el: BoardElement, dx: number, dy: number): BoardElement {
  switch (el.type) {
    case "pen":
      return { ...el, points: el.points.map(([x, y]) => [x + dx, y + dy] as Point) };
    case "line":
    case "arrow":
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    default:
      return { ...el, x: el.x + dx, y: el.y + dy };
  }
}

/** Esquina o extremo que se arrastra para cambiar el tamaño; `null` si el elemento no se redimensiona. */
export function handlePoint(el: BoardElement): Point | null {
  if (el.type === "pen") return null;
  if (el.type === "line" || el.type === "arrow") return [el.x2, el.y2];
  const box = bounds(el);
  return [box.x + box.w, box.y + box.h];
}

/** Lleva el tirador a `p`: cajas y notas cambian de tamaño, las líneas mueven su extremo, el texto su cuerpo. */
export function resizeTo(el: BoardElement, p: Point): BoardElement {
  switch (el.type) {
    case "pen":
      return el;
    case "line":
    case "arrow":
      return { ...el, x2: p[0], y2: p[1] };
    case "text": {
      const lines = textLines(el.text).length;
      const size = (p[1] - el.y) / (lines * TEXT_LINE_HEIGHT);
      return { ...el, size: Math.round(Math.min(120, Math.max(10, size))) };
    }
    default:
      return { ...el, w: Math.max(MIN_BOX, p[0] - el.x), h: Math.max(MIN_BOX, p[1] - el.y) };
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const inside = (r: Rect, p: Point, pad = 0) =>
  p[0] >= r.x - pad && p[0] <= r.x + r.w + pad && p[1] >= r.y - pad && p[1] <= r.y + r.h + pad;

/** ¿Está `p` sobre el elemento? `tolerance` es la holgura en unidades del lienzo. */
export function hits(el: BoardElement, p: Point, tolerance: number): boolean {
  switch (el.type) {
    case "pen":
      return el.points.some((point, i) =>
        distanceToSegment(p, el.points[i - 1] ?? point, point) <= tolerance + el.width / 2,
      );
    case "line":
    case "arrow":
      return distanceToSegment(p, [el.x1, el.y1], [el.x2, el.y2]) <= tolerance;
    case "ellipse": {
      const [rx, ry] = [el.w / 2 + tolerance, el.h / 2 + tolerance];
      return ((p[0] - el.x - el.w / 2) / rx) ** 2 + ((p[1] - el.y - el.h / 2) / ry) ** 2 <= 1;
    }
    case "diamond": {
      const [rx, ry] = [el.w / 2 + tolerance, el.h / 2 + tolerance];
      return Math.abs(p[0] - el.x - el.w / 2) / rx + Math.abs(p[1] - el.y - el.h / 2) / ry <= 1;
    }
    default:
      return inside(bounds(el), p, tolerance);
  }
}

/** El elemento más arriba (el último dibujado) bajo `p`, o `null`. */
export function topmostAt(elements: readonly BoardElement[], p: Point, tolerance: number): BoardElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hits(elements[i], p, tolerance)) return elements[i];
  }
  return null;
}

/* ------------------------------ vista ------------------------------ */

export function toWorld(view: View, screenX: number, screenY: number): Point {
  return [(screenX - view.x) / view.scale, (screenY - view.y) / view.scale];
}

/** Zoom que deja fijo el punto de pantalla bajo el cursor. */
export function zoomAt(view: View, factor: number, screenX: number, screenY: number): View {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  const ratio = scale / view.scale;
  return { scale, x: screenX - (screenX - view.x) * ratio, y: screenY - (screenY - view.y) * ratio };
}

/* ---------------------------- historial ---------------------------- */

export interface History {
  past: BoardElement[][];
  future: BoardElement[][];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** Registra un cambio ya hecho: `before` queda para deshacer y se borra lo rehacible. */
export function recordChange(history: History, before: BoardElement[]): History {
  return { past: [...history.past, before].slice(-HISTORY_LIMIT), future: [] };
}

export function undo(history: History, current: BoardElement[]): { history: History; elements: BoardElement[] } | null {
  const previous = history.past[history.past.length - 1];
  if (!previous) return null;
  return { elements: previous, history: { past: history.past.slice(0, -1), future: [...history.future, current] } };
}

export function redo(history: History, current: BoardElement[]): { history: History; elements: BoardElement[] } | null {
  const next = history.future[history.future.length - 1];
  if (!next) return null;
  return { elements: next, history: { past: [...history.past, current], future: history.future.slice(0, -1) } };
}

/* ------------------------- lectura segura -------------------------- */

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|var\(--color-gus-[a-z-]+\))$/;
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const str = (value: unknown): value is string => typeof value === "string";

function readElement(raw: unknown): BoardElement | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!str(o.id) || !str(o.type)) return null;
  const color = str(o.color) && COLOR_RE.test(o.color) ? o.color : INK_COLORS[0];

  switch (o.type) {
    case "pen":
      if (!Array.isArray(o.points) || o.points.length === 0 || !num(o.width)) return null;
      if (!o.points.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))) return null;
      return { type: "pen", id: o.id, color, width: o.width, points: o.points as Point[] };
    case "rect":
    case "ellipse":
    case "diamond":
      if (![o.x, o.y, o.w, o.h].every(num)) return null;
      return { type: o.type, id: o.id, color, x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number, fill: o.fill === true };
    case "line":
    case "arrow":
      if (![o.x1, o.y1, o.x2, o.y2].every(num)) return null;
      return { type: o.type, id: o.id, color, x1: o.x1 as number, y1: o.y1 as number, x2: o.x2 as number, y2: o.y2 as number };
    case "text":
      if (![o.x, o.y, o.size].every(num) || !str(o.text)) return null;
      return { type: "text", id: o.id, color, x: o.x as number, y: o.y as number, size: o.size as number, text: o.text };
    case "note":
      if (![o.x, o.y, o.w, o.h].every(num) || !str(o.text)) return null;
      return { type: "note", id: o.id, color, x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number, text: o.text };
    case "image":
      if (![o.x, o.y, o.w, o.h].every(num) || !str(o.src)) return null;
      return { type: "image", id: o.id, x: o.x as number, y: o.y as number, w: o.w as number, h: o.h as number, src: o.src };
    default:
      return null;
  }
}

/** Lee el JSON de una pizarra; lo que no se entiende se descarta en vez de romper la carga. */
export function parseBoard(json: string, fallbackName: string): Board {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { name: fallbackName, elements: [] };
  }
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const elements = Array.isArray(o.elements) ? o.elements.map(readElement).filter((el): el is BoardElement => el !== null) : [];
  return { name: str(o.name) && o.name.trim() ? o.name : fallbackName, elements };
}

export function serializeBoard(board: Board): string {
  return JSON.stringify({ version: 1, ...board });
}
