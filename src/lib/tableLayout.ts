/** Tablas Markdown: detección de bloques, celdas y navegación por celda. */

export interface TableLine {
  text: string;
  code: boolean;
}

export interface TableCellSpan {
  /** Contenido de la celda, recortado y con los «\|» escapados ya resueltos. */
  text: string;
  /** Inicio del contenido (sin espacios de relleno) dentro de la línea. */
  start: number;
  /** Fin del contenido dentro de la línea. */
  end: number;
}

export interface TableCellCaret {
  blockStart: number;
  blockEnd: number;
  /** Línea del documento (nunca el separador: se reubica al llegar). */
  line: number;
  /** 0 = cabecera · 1 = separador · 2+ = cuerpo. */
  row: number;
  col: number;
  cols: number;
  cellStart: number;
  cellEnd: number;
  selStart: number;
  selEnd: number;
  collapsed: boolean;
  onDelimiter: boolean;
}

export type SourceSegment =
  | { kind: "line"; index: number }
  | { kind: "table"; start: number; end: number };

/** Celdas de una línea con sus offsets de contenido dentro de esa línea. */
export function splitTableCells(text: string): TableCellSpan[] {
  const lead = /^\s*/.exec(text)?.[0].length ?? 0;
  const body = text.slice(lead).replace(/\s+$/, "");
  let base = lead;
  let inner = body;
  if (inner.startsWith("|")) {
    inner = inner.slice(1);
    base += 1;
  }
  let tail = inner.length;
  if (inner.endsWith("|")) tail -= 1;
  inner = inner.slice(0, tail);

  const spans: TableCellSpan[] = [];
  const parts = inner.split(/(?<!\\)\|/);
  let offset = base;
  for (const part of parts) {
    const trimmed = part.trim();
    const pad = part.length - part.replace(/^\s+/, "").length;
    const start = offset + pad;
    spans.push({
      text: trimmed.replace(/\\\|/g, "|"),
      start,
      end: start + trimmed.length,
    });
    offset += part.length + 1;
  }
  return spans;
}

export function isTableRow(text: string): boolean {
  return /^\s*\|/.test(text) && splitTableCells(text).length >= 2;
}

export function isTableDelimiter(text: string): boolean {
  if (!/^\s*\|/.test(text)) return false;
  const row = text.trim();
  return /^[\s|:-]+$/.test(row) && row.includes("-");
}

/** Ancho visual en caracteres monoespaciados (el tabulador ocupa hasta 8). */
export function visualLength(text: string): number {
  let width = 0;
  for (const char of text) width += char === "\t" ? 8 - (width % 8) : 1;
  return width;
}

export function lineStartOffset(lines: TableLine[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i += 1) offset += lines[i].text.length + 1;
  return offset;
}

export function delimiterAlign(cell: string): "left" | "center" | "right" {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/**
 * Agrupa las tablas en bloques para renderizarlas como en la vista previa.
 * Si alguna fila no cabe en una sola línea del textarea (se wrapearía y
 * rompería la alineación 1:1 del overlay) o aún no se midió el ancho, la
 * tabla se deja en líneas normales con su crudo de siempre.
 */
export function sourceSegments(
  lines: TableLine[],
  raw: boolean,
  cols: number | null,
): SourceSegment[] {
  if (raw || cols === null) {
    return lines.map((_, index) => ({ kind: "line" as const, index }));
  }

  const segments: SourceSegment[] = [];
  let i = 0;

  while (i < lines.length) {
    const tableStart =
      !lines[i].code &&
      isTableRow(lines[i].text) &&
      i + 2 < lines.length &&
      !lines[i + 1].code &&
      isTableDelimiter(lines[i + 1].text) &&
      !lines[i + 2].code &&
      isTableRow(lines[i + 2].text);

    if (!tableStart) {
      segments.push({ kind: "line", index: i });
      i += 1;
      continue;
    }

    let end = i + 2;
    while (end < lines.length && !lines[end].code && isTableRow(lines[end].text)) end += 1;
    end -= 1;

    const cellRows = lines.slice(i, end + 1).map((line) => splitTableCells(line.text));
    const colMax: number[] = [];
    for (const cells of cellRows) {
      cells.forEach((cell, c) => {
        const width = visualLength(cell.text);
        if (width > (colMax[c] ?? 0)) colMax[c] = width;
      });
    }
    const widest = cellRows.reduce((max, cells) => Math.max(max, cells.length), 1);
    const fits =
      colMax.reduce((sum, width) => sum + width, 0) + 2 * widest <= cols &&
      cellRows.every(
        (cells, k) => visualLength(lines[i + k].text) + 2 * cells.length <= cols,
      );

    if (fits) {
      segments.push({ kind: "table", start: i, end });
    } else {
      for (let k = i; k <= end; k += 1) segments.push({ kind: "line", index: k });
    }
    i = end + 1;
  }

  return segments;
}

function blockAt(lines: TableLine[], caretLine: number): { start: number; end: number } | null {
  const line = lines[caretLine];
  if (!line || line.code || !isTableRow(line.text)) return null;

  let start = caretLine;
  while (start > 0 && !lines[start - 1].code && isTableRow(lines[start - 1].text)) start -= 1;
  let end = caretLine;
  while (end + 1 < lines.length && !lines[end + 1].code && isTableRow(lines[end + 1].text)) {
    end += 1;
  }
  if (end - start < 2 || !isTableDelimiter(lines[start + 1].text)) return null;
  return { start, end };
}

/** Rango de contenido (absoluto) de una celda; null si no existe. */
export function tableCellRange(
  lines: TableLine[],
  line: number,
  col: number,
): { start: number; end: number } | null {
  const text = lines[line]?.text;
  if (text === undefined) return null;
  const span = splitTableCells(text)[col];
  if (!span) return null;
  const base = lineStartOffset(lines, line);
  return { start: base + span.start, end: base + span.end };
}

/** Resuelve en qué celda está la selección; null si el cursor está fuera. */
export function resolveTableCaret(
  lines: TableLine[],
  caretLine: number,
  selStart: number,
  selEnd: number,
): TableCellCaret | null {
  const line = lines[caretLine];
  if (!line || line.code || !isTableRow(line.text)) return null;

  const block = blockAt(lines, caretLine);
  if (!block) return null;

  const spans = splitTableCells(line.text);
  const lineStart = lineStartOffset(lines, caretLine);
  const local = selEnd - lineStart;

  let col = spans.length - 1;
  for (let i = 0; i < spans.length; i += 1) {
    if (local <= spans[i].end) {
      col = i;
      break;
    }
  }

  let cols = 0;
  for (let i = block.start; i <= block.end; i += 1) {
    cols = Math.max(cols, splitTableCells(lines[i].text).length);
  }

  const cellStart = lineStart + spans[col].start;
  const cellEnd = lineStart + spans[col].end;
  const cs = Math.min(Math.max(selStart, cellStart), cellEnd);
  const ce = Math.min(Math.max(selEnd, cellStart), cellEnd);

  return {
    blockStart: block.start,
    blockEnd: block.end,
    line: caretLine,
    row: caretLine - block.start,
    col,
    cols,
    cellStart,
    cellEnd,
    selStart: cs,
    selEnd: ce,
    collapsed: cs === ce,
    onDelimiter: caretLine === block.start + 1,
  };
}

/** Filas con celdas del bloque: cabecera + cuerpo (salta el separador). */
export function tableRows(cell: TableCellCaret): number[] {
  const rows = [cell.blockStart];
  for (let line = cell.blockStart + 2; line <= cell.blockEnd; line += 1) rows.push(line);
  return rows;
}

/** Celda contigua en orden de lectura (Tab / Shift+Tab); null en los bordes. */
export function adjacentTableCell(
  cell: TableCellCaret,
  delta: 1 | -1,
): { line: number; col: number } | null {
  const rows = tableRows(cell);
  const index = rows.indexOf(cell.line);
  if (index < 0) return null;
  const flat = index * cell.cols + cell.col + delta;
  const total = rows.length * cell.cols;
  if (flat < 0 || flat >= total) return null;
  return { line: rows[Math.floor(flat / cell.cols)], col: flat % cell.cols };
}
