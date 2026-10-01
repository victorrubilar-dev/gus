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

/** Celda por línea y columna: punto de una selección de celdas. */
export interface TableCellRef {
  line: number;
  col: number;
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

/** ¿En `index` empieza un bloque de tabla (fila + separador + fila)? */
function isTableStart(lines: TableLine[], index: number): boolean {
  return (
    !lines[index].code &&
    isTableRow(lines[index].text) &&
    index + 2 < lines.length &&
    !lines[index + 1].code &&
    isTableDelimiter(lines[index + 1].text) &&
    !lines[index + 2].code &&
    isTableRow(lines[index + 2].text)
  );
}

/**
 * Caracteres que ocupa como poco una columna: su ancho mínimo (24 px, unas tres
 * letras con la fuente del editor) más el relleno de la celda. Debe ir en
 * consonancia con `MIN_COL_WIDTH` del editor: es lo que decide si una tabla con
 * muchas columnas todavía se puede dibujar en la ventana.
 */
const MIN_TABLE_COL_CHARS = 6;

/**
 * Agrupa las tablas en bloques para renderizarlas como en la vista previa.
 * Una tabla se dibuja siempre que su rejilla quepa en una línea del textarea (el
 * texto que no cabe se envuelve dentro de su celda); si son demasiadas columnas
 * para el ancho de la ventana, se deja en líneas normales con su crudo de
 * siempre, porque el overlay tiene que seguir encajando línea a línea.
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
    if (!isTableStart(lines, i)) {
      segments.push({ kind: "line", index: i });
      i += 1;
      continue;
    }

    let end = i + 2;
    while (end < lines.length && !lines[end].code && isTableRow(lines[end].text)) end += 1;
    end -= 1;

    const cellRows = lines.slice(i, end + 1).map((line) => splitTableCells(line.text));
    const widest = cellRows.reduce((max, cells) => Math.max(max, cells.length), 1);
    // La tabla se dibuja siempre que su esqueleto quepa en la línea. El texto
    // largo ya no la invalida: cada celda tiene su columna, el texto se envuelve
    // dentro (como en Excel) y la fila crece, alto que MarkdownEditor mide y
    // compensa. Antes se exigía que el crudo entero cabiera en una sola línea, y
    // al escribir mucho la tabla desaparecía de golpe y se veía el markdown en
    // crudo, que es lo que pasaba al teclear. Solo si ni el esqueleto cabe
    // (demasiadas columnas para el ancho de la ventana) se deja el crudo.
    const fits = MIN_TABLE_COL_CHARS * widest <= cols;

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
  // La celda que manda es la del inicio de la selección (el ancla): con una
  // selección que abarca varias filas, `selEnd` caería en otra línea y la
  // columna resultante sería la última de esta.
  const local = selStart - lineStart;

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
  lines?: TableLine[],
): { line: number; col: number } | null {
  const rows = tableRows(cell);
  const index = rows.indexOf(cell.line);
  if (index < 0) return null;
  const total = rows.length * cell.cols;
  let flat = index * cell.cols + cell.col + delta;
  while (flat >= 0 && flat < total) {
    const curLine = rows[Math.floor(flat / cell.cols)];
    const curCol = flat % cell.cols;
    if (lines) {
      const text = splitTableCells(lines[curLine]?.text ?? "")[curCol]?.text ?? "";
      if (isMergeMarker(text)) {
        flat += delta;
        continue;
      }
    }
    return { line: curLine, col: curCol };
  }
  return null;
}

/**
 * Columna a la que salta ←/→ al llegar al borde del texto de una celda, o null
 * si no hay celda contigua (última columna de la fila, o una fila descuadrada con
 * menos celdas de las que se esperan).
 */
export function neighbourColumn(
  lines: TableLine[],
  line: number,
  col: number,
  direction: 1 | -1,
): number | null {
  const count = splitTableCells(lines[line]?.text ?? "").length;
  let wanted = col + direction;
  while (wanted >= 0 && wanted < count) {
    const text = splitTableCells(lines[line]?.text ?? "")[wanted]?.text ?? "";
    if (isMergeMarker(text)) {
      wanted += direction;
      continue;
    }
    return wanted;
  }
  return null;
}

/**
 * Si una celda cuyo texto ocupa `rows` renglones visuales, con el cursor en el
 * renglón `row`, debe saltar a la fila contigua con ↑/↓. Solo desde el primer o
 * el último renglón: en medio manda el motor, que recorre el texto de la celda
 * línea a línea (si no, no se podría editar una celda larga con las flechas).
 */
export function rowJumpAllowed(row: number, rows: number, direction: 1 | -1): boolean {
  return direction === 1 ? row >= Math.max(0, rows - 1) : row <= 0;
}

/* ────────────────────────────────────────────────────────────────────────────
   Acciones que usa el menú y el teclado: alinear, ordenar, mover, duplicar,
   marcar tarea y construir tablas nuevas.
   ──────────────────────────────────────────────────────────────────────────── */

/** Alineación de una columna: markdown la guarda en la fila del separador. */
export type TableAlign = "left" | "center" | "right";

const ALIGN_MARKS: Record<TableAlign, string> = {
  left: ":---",
  center: ":---:",
  right: "---:",
};

export function alignTableColumn(
  lines: TableLine[],
  block: TableBlock,
  col: number,
  align: TableAlign,
): TableEdit | null {
  const delimiter = lines[block.start + 1]?.text;
  if (delimiter === undefined) return null;
  const span = splitTableCells(delimiter)[col];
  if (!span) return null;

  const next = lines.map((entry) => entry.text);
  next[block.start + 1] =
    delimiter.slice(0, span.start) + ALIGN_MARKS[align] + delimiter.slice(span.end);
  return { lines: next, keepCaret: true };
}

/** Número de la celda, para ordenar como número (acepta coma decimal). */
function cellNumber(text: string): number | null {
  const value = Number(text.replace(/\s/g, "").replace(",", "."));
  return text !== "" && Number.isFinite(value) ? value : null;
}

/** Ordena las filas del cuerpo por la columna `col` (números si se puede). */
export function sortTableRows(
  lines: TableLine[],
  block: TableBlock,
  col: number,
  desc: boolean,
): TableEdit | null {
  const body: number[] = [];
  for (let line = block.start + 2; line <= block.end; line += 1) body.push(line);
  if (body.length < 2) return null;

  const rows = body.map((line) => ({
    line,
    text: splitTableCells(lines[line].text)[col]?.text ?? "",
  }));
  const asNumber = rows.every((row) => cellNumber(row.text) !== null);
  rows.sort((a, b) => {
    const cmp = asNumber
      ? cellNumber(a.text)! - cellNumber(b.text)!
      : a.text.localeCompare(b.text, "es", { numeric: true });
    // A igualdad se respeta el orden previo: así «ordenar» no barre de sitio
    // dos celdas con el mismo valor.
    return (desc ? -cmp : cmp) || a.line - b.line;
  });

  const next = lines.map((entry) => entry.text);
  rows.forEach((row, index) => {
    next[body[index]] = lines[row.line].text;
  });
  return { lines: next, keepCaret: true };
}

/** Mueve la fila `line` una posición dentro del cuerpo (sin salir del bloque). */
export function moveTableRow(
  lines: TableLine[],
  line: number,
  col: number,
  direction: 1 | -1,
): TableEdit | null {
  const block = blockAt(lines, line);
  if (!block || line < block.start + 2) return null;
  const target = line + direction;
  if (target < block.start + 2 || target > block.end) return null;

  const next = lines.map((entry) => entry.text);
  const moved = next[line];
  next[line] = next[target];
  next[target] = moved;
  return { lines: next, caret: { line: target, col } };
}

/** Copia la fila `line` justo encima (direction -1) o debajo (+1). */
export function duplicateTableRow(
  lines: TableLine[],
  line: number,
  col: number,
  direction: 1 | -1,
): TableEdit | null {
  const block = blockAt(lines, line);
  if (!block || line < block.start + 2) return null;
  const at = Math.min(Math.max(line + direction, block.start + 2), block.end + 1);

  const next = lines.map((entry) => entry.text);
  next.splice(at, 0, lines[line].text);
  return { lines: next, caret: { line: at, col } };
}

/** Marca o desmarca la casilla de una celda de tipo tarea («- [ ]»). */
export function toggleTableTask(
  lines: TableLine[],
  line: number,
  col: number,
): TableEdit | null {
  const text = lines[line]?.text;
  if (text === undefined) return null;
  const span = splitTableCells(text)[col];
  if (!span) return null;
  const task = /^- \[( |x|X)\]/.exec(span.text);
  if (!task) return null;

  const mark = task[1] === " " ? "x" : " ";
  const next = lines.map((entry) => entry.text);
  const before = text.slice(0, span.start);
  const after = text.slice(span.start);
  next[line] = `${before}- [${mark}]${after.slice(task[0].length)}`;
  return { lines: next, caret: { line, col } };
}

/** ¿La celda es una casilla de tarea? (para pintarla como lista de tareas) */
export function isTableTaskCell(text: string): boolean {
  return /^- \[( |x|X)\]/.test(text.trimStart());
}

/**
 * Palabra (o racha de espacios) alrededor de `index`, como la que marca un doble
 * clic en cualquier editor. Los signos de puntuación cuentan como palabra de un
 * solo carácter: así «(Ana)» marca «Ana» al pinchar en medio.
 */
export function wordRangeAt(text: string, index: number): [number, number] {
  if (text === "") return [index, index];
  const isWord = (char: string) => /[\p{L}\p{N}_]/u.test(char);
  const at = Math.min(Math.max(index, 0), Math.max(0, text.length - 1));
  const same = isWord(text[at]);
  let start = at;
  let end = at;
  while (start > 0 && isWord(text[start - 1]) === same) start -= 1;
  while (end < text.length && isWord(text[end]) === same) end += 1;
  return [start, end];
}

/**
 * Carácter al que apunta el ratón dentro de una celda. La celda se mide en
 * pantalla y su ancho se reparte en caracteres: así el cursor cae donde se ha
 * hecho clic, como en cualquier editor, y el arrastre selecciona texto.
 *
 * `x`/`y` son píxeles desde la esquina del texto de la celda, `charWidth` el
 * ancho de un carácter, `perLine` cuántos caben en un renglón y `pitch` el alto
 * de un renglón (para el texto que se envuelve en varios).
 */
export function cellIndexAtPointer(
  text: string,
  x: number,
  y: number,
  charWidth: number,
  perLine: number,
  pitch: number,
): number {
  if (charWidth <= 0 || perLine <= 0 || pitch <= 0) return 0;
  const row = Math.max(0, Math.floor(y / pitch));
  const column = Math.round(x / charWidth);
  // Pinchar a la derecha de un renglón lleva a su fin, no al principio del
  // siguiente (y nunca más allá del texto).
  const rowEnd = Math.min(text.length, (row + 1) * perLine);
  if (column >= rowEnd) return rowEnd;
  return Math.min(Math.max(column, row * perLine), rowEnd);
}

/**
 * Tabla nueva de `cols` columnas y `rows` de cuerpo, con el cursor en la
 * primera celda de datos. Es lo que inserta el menú «/».
 */
export function tableSkeleton(
  cols: number,
  rows: number,
): { text: string; caret: number } {
  const width = Math.max(1, Math.min(Math.round(cols) || 1, 12));
  const height = Math.max(1, Math.min(Math.round(rows) || 1, 12));
  const header = formatTableRow(
    Array.from({ length: width }, (_, i) => `Columna ${i + 1}`),
  );
  const rule = formatTableRow(Array.from({ length: width }, () => "---"));
  const row = formatTableRow(Array.from({ length: width }, () => ""));
  const lines = [header, rule, ...Array.from({ length: height }, () => row)];
  const flat: TableLine[] = lines.map((text) => ({ text, code: false }));
  return { text: lines.join("\n"), caret: lineStartOffset(flat, 2) + 2 };
}

/**
 * Convierte texto en filas de tabla: separa por tabuladores (o por comas si no
 * hay tabs) y, si ya venía con «|», los quita. `firstIsHeader` decide si la
 * primera línea es la cabecera; si no, se genera una con nombres genéricos.
 */
export function tableFromDelimited(
  text: string,
  firstIsHeader: boolean,
): { lines: string[]; caret: number } {
  const rows = text
    .split("\n")
    .map((row) => row.trim())
    .filter((row, index, all) => row !== "" || (index > 0 && index < all.length - 1));
  if (rows.length === 0) return { lines: [], caret: 0 };

  const piped = rows.every((row) => /^\s*\|.*\|\s*$/.test(row));
  const tabbed = rows.some((row) => row.includes("\t"));
  const split = (row: string): string[] =>
    row
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(tabbed ? "\t" : piped ? "|" : ",")
      // Los «|» de las celdas los escapa formatTableRow al montar la fila.
      .map((cell) => cell.trim());

  const cells = rows.map(split);
  const width = Math.max(2, ...cells.map((row) => row.length));
  const pad = (row: string[]) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ];

  const header = firstIsHeader
    ? pad(cells[0])
    : Array.from({ length: width }, (_, i) => `Columna ${i + 1}`);
  const body = (firstIsHeader ? cells.slice(1) : cells).map(pad);
  // Una tabla necesita al menos una fila de cuerpo: si solo venía la cabecera
  // se añade una vacía.
  if (body.length === 0) body.push(Array.from({ length: width }, () => ""));

  const lines = [
    formatTableRow(header),
    formatTableRow(Array.from({ length: width }, () => "---")),
    ...body.map(formatTableRow),
  ];
  const flat: TableLine[] = lines.map((line) => ({ text: line, code: false }));
  return { lines, caret: lineStartOffset(flat, 2) + 2 };
}

/* ────────────────────────────────────────────────────────────────────────────
   Bloques fijos: operaciones de fila/columna y protección de la estructura.
   ──────────────────────────────────────────────────────────────────────────── */

export interface TableBlock {
  start: number;
  end: number;
}

/** Bloque de tabla que contiene a la línea `line`; null si no está en uno. */
export function tableBlockAt(lines: TableLine[], line: number): TableBlock | null {
  return blockAt(lines, line);
}

/**
 * Localizador de bloques con caché: recorrer un rango carácter a carácter no
 * vuelve a caminar el bloque (ni a reanalizar la fila) en cada comprobación,
 * y las líneas que ya se sabe que no son tabla tampoco se reanalizan.
 */
function blockFinder(lines: TableLine[]): (line: number) => TableBlock | null {
  let block: TableBlock | null = null;
  let emptyLine = -1;
  return (line: number) => {
    if (line < 0 || line >= lines.length) return null;
    if (block && line >= block.start && line <= block.end) return block;
    if (line === emptyLine) return null;
    const found = blockAt(lines, line);
    block = found;
    emptyLine = found ? -1 : line;
    return found;
  };
}

/** Línea (0-based) que contiene el desplazamiento absoluto `offset`. */
export function lineIndexOf(value: string, offset: number): number {
  const at = Math.max(0, Math.min(offset, value.length));
  let line = 0;
  for (let i = 0; i < at; i += 1) if (value.charCodeAt(i) === 10) line += 1;
  return line;
}

/** Columnas del bloque (la fila más ancha manda). */
export function tableColumnCount(lines: TableLine[], block: TableBlock): number {
  let cols = 0;
  for (let i = block.start; i <= block.end; i += 1) {
    cols = Math.max(cols, splitTableCells(lines[i].text).length);
  }
  return cols;
}

/** Fila reconstruida con el formato «| a | b |» (los «|» de la celda se escapan). */
function formatTableRow(cells: string[]): string {
  return `|${cells.map((cell) => ` ${cell.replace(/\|/g, "\\|")} `).join("|")}|`;
}

/** Celda de separador con la misma alineación que su vecina. */
function delimiterText(cell: string): string {
  const align = delimiterAlign(cell);
  return align === "center" ? ":---:" : align === "right" ? "---:" : "---";
}

export interface TableEdit {
  /** Líneas nuevas del documento (solo el cuerpo, sin frontmatter). */
  lines: string[];
  /** Celda donde debe quedarse el cursor dentro de `lines`. */
  caret?: { line: number; col: number };
  /** Posición absoluta alternativa del cursor (p. ej. al eliminar la tabla). */
  offset?: number;
  /** El cursor se queda en la celda en la que está (la operación no lo mueve:
   *  alinear una columna, ordenarla… el usuario sigue donde estaba). */
  keepCaret?: boolean;
}

function clampCol(text: string, col: number): number {
  const cols = splitTableCells(text).length;
  return Math.max(0, Math.min(col, cols - 1));
}

/**
 * Nueva fila vacía por debajo de la fila `line`, con el cursor en la columna
 * `col` (la que se pulsó en el borde inferior). La cabecera y el separador
 * insertan al inicio del cuerpo: la fila del separador no admite filas dentro.
 */
export function insertTableRow(
  lines: TableLine[],
  line: number,
  col = 0,
): TableEdit | null {
  const block = blockAt(lines, line);
  if (!block) return null;

  const cols = tableColumnCount(lines, block);
  const at = line <= block.start + 1 ? block.start + 2 : line + 1;
  if (at > block.end + 1) return null;

  const next = lines.map((entry) => entry.text);
  next.splice(at, 0, `|${"  |".repeat(cols)}`);
  return { lines: next, caret: { line: at, col: Math.min(Math.max(col, 0), cols - 1) } };
}

/** Columna nueva a la derecha de `afterCol` en todas las filas del bloque. */
export function insertTableColumn(
  lines: TableLine[],
  block: TableBlock,
  afterCol: number,
  focusLine: number,
): TableEdit | null {
  const cols = tableColumnCount(lines, block);
  if (afterCol < 0 || afterCol >= cols) return null;

  const next = lines.map((entry, index) => {
    if (index < block.start || index > block.end) return entry.text;
    const cells = splitTableCells(entry.text);
    const texts = cells.map((cell) => cell.text);
    const filler = index === block.start + 1 ? delimiterText(cells[afterCol]?.text ?? "") : "";
    texts.splice(afterCol + 1, 0, filler);
    return formatTableRow(texts);
  });

  const inBody = focusLine >= block.start && focusLine <= block.end && focusLine !== block.start + 1;
  return {
    lines: next,
    caret: { line: inBody ? focusLine : block.start, col: afterCol + 1 },
  };
}

/**
 * Quita la fila `line`. No toca la cabecera ni el separador y se niega si la
 * tabla se quedaría sin filas de cuerpo (dejaría de ser una tabla).
 */
export function removeTableRow(
  lines: TableLine[],
  line: number,
  col: number,
): TableEdit | null {
  const block = blockAt(lines, line);
  if (!block) return null;
  if (line <= block.start + 1) return null;
  if (block.end - block.start < 3) return null;

  const next = lines.map((entry) => entry.text);
  next.splice(line, 1);
  const caretLine = Math.min(line, block.end - 1);
  return { lines: next, caret: { line: caretLine, col: clampCol(next[caretLine] ?? "", col) } };
}

/** Quita la columna `col`; con menos de dos columnas dejaría de ser tabla. */
export function removeTableColumn(
  lines: TableLine[],
  block: TableBlock,
  col: number,
  focusLine: number,
): TableEdit | null {
  const cols = tableColumnCount(lines, block);
  if (cols <= 2 || col < 0 || col >= cols) return null;

  const next = lines.map((entry, index) => {
    if (index < block.start || index > block.end) return entry.text;
    const texts = splitTableCells(entry.text).map((cell) => cell.text);
    texts.splice(col, 1);
    return formatTableRow(texts);
  });

  const inBody = focusLine >= block.start && focusLine <= block.end && focusLine !== block.start + 1;
  const caretLine = inBody ? focusLine : block.start;
  return { lines: next, caret: { line: caretLine, col: clampCol(next[caretLine] ?? "", col) } };
}

/** Borra el bloque entero y deja el cursor donde estaba la tabla. */
export function removeTable(lines: TableLine[], block: TableBlock): TableEdit {
  const next = lines.map((entry) => entry.text);
  next.splice(block.start, block.end - block.start + 1);
  const flat: TableLine[] = next.map((text) => ({ text, code: false }));
  return { lines: next, offset: lineStartOffset(flat, block.start) };
}

/** ¿El rango toca alguna línea de un bloque de tabla? */
export function tableIntersects(
  lines: TableLine[],
  value: string,
  start: number,
  end: number,
): boolean {
  const find = blockFinder(lines);
  const first = lineIndexOf(value, start);
  const last = lineIndexOf(value, Math.max(start, end - 1));
  for (let line = first; line <= last; line += 1) if (find(line)) return true;
  return false;
}

export interface TableDeletionPlan {
  /** Texto final: el rango borrado menos los caracteres estructurales. */
  text: string;
  /** Posición del cursor tras el borrado. */
  caret: number;
}

/**
 * Prepara el borrado de `[start, end)` sin romper ninguna tabla. Se conservan
 * siempre los «|» que separan las celdas, los saltos de línea que unen la
 * tabla con su entorno (y los de su interior) y la fila del separador: así la
 * tabla nunca desaparece con Supr/Backspace ni se queda suelta en el texto.
 * Devuelve `null` cuando no hay ninguna tabla implicada (borrado nativo).
 */
export function planTableDeletion(
  lines: TableLine[],
  value: string,
  start: number,
  end: number,
): TableDeletionPlan | null {
  if (end <= start || !value.includes("|")) return null;

  const find = blockFinder(lines);
  const keep: boolean[] = new Array(end - start).fill(false);
  let line = lineIndexOf(value, start);
  let touched = false;

  for (let at = start; at < end; at += 1) {
    const char = value[at];
    let save = false;

    if (char === "\n") {
      // El salto se mantiene si une la tabla con la línea de arriba o la de abajo.
      save = find(line) !== null || find(line + 1) !== null;
      line += 1;
    } else {
      const block = find(line);
      if (block) {
        if (line === block.start + 1) save = true; // fila del separador: intacta
        else if (char === "|" && value[at - 1] !== "\\") save = true;
      }
    }

    keep[at - start] = save;
    if (save) touched = true;
  }

  if (!touched) return null;

  // Un «|» conservado arrastra sus espacios: así la fila sigue leyéndose como
  // «|  |  |» (celdas vacías) en vez de apretarse en «||».
  for (let at = start; at < end; at += 1) {
    if (!keep[at - start] || value[at] !== "|") continue;
    if (at - 1 >= start && value[at - 1] === " ") keep[at - 1 - start] = true;
    if (at + 1 < end && value[at + 1] === " ") keep[at + 1 - start] = true;
  }

  // Último control: cualquier fila del bloque que toque el rango tiene que
  // seguir siendo una fila con sus celdas. Si el recorte la dejaría con menos
  // de dos (filas sin «|» final, muy apretadas), se conserva entera.
  const firstLine = lineIndexOf(value, start);
  const lastLine = lineIndexOf(value, end - 1);
  let lineStart = lineStartOffset(lines, firstLine);
  for (let line = firstLine; line <= lastLine && line < lines.length; line += 1) {
    const text = lines[line].text;
    const lineEnd = lineStart + text.length;
    const from = Math.max(start, lineStart);
    const to = Math.min(end, lineEnd);
    if (from >= to) {
      lineStart = lineEnd + 1;
      continue;
    }

    const block = find(line);
    if (!block || line === block.start + 1) {
      lineStart = lineEnd + 1;
      continue;
    }

    let rebuilt = text.slice(0, from - lineStart);
    for (let at = from; at < to; at += 1) if (keep[at - start]) rebuilt += value[at];
    rebuilt += text.slice(to - lineStart);
    lineStart = lineEnd + 1;
    if (isTableRow(rebuilt)) continue;

    for (let at = from; at < to; at += 1) keep[at - start] = true;
  }

  let kept = "";
  for (let at = start; at < end; at += 1) if (keep[at - start]) kept += value[at];

  return { text: `${value.slice(0, start)}${kept}${value.slice(end)}`, caret: start };
}

/* ────────────────────────────────────────────────────────────────────────────
   Selección rectangular de celdas: el cuadro que se pinta y lo que vacía Supr.
   La selección de texto del textarea es una escalera (una fila entera de más
   en cada vuelta); el rectángulo es lo que la persona marcó celda a celda.
   ──────────────────────────────────────────────────────────────────────────── */

/** Rectángulo de celdas marcadas: líneas absolutas y columnas normalizadas. */
export interface TableCellRect {
  /** Primera línea abarcada (cabecera o primera fila de cuerpo). */
  top: number;
  /** Última línea abarcada. */
  bottom: number;
  /** Columna izquierda (0-based). */
  left: number;
  /** Columna derecha (0-based, incluida). */
  right: number;
}

/**
 * Qué se puede hacer con la selección de una tabla. Vive aquí y no en el menú
 * para poder comprobarlo: es la puerta por la que la persona llega a las
 * acciones, y si una transición falla la opción desaparece sin explicación.
 */
export interface TableMenuState {
  block: { start: number; end: number };
  line: number;
  col: number;
  cols: number;
  rect: TableCellRect | null;
  /**
   * Celda bajo el puntero en la tarjeta pintada. La tarjeta y el texto crudo
   * no están alineados columna a columna (una celda combinada es mucho más
   * ancha que su texto), así que para alinear manda lo que se ve.
   */
  visual?: { line: number; col: number } | null;
  canDeleteRow: boolean;
  canDeleteCol: boolean;
  canSort: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canToggleTask: boolean;
  canMerge: boolean;
  canUnmerge: boolean;
}

/**
 * Rectángulo con el que debe trabajar una acción de tabla (copiar).
 *
 * El que llega con el menú manda: al hacer clic derecho el motor puede colapsar
 * la selección —y con ella el cuadro marcado—, así que el estado ya está vacío
 * aunque la persona siga viendo lo que había seleccionado. El rectángulo se
 * calculó al abrir el menú, con la selección a punto de caer, y ese es el
 * correcto. Solo si el menú no trae ninguno (una acción del menú «/») se usa el
 * del estado.
 */
export function actionRect(
  fromMenu: TableCellRect | null,
  fromState: TableCellRect | null,
): TableCellRect | null {
  return fromMenu ?? fromState;
}

/** Une dos celdas (ancla y foco) en el rectángulo que las contiene. */
export function cellRect(anchor: TableCellRef, focus: TableCellRef): TableCellRect {
  return {
    top: Math.min(anchor.line, focus.line),
    bottom: Math.max(anchor.line, focus.line),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

/** ¿Abarca más de una celda? Una sola es texto suelto dentro de la celda. */
export function rectSpansCells(rect: TableCellRect): boolean {
  return rect.top !== rect.bottom || rect.left !== rect.right;
}

/** Líneas del rectángulo que son filas editables (nunca código ni separador). */
function rectRowLines(lines: TableLine[], rect: TableCellRect): number[] {
  const rows: number[] = [];
  for (let line = Math.max(rect.top, 0); line <= rect.bottom && line < lines.length; line += 1) {
    const entry = lines[line];
    const text = entry.text;
    if (entry.code || !isTableRow(text) || isTableDelimiter(text)) continue;
    rows.push(line);
  }
  return rows;
}

/**
 * Contenido de las celdas del rectángulo para el portapapeles: tabulador
 * entre celdas y salto de línea entre filas (lo mismo que espera una hoja de
 * cálculo al pegar), sin tocar los «|» del documento.
 */
export function cellRectClipboard(lines: TableLine[], rect: TableCellRect): string {
  const rows: string[] = [];
  for (const line of rectRowLines(lines, rect)) {
    const cells = splitTableCells(lines[line].text);
    const texts: string[] = [];
    for (let col = rect.left; col <= rect.right && col < cells.length; col += 1) {
      texts.push(cells[col].text);
    }
    rows.push(texts.join("\t"));
  }
  return rows.join("\n");
}

/**
 * Vacía el contenido de las celdas del rectángulo. Se conservan los «|», la
 * fila del separador y los saltos de línea: la tabla queda en pie con sus
 * celdas vacías, igual que haría Supr sobre texto normal. Devuelve `null`
 * cuando no había nada que borrar (todas las celdas ya estaban vacías).
 */
export function clearTableCells(
  lines: TableLine[],
  rect: TableCellRect,
): TableDeletionPlan | null {
  const next = lines.map((entry) => entry.text);
  let touched = false;

  for (const line of rectRowLines(lines, rect)) {
    const text = lines[line].text;
    const spans = splitTableCells(text);
    let rebuilt = text;
    // De derecha a izquierda: así no se mueven los offsets de la izquierda.
    for (let col = Math.min(rect.right, spans.length - 1); col >= rect.left; col -= 1) {
      const span = spans[col];
      if (span.end <= span.start) continue;
      rebuilt = `${rebuilt.slice(0, span.start)}${rebuilt.slice(span.end)}`;
    }
    // Seguro final: la fila tiene que seguir siendo una fila con sus celdas.
    if (rebuilt === text || !isTableRow(rebuilt)) continue;
    next[line] = rebuilt;
    touched = true;
  }

  if (!touched) return null;

  // El cursor vuelve al principio de la primera celda marcada. Ese offset es
  // el del texto original: lo que va delante no cambió, así que sigue cayendo
  // dentro de la celda (y escribir allí deja «| x |», no «|  x|»).
  const caret =
    tableCellRange(lines, rect.top, rect.left)?.start ?? lineStartOffset(lines, rect.top);
  return { text: next.join("\n"), caret };
}

/* ────────────────────────────────────────────────────────────────────────────
   Combinación de celdas: detección de marcadores («>», «^»), cálculo de cuadrícula
   fusionada, combinar selección y separar celdas.
   ──────────────────────────────────────────────────────────────────────────── */

/** Marcador para combinar con la celda de la izquierda («>»). */
export function isColSpanMarker(text: string): boolean {
  return text.trim() === ">";
}

/** Marcador para combinar con la celda superior («^»). */
export function isRowSpanMarker(text: string): boolean {
  return text.trim() === "^";
}

export function isMergeMarker(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === ">" || trimmed === "^";
}

export interface CellMergeInfo {
  isContinuation: boolean;
  masterLine: number;
  masterCol: number;
  colSpan: number;
  rowSpan: number;
}

/**
 * Calcula la estructura de celdas combinadas de un bloque de tabla.
 * Devuelve un Map con clave `${line}:${col}` y su información de fusión.
 */
export function computeTableMerges(
  lines: TableLine[],
  start: number,
  end?: number,
): Map<string, CellMergeInfo> {
  const map = new Map<string, CellMergeInfo>();
  const lastLine = end ?? lines.length - 1;
  if (start < 0 || start >= lines.length) return map;

  const headerCells = splitTableCells(lines[start]?.text ?? "");
  const cols = headerCells.length;

  // 1. Cabecera (combinación horizontal)
  let c = 0;
  while (c < cols) {
    let colSpan = 1;
    while (c + colSpan < cols && isColSpanMarker(headerCells[c + colSpan]?.text ?? "")) {
      colSpan += 1;
    }
    map.set(`${start}:${c}`, {
      isContinuation: false,
      masterLine: start,
      masterCol: c,
      colSpan,
      rowSpan: 1,
    });
    for (let k = 1; k < colSpan; k += 1) {
      map.set(`${start}:${c + k}`, {
        isContinuation: true,
        masterLine: start,
        masterCol: c,
        colSpan: 1,
        rowSpan: 1,
      });
    }
    c += colSpan;
  }

  // 2. Filas de cuerpo (start + 2 hasta lastLine)
  const bodyLines: number[] = [];
  for (let l = start + 2; l <= lastLine && l < lines.length; l += 1) {
    if (!lines[l].code && isTableRow(lines[l].text)) {
      bodyLines.push(l);
    }
  }

  const numBodyRows = bodyLines.length;
  if (numBodyRows === 0) return map;

  const bodyGrid: TableCellSpan[][] = bodyLines.map((l) => splitTableCells(lines[l].text));
  const maxCols = Math.max(cols, ...bodyGrid.map((row) => row.length));

  const gridMaster: { r: number; c: number }[][] = Array.from({ length: numBodyRows }, (_, r) =>
    Array.from({ length: maxCols }, (_, colIdx) => ({ r, c: colIdx })),
  );

  for (let r = 0; r < numBodyRows; r += 1) {
    for (let colIdx = 0; colIdx < maxCols; colIdx += 1) {
      const text = bodyGrid[r][colIdx]?.text ?? "";
      if (isColSpanMarker(text) && colIdx > 0) {
        gridMaster[r][colIdx] = gridMaster[r][colIdx - 1];
      } else if (isRowSpanMarker(text) && r > 0) {
        gridMaster[r][colIdx] = gridMaster[r - 1][colIdx];
      }
    }
  }

  const groups = new Map<string, { r: number; c: number }[]>();
  for (let r = 0; r < numBodyRows; r += 1) {
    for (let colIdx = 0; colIdx < maxCols; colIdx += 1) {
      const master = gridMaster[r][colIdx];
      const key = `${master.r}:${master.c}`;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push({ r, c: colIdx });
    }
  }

  groups.forEach((cells, key) => {
    const [mrStr, mcStr] = key.split(":");
    const mr = Number(mrStr);
    const mc = Number(mcStr);
    const masterLine = bodyLines[mr];

    let maxR = mr;
    let maxC = mc;
    for (const cell of cells) {
      if (cell.r > maxR) maxR = cell.r;
      if (cell.c > maxC) maxC = cell.c;
    }

    const rowSpan = maxR - mr + 1;
    const colSpan = maxC - mc + 1;

    map.set(`${masterLine}:${mc}`, {
      isContinuation: false,
      masterLine,
      masterCol: mc,
      colSpan,
      rowSpan,
    });

    for (const cell of cells) {
      if (cell.r === mr && cell.c === mc) continue;
      const curLine = bodyLines[cell.r];
      map.set(`${curLine}:${cell.c}`, {
        isContinuation: true,
        masterLine,
        masterCol: mc,
        colSpan: 1,
        rowSpan: 1,
      });
    }
  });

  return map;
}

/**
 * Combina las celdas del rectángulo `rect`.
 * La celda superior izquierda se convierte en la celda maestra conservando el contenido.
 * Las celdas restantes de la primera fila se marcan con «>».
 * Las celdas de las filas inferiores se marcan con «^» o «>».
 */
export function mergeTableCells(
  lines: TableLine[],
  rect: TableCellRect,
): TableEdit | null {
  if (!rectSpansCells(rect)) return null;

  const rows = rectRowLines(lines, rect);
  if (rows.length === 0) return null;

  const masterLine = rows[0];
  const masterCol = rect.left;
  let masterText = "";

  const masterSpans = splitTableCells(lines[masterLine]?.text ?? "");
  const currentMasterText = masterSpans[masterCol]?.text ?? "";
  if (currentMasterText !== "" && !isMergeMarker(currentMasterText)) {
    masterText = currentMasterText;
  } else {
    for (const line of rows) {
      const spans = splitTableCells(lines[line]?.text ?? "");
      for (let col = rect.left; col <= rect.right; col += 1) {
        const t = spans[col]?.text ?? "";
        if (t !== "" && !isMergeMarker(t)) {
          masterText = t;
          break;
        }
      }
      if (masterText !== "") break;
    }
  }

  const next = lines.map((entry) => entry.text);

  for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
    const line = rows[rIdx];
    const spans = splitTableCells(next[line]);
    const texts = spans.map((s) => s.text);
    while (texts.length <= rect.right) texts.push("");

    if (rIdx === 0) {
      texts[masterCol] = masterText;
      for (let c = rect.left + 1; c <= rect.right; c += 1) {
        texts[c] = ">";
      }
    } else {
      texts[rect.left] = "^";
      for (let c = rect.left + 1; c <= rect.right; c += 1) {
        texts[c] = ">";
      }
    }

    next[line] = formatTableRow(texts);
  }

  return {
    lines: next,
    caret: { line: masterLine, col: masterCol },
  };
}

/**
 * Separa celdas combinadas. Si se pasa un `rect`, separa cualquier fusión dentro del rectángulo.
 * Si no hay rectángulo, separa la celda en la que está el cursor `(line, col)`.
 */
export function unmergeTableCells(
  lines: TableLine[],
  line: number,
  col: number,
  rect: TableCellRect | null,
): TableEdit | null {
  const block = blockAt(lines, line);
  if (!block) return null;

  const merges = computeTableMerges(lines, block.start, block.end);
  const rows = rect && rectSpansCells(rect) ? rectRowLines(lines, rect) : [line];
  const targetCols =
    rect && rectSpansCells(rect)
      ? { min: rect.left, max: rect.right }
      : { min: col, max: col };

  let targets: { line: number; col: number }[] = [];

  if (rect && rectSpansCells(rect)) {
    for (const r of rows) {
      for (let c = targetCols.min; c <= targetCols.max; c += 1) {
        targets.push({ line: r, col: c });
      }
    }
  } else {
    const curMerge = merges.get(`${line}:${col}`);
    if (
      !curMerge ||
      (!curMerge.isContinuation && curMerge.colSpan === 1 && curMerge.rowSpan === 1)
    ) {
      return null;
    }
    const mLine = curMerge.masterLine;
    const mCol = curMerge.masterCol;
    merges.forEach((info, key) => {
      if (info.masterLine === mLine && info.masterCol === mCol) {
        const [lStr, cStr] = key.split(":");
        targets.push({ line: Number(lStr), col: Number(cStr) });
      }
    });
  }

  if (targets.length === 0) return null;

  const next = lines.map((entry) => entry.text);
  let changed = false;

  for (const { line: tLine, col: tCol } of targets) {
    const spans = splitTableCells(next[tLine]);
    if (tCol >= spans.length) continue;
    const current = spans[tCol].text;
    if (isMergeMarker(current)) {
      const texts = spans.map((s) => s.text);
      texts[tCol] = "";
      next[tLine] = formatTableRow(texts);
      changed = true;
    }
  }

  if (!changed) return null;

  return {
    lines: next,
    caret: { line, col },
  };
}

export function isTableMergePossible(rect: TableCellRect | null): boolean {
  return rect !== null && rectSpansCells(rect);
}

export function isTableUnmergePossible(
  lines: TableLine[],
  line: number,
  col: number,
  rect: TableCellRect | null,
): boolean {
  const block = blockAt(lines, line);
  if (!block) return false;
  const merges = computeTableMerges(lines, block.start, block.end);

  if (rect && rectSpansCells(rect)) {
    const rows = rectRowLines(lines, rect);
    for (const r of rows) {
      for (let c = rect.left; c <= rect.right; c += 1) {
        const m = merges.get(`${r}:${c}`);
        if (m && (m.isContinuation || m.colSpan > 1 || m.rowSpan > 1)) {
          return true;
        }
      }
    }
    return false;
  }

  const cur = merges.get(`${line}:${col}`);
  return !!cur && (cur.isContinuation || cur.colSpan > 1 || cur.rowSpan > 1);
}


