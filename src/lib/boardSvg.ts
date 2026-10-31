/**
 * Pizarra → SVG autónomo (sin CSS ni variables de la página). Sirve para las
 * miniaturas de la lista y para exportar la pizarra a SVG o PNG. Todo texto y
 * valor que viene de la pizarra se escapa o se valida: el resultado se puede
 * guardar o cargar en un `<img>` sin riesgo.
 */
import { INK_COLORS, TEXT_LINE_HEIGHT, bounds, type BoardElement, type Rect } from "./board";

/** Texto de los post-it: siempre oscuro, el papel es claro. */
const NOTE_TEXT = "#1f2937";
const NOTE_FONT = 14;
const NOTE_LINE = 20;
const NOTE_PAD = 10;
/** Ancho medio de un carácter del post-it, para partir las líneas sin medir con el navegador. */
const NOTE_CHAR = NOTE_FONT * 0.54;
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export interface BoardSvgPalette {
  /** Color de lo que sigue al tema (tinta por defecto). */
  text: string;
  /** Color del hueco de una imagen que no se ha cargado. */
  muted: string;
}

export interface BoardSvgOptions {
  palette: BoardSvgPalette;
  /** Imágenes ya leídas (ruta del vault → `data:`). Sin ellas se dibuja un hueco. */
  images?: Record<string, string>;
  /** Fondo del lienzo; `null` lo deja transparente. */
  background?: string | null;
  /** Margen alrededor del contenido. */
  padding?: number;
}

export interface BoardSvg {
  svg: string;
  /** Tamaño natural del dibujo, en píxeles. */
  width: number;
  height: number;
}

const COLOR_OK = /^(#[0-9a-fA-F]{3,8}|var\(--color-gus-[a-z-]+\))$/;

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Número seguro para un atributo: finito y con pocos decimales. */
const n = (value: number) => (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0");

function color(raw: string, palette: BoardSvgPalette): string {
  if (!COLOR_OK.test(raw)) return palette.text;
  if (raw === INK_COLORS[0] || raw === "var(--color-gus-text)") return palette.text;
  if (raw === "var(--color-gus-muted)") return palette.muted;
  return raw.startsWith("var(") ? palette.text : raw;
}

/** Parte un texto en líneas que caben en `width` píxeles, respetando los saltos propios. */
export function wrapNote(text: string, width: number): string[] {
  const perLine = Math.max(1, Math.floor(width / NOTE_CHAR));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (rest.length > perLine) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= perLine) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

function arrowHead(el: { x1: number; y1: number; x2: number; y2: number }): string {
  const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
  const size = 14;
  const wing = (delta: number) => `${n(el.x2 - size * Math.cos(angle + delta))},${n(el.y2 - size * Math.sin(angle + delta))}`;
  return `${n(el.x2)},${n(el.y2)} ${wing(0.45)} ${wing(-0.45)}`;
}

function shape(el: BoardElement, options: BoardSvgOptions): string {
  const { palette, images } = options;
  const stroke = el.type === "image" ? palette.muted : color(el.color, palette);
  const line = `stroke="${stroke}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const fill = (el.type === "rect" || el.type === "ellipse" || el.type === "diamond") && el.fill ? `fill="${stroke}" fill-opacity="0.18"` : 'fill="none"';

  switch (el.type) {
    case "pen": {
      const d = `M ${el.points.map(([x, y]) => `${n(x)} ${n(y)}`).join(" L ")}${el.points.length === 1 ? " l 0.01 0" : ""}`;
      return `<path d="${d}" stroke="${stroke}" stroke-width="${n(el.width)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    case "rect":
      return `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="6" ${line.replace('fill="none"', "")} ${fill}/>`;
    case "ellipse":
      return `<ellipse cx="${n(el.x + el.w / 2)}" cy="${n(el.y + el.h / 2)}" rx="${n(el.w / 2)}" ry="${n(el.h / 2)}" ${line.replace('fill="none"', "")} ${fill}/>`;
    case "diamond":
      return `<polygon points="${n(el.x + el.w / 2)},${n(el.y)} ${n(el.x + el.w)},${n(el.y + el.h / 2)} ${n(el.x + el.w / 2)},${n(el.y + el.h)} ${n(el.x)},${n(el.y + el.h / 2)}" ${line.replace('fill="none"', "")} ${fill}/>`;
    case "line":
      return `<line x1="${n(el.x1)}" y1="${n(el.y1)}" x2="${n(el.x2)}" y2="${n(el.y2)}" ${line}/>`;
    case "arrow":
      return `<g><line x1="${n(el.x1)}" y1="${n(el.y1)}" x2="${n(el.x2)}" y2="${n(el.y2)}" ${line}/><polygon points="${arrowHead(el)}" fill="${stroke}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"/></g>`;
    case "text": {
      const rows = el.text.split("\n");
      const spans = rows
        .map((row, i) => `<tspan x="${n(el.x)}" y="${n(el.y + el.size * (0.95 + i * TEXT_LINE_HEIGHT))}">${esc(row) || " "}</tspan>`)
        .join("");
      return `<text x="${n(el.x)}" y="${n(el.y)}" font-size="${n(el.size)}" font-family="${FONT}" fill="${stroke}" xml:space="preserve">${spans}</text>`;
    }
    case "note": {
      const room = Math.max(0, Math.floor((el.h - NOTE_PAD * 2) / NOTE_LINE));
      const lines = wrapNote(el.text, el.w - NOTE_PAD * 2).slice(0, room);
      const spans = lines
        .map((row, i) => `<tspan x="${n(el.x + NOTE_PAD)}" y="${n(el.y + NOTE_PAD + NOTE_FONT + i * NOTE_LINE - 3)}">${esc(row) || " "}</tspan>`)
        .join("");
      return `<g><rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="4" fill="${color(el.color, palette)}"/><text font-size="${NOTE_FONT}" font-family="${FONT}" fill="${NOTE_TEXT}" xml:space="preserve">${spans}</text></g>`;
    }
    case "image": {
      const href = images?.[el.src];
      if (href && href.startsWith("data:image/")) {
        return `<image href="${esc(href)}" x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" preserveAspectRatio="none"/>`;
      }
      return `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="4" fill="${palette.muted}" fill-opacity="0.18" stroke="${palette.muted}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
    }
  }
}

/** Caja que ocupa todo el contenido, o `null` si no hay nada que dibujar. */
export function contentBounds(elements: readonly BoardElement[]): Rect | null {
  if (elements.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const box = bounds(el);
    // Un trazo tiene grosor: el borde del dibujo queda medio grosor más allá.
    const grow = el.type === "pen" ? el.width / 2 : 1;
    left = Math.min(left, box.x - grow);
    top = Math.min(top, box.y - grow);
    right = Math.max(right, box.x + box.w + grow);
    bottom = Math.max(bottom, box.y + box.h + grow);
  }
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

/** SVG con todo el contenido de la pizarra, o `null` si está vacía. */
export function renderBoardSvg(elements: readonly BoardElement[], options: BoardSvgOptions): BoardSvg | null {
  const box = contentBounds(elements);
  if (!box) return null;

  const pad = options.padding ?? 24;
  const width = Math.ceil(box.w + pad * 2);
  const height = Math.ceil(box.h + pad * 2);
  const x = box.x - pad;
  const y = box.y - pad;
  const background = options.background ? `<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" fill="${esc(options.background)}"/>` : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(x)} ${n(y)} ${width} ${height}">` +
    background +
    elements.map((el) => shape(el, options)).join("") +
    "</svg>";
  return { svg, width, height };
}
