/**
 * Renumeración automática de listas numeradas del cuerpo de la nota.
 *
 * Tras cada edición, la lista que contiene al cursor se renumera para que los
 * números vuelvan a ser consecutivos; el número del primer elemento se
 * conserva. Así, al borrar o insertar una línea, las que vienen detrás se
 * actualizan y no quedan huecos (6, 7, 8, **10**, 11) ni números duplicados.
 *
 * Reglas:
 *  - Una lista es una racha de elementos `N.` / `N)` con la misma sangría.
 *  - Las líneas en blanco la continúan, salvo que el número vuelva a empezar
 *    (menor o igual que el anterior): eso se toma como una lista nueva.
 *  - Un párrafo, un encabezado, una tabla o un bloque de código la cierran.
 *  - Lo anidado (elementos con más sangría) forma su propia lista.
 *  - Si el cursor está dentro del número de su propia línea, la lista no se
 *    toca: se está escribiendo el número a mano.
 */

export interface ListRenumberResult {
  body: string;
  /** Posición del cursor ya corregida si cambió la longitud de algún número. */
  caret: number;
}

/** Texto pegado, medido dentro del cuerpo resultante. */
export interface PasteRange {
  from: number;
  to: number;
}

/**
 * Arranque y tamaño de una lista numerada, capturados antes de un cambio que
 * solo reordena las líneas (Alt+↑/↓). Al devolvérselos a
 * `renumberOrderedLists`, la lista renumerada conserva su número inicial.
 */
export interface OrderedBlockRef {
  /** Número con el que arrancaba la lista. */
  anchor: number;
  /** Elementos que tenía la lista. */
  items: number;
}

interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  /** Longitud de «sangría + número + delimitador» dentro de la línea. */
  markerEnd: number;
}

interface OpenList {
  indent: number;
  items: number[];
  last: number;
  startLine: number;
  endLine: number;
}

interface ListBlock {
  items: number[];
  startLine: number;
  endLine: number;
}

const ORDERED_RE = /^([ \t]*)(\d+)([.)])(?:[ \t]|$)/;
const MARKER_RE = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|\[[ xX]\]|$)/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

function markerAt(line: string): Marker | null {
  const ordered = ORDERED_RE.exec(line);
  if (ordered) {
    return {
      indent: ordered[1].length,
      ordered: true,
      number: Number(ordered[2]),
      markerEnd: ordered[1].length + ordered[2].length + 1,
    };
  }

  const any = MARKER_RE.exec(line);
  if (!any) return null;
  return {
    indent: any[1].length,
    ordered: false,
    number: Number.NaN,
    markerEnd: any[0].length,
  };
}

/** Indentado a 4+ espacios solo es código si no venimos de una lista. */
function nestedContext(lines: string[], prevNonBlank: number, indent: number): boolean {
  if (prevNonBlank < 0) return false;
  const prev = markerAt(lines[prevNonBlank]);
  return prev !== null && prev.indent < indent;
}

function scanBlocks(lines: string[]): ListBlock[] {
  const blocks: ListBlock[] = [];
  const open: OpenList[] = [];
  let pendingBlank = false;
  let fenceChar: string | null = null;
  let prevNonBlank = -1;

  const closeTop = () => {
    const list = open.pop();
    if (list) {
      blocks.push({ items: list.items, startLine: list.startLine, endLine: list.endLine });
    }
  };
  const closeAll = () => {
    while (open.length > 0) closeTop();
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fence = FENCE_RE.exec(line);
    if (fence) {
      if (fenceChar === null) fenceChar = fence[1][0];
      else if (fence[1][0] === fenceChar) fenceChar = null;
      closeAll();
      pendingBlank = false;
      prevNonBlank = index;
      continue;
    }
    if (fenceChar !== null) {
      closeAll();
      pendingBlank = false;
      prevNonBlank = index;
      continue;
    }

    if (line.trim() === "") {
      pendingBlank = true;
      for (const list of open) list.endLine = index;
      continue;
    }

    const marker = markerAt(line);
    if (marker) {
      while (open.length > 0 && open[open.length - 1].indent > marker.indent) closeTop();

      const top = open[open.length - 1];
      const sameLevel = top !== undefined && top.indent === marker.indent;
      const allowed =
        sameLevel ||
        marker.indent < 4 ||
        nestedContext(lines, prevNonBlank, marker.indent);

      if (allowed) {
        if (sameLevel && !marker.ordered) {
          // Viñeta en el mismo nivel: cambia el tipo de lista.
          closeTop();
        } else if (
          sameLevel &&
          marker.ordered &&
          pendingBlank &&
          !(marker.number > top.last)
        ) {
          // Tras un blanco, un número menor o igual es una lista nueva.
          closeTop();
          open.push(newList(marker, index));
        } else if (sameLevel && marker.ordered) {
          top.items.push(index);
          top.last = marker.number;
          top.endLine = index;
        } else if (marker.ordered) {
          open.push(newList(marker, index));
        }
      } else {
        closeAll();
      }

      pendingBlank = false;
      prevNonBlank = index;
      continue;
    }

    closeAll();
    pendingBlank = false;
    prevNonBlank = index;
  }

  closeAll();
  return blocks;
}

function newList(marker: Marker, index: number): OpenList {
  return {
    indent: marker.indent,
    items: [index],
    last: marker.number,
    startLine: index,
    endLine: index,
  };
}

function lineAtOffset(body: string, offset: number): number {
  let line = 0;
  for (let index = 0; index < offset && index < body.length; index += 1) {
    if (body.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

interface Scanned {
  lines: string[];
  offsets: number[];
  blocks: ListBlock[];
}

function clampCaret(body: string, caret: number): number {
  return Math.min(Math.max(caret, 0), body.length);
}

function scan(body: string): Scanned | null {
  if (!/^[ \t]*\d+[.)]/m.test(body)) return null;
  const lines = body.split("\n");
  const blocks = scanBlocks(lines);
  if (blocks.length === 0) return null;
  return { lines, offsets: lineOffsets(lines), blocks };
}

function blockContaining(blocks: ListBlock[], line: number): ListBlock | undefined {
  return blocks.find((candidate) => line >= candidate.startLine && line <= candidate.endLine);
}

/** Número con el que arranca una lista: el de su primer elemento. */
function blockAnchor(scanned: Scanned, block: ListBlock): number {
  return markerAt(scanned.lines[block.items[0]])?.number ?? Number.NaN;
}

/** Escribe la lista con el arranque dado y devuelve el cursor recolocado. */
function renumberBlock(
  body: string,
  scanned: Scanned,
  block: ListBlock,
  anchor: number,
  caret: number,
): ListRenumberResult {
  const { lines, offsets } = scanned;
  let expected = anchor;
  let out = "";
  let from = 0;
  let delta = 0;

  for (const lineIndex of block.items) {
    const line = lines[lineIndex];
    const marker = markerAt(line);
    if (!marker || !marker.ordered || Number.isNaN(expected)) continue;

    if (marker.number !== expected) {
      const start = offsets[lineIndex];
      const delimiter = line[marker.markerEnd - 1];
      const indent = " ".repeat(marker.indent);
      const replacement = `${indent}${expected}${delimiter}${line.slice(marker.markerEnd)}`;

      out += body.slice(from, start) + replacement;
      from = start + line.length;
      if (start < caret) delta += replacement.length - line.length;
    }

    expected += 1;
  }

  if (out === "") return { body, caret };
  out += body.slice(from);
  return { body: out, caret: caret + delta };
}

/**
 * Arranque y tamaño de la lista numerada que contiene a `caret`, o `null` si
 * no hay (o si es una lista de viñetas, sin número). Se toma sobre el texto
 * *antes* de mover líneas para poder pasarlo después a
 * `renumberOrderedLists` y que el bloque conserve su número inicial aunque
 * cambie de orden.
 */
export function orderedBlockAt(body: string, caret: number): OrderedBlockRef | null {
  const safeCaret = clampCaret(body, caret);
  const scanned = scan(body);
  if (!scanned) return null;

  const block = blockContaining(scanned.blocks, lineAtOffset(body, safeCaret));
  if (!block) return null;

  const anchor = blockAnchor(scanned, block);
  return Number.isNaN(anchor) ? null : { anchor, items: block.items.length };
}

/**
 * Con `previous` (movimiento de líneas) se renumera aunque el cursor quede
 * dentro del número —no se está escribiendo nada a mano— y se recupera el
 * arranque que tenía el bloque antes de moverse, siempre y cuando siga siendo
 * el mismo bloque (mismo número de elementos). Si el movimiento lo ha partido
 * o lo ha fusionado con otro, manda el arranque del bloque nuevo.
 */
export function renumberOrderedLists(
  body: string,
  caret: number,
  previous?: OrderedBlockRef | null,
): ListRenumberResult {
  const safeCaret = clampCaret(body, caret);
  const scanned = scan(body);
  if (!scanned) return { body, caret: safeCaret };

  const caretLine = lineAtOffset(body, safeCaret);
  const block = blockContaining(scanned.blocks, caretLine);
  if (!block) return { body, caret: safeCaret };

  // Cursor dentro del número: se está escribiendo a mano, no se toca nada.
  if (!previous && block.items.includes(caretLine)) {
    const marker = markerAt(scanned.lines[caretLine]);
    const local = safeCaret - scanned.offsets[caretLine];
    if (marker && local > 0 && local <= marker.markerEnd) {
      return { body, caret: safeCaret };
    }
  }

  const kept = previous && previous.items === block.items.length ? previous.anchor : NaN;
  const anchor = Number.isNaN(kept) ? blockAnchor(scanned, block) : kept;

  return renumberBlock(body, scanned, block, anchor, safeCaret);
}

/**
 * Tras pegar, una línea como `7. texto` no conserva su número si abre una
 * lista nueva: empieza en 1. Si en cambio se pega justo delante de una lista
 * que ya existía, es esa lista la que mantiene su arranque.
 */
export function renumberAfterPaste(
  body: string,
  caret: number,
  paste: PasteRange,
): ListRenumberResult {
  const safeCaret = clampCaret(body, caret);
  const scanned = scan(body);
  if (!scanned) return { body, caret: safeCaret };

  const { lines, offsets } = scanned;
  // Primera línea que empieza dentro del texto pegado y es un elemento numerado.
  const pastedLine = offsets.findIndex(
    (offset, index) =>
      offset >= paste.from &&
      offset < paste.to &&
      markerAt(lines[index])?.ordered === true,
  );

  // Si lo pegado no es un elemento numerado, la lista a recalcular es la que
  // contiene al cursor, igual que en cualquier otra edición.
  if (pastedLine < 0) return renumberOrderedLists(body, safeCaret);

  const block = blockContaining(scanned.blocks, pastedLine);
  if (!block) return renumberOrderedLists(body, safeCaret);

  let anchor: number;
  if (block.items[0] !== pastedLine) {
    // Hay lista antes del pegado: ya existía y conserva su número de arranque.
    anchor = blockAnchor(scanned, block);
  } else {
    const firstExisting = block.items.find((index) => offsets[index] >= paste.to);
    // Nada pegado detrás: es una lista nueva y arranca en 1.
    anchor =
      firstExisting === undefined ? 1 : markerAt(lines[firstExisting])?.number ?? Number.NaN;
  }

  const renamed = renumberBlock(body, scanned, block, anchor, safeCaret);
  // El cursor pudo quedar en otra lista distinta: se recalcula también.
  return renumberOrderedLists(renamed.body, renamed.caret);
}

function lineOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  return offsets;
}
