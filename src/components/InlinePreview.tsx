import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import clsx from "clsx";
import { Check, Copy, Plus } from "lucide-react";
import type { SpellFn } from "../lib/spellCheck";
import { codeBlocks } from "../lib/codeBlocks";
import { parseImageLine } from "../lib/imageLinks";
import {
  computeTableMerges,
  delimiterAlign,
  sourceSegments,
  splitTableCells,
  visualLength,
  type TableCellCaret,
  type TableCellRect,
  type TableCellSpan,
} from "../lib/tableLayout";
import { useT } from "../lib/i18n";
import { useResolvedImage } from "./useResolvedImage";

export interface SourceLine {
  text: string;
  fence: boolean;
  code: boolean;
}

export function classifySource(lines: string[]): SourceLine[] {
  let open = false;

  return lines.map((text) => {
    const fence = /^\s*(?:`{3,}|~{3,})/.test(text);
    const line: SourceLine = { text, fence, code: open || fence };
    if (fence) open = !open;
    return line;
  });
}

type InlineKind = "code" | "wiki" | "image" | "link" | "bold" | "strike" | "italic";

interface InlineToken {
  at: number;
  kind: InlineKind;
}

function tokenAt(text: string, i: number): InlineToken | null {
  const char = text[i];

  if (char === "`") {
    const end = text.indexOf("`", i + 1);
    if (end > i + 1) return { at: i, kind: "code" };
  }

  if (text.startsWith("[[", i)) {
    if (text.indexOf("]]", i + 2) > i + 1) return { at: i, kind: "wiki" };
  }

  if (text.startsWith("![", i)) {
    const close = text.indexOf("](", i + 2);
    if (close > i + 1 && text.indexOf(")", close + 2) > close + 1) return { at: i, kind: "image" };
  }

  if (char === "[") {
    const close = text.indexOf("](", i + 1);
    if (close > i && text.indexOf(")", close + 2) > close + 1) return { at: i, kind: "link" };
  }

  if (text.startsWith("**", i)) {
    if (text.indexOf("**", i + 2) > i + 1) return { at: i, kind: "bold" };
  }

  if (text.startsWith("~~", i)) {
    if (text.indexOf("~~", i + 2) > i + 1) return { at: i, kind: "strike" };
  }

  if (char === "*" && text[i + 1] !== "*") {
    if (text.indexOf("*", i + 1) > i + 1) return { at: i, kind: "italic" };
  }

  return null;
}

function findToken(text: string): InlineToken | null {
  for (let i = 0; i < text.length; i++) {
    const found = tokenAt(text, i);
    if (found) return found;
  }
  return null;
}

function spellNodes(text: string, spell: SpellFn | null, key: string): ReactNode {
  if (!spell || text === "") return text;

  const segments = spell(text);
  const nodes: ReactNode[] = [];
  let plain = "";
  // Identidad de cada segmento: su desplazamiento de carácter en el texto,
  // no su posición en el array (que cambia cuando se corrige una falta
  // anterior y los segmentos se fusionan).
  let offset = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const start = offset;
    offset += segment.text.length;
    if (!segment.bad) {
      plain += segment.text;
      continue;
    }
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
    nodes.push(
      <span key={`${key}.${start}`} className="gus-misspelled">
        {segment.text}
      </span>,
    );
  }
  if (plain) nodes.push(plain);

  return nodes;
}

/**
 * Nota y vault que la imagen de una línea necesita para resolverse: se pasan
 * por contexto porque `inlineNodes` es una función pura que se llama desde
 * varias capas (líneas, celdas de tabla) y enhebrarla por todas costaría caro.
 */
const ImageNoteContext = createContext<{ notePath: string; vaultPath: string | null }>({
  notePath: "",
  vaultPath: null,
});

/**
 * Imagen renderizada dentro de una línea del modo edición.
 *
 * Ocupa justo la altura de la fila: la capa visible del overlay es absoluta y
 * recorta, así que lo que sobresalga no desplaza a las líneas de debajo ni
 * descuadra el texto del textarea. Mientras carga, y si no se encuentra, se
 * queda el «🖼 nombre» de siempre.
 */
function InlineImage({
  destination,
  alt,
  spell,
  nodeKey,
}: {
  destination: string;
  alt: string;
  spell: SpellFn | null;
  nodeKey: string;
}) {
  const { notePath, vaultPath } = useContext(ImageNoteContext);
  const estado = useResolvedImage(destination, notePath, vaultPath);

  if (estado.fase === "listo") {
    return (
      <img
        src={estado.url}
        alt={alt}
        className="inline-block h-[var(--gus-row-h)] max-w-[160px] object-contain align-top"
      />
    );
  }

  return (
    <span className="text-gus-muted italic">
      {alt ? spellNodes(`🖼 ${alt}`, spell, nodeKey) : "🖼 imagen"}
    </span>
  );
}

function inlineNodes(text: string, spell: SpellFn | null, depth = 0): ReactNode {
  if (depth > 4 || text === "") return spellNodes(text, spell, `d${depth}`);

  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    const found = findToken(rest);
    if (!found) {
      nodes.push(spellNodes(rest, spell, `r${key}`));
      break;
    }

    const head = rest.slice(0, found.at);
    const tail = rest.slice(found.at);
    if (head) nodes.push(spellNodes(head, spell, `h${key}`));

    let consumed: number;
    let node: ReactNode;

    switch (found.kind) {
      case "code": {
        const end = tail.indexOf("`", 1);
        consumed = end + 1;
        // Código en línea al estilo Obsidian: fondo de bloque, esquinas
        // redondeadas y color de texto normal (no el color de acento).
        node = (
          <code
            key={key}
            className="rounded bg-gus-card px-1 py-0.5 font-mono text-[0.9em] text-gus-text"
          >
            {tail.slice(1, end)}
          </code>
        );
        break;
      }
      case "wiki": {
        const end = tail.indexOf("]]", 2);
        const inner = tail.slice(2, end);
        const [target, alias] = inner.split("|");
        consumed = end + 2;
        node = (
          <span
            key={key}
            className="text-gus-accent underline decoration-gus-accent/40 underline-offset-2"
          >
            {alias ?? target}
          </span>
        );
        break;
      }
      case "image": {
        const close = tail.indexOf("](", 2);
        const end = tail.indexOf(")", close + 2);
        const alt = tail.slice(2, close);
        const destination = tail.slice(close + 2, end);
        consumed = end + 1;
        node = (
          <InlineImage
            key={key}
            destination={destination}
            alt={alt}
            spell={spell}
            nodeKey={`a${key}`}
          />
        );
        break;
      }
      case "link": {
        const close = tail.indexOf("](", 1);
        const end = tail.indexOf(")", close + 2);
        consumed = end + 1;
        node = (
          <span
            key={key}
            className="text-gus-accent underline decoration-gus-accent/40 underline-offset-2"
          >
            {inlineNodes(tail.slice(1, close), spell, depth + 1)}
          </span>
        );
        break;
      }
      case "bold": {
        const end = tail.indexOf("**", 2);
        consumed = end + 2;
        node = (
          <strong key={key} className="font-semibold">
            {inlineNodes(tail.slice(2, end), spell, depth + 1)}
          </strong>
        );
        break;
      }
      case "strike": {
        const end = tail.indexOf("~~", 2);
        consumed = end + 2;
        node = (
          <del key={key} className="text-gus-muted line-through">
            {inlineNodes(tail.slice(2, end), spell, depth + 1)}
          </del>
        );
        break;
      }
      case "italic": {
        const end = tail.indexOf("*", 1);
        consumed = end + 1;
        node = (
          <em key={key} className="italic">
            {inlineNodes(tail.slice(1, end), spell, depth + 1)}
          </em>
        );
        break;
      }
    }

    nodes.push(node);
    rest = tail.slice(consumed);
    key += 1;
  }

  return nodes;
}

function visibleFor(
  line: SourceLine,
  spell: SpellFn | null,
): { nodes: ReactNode | null; layerClass: string } {
  const { text } = line;

  if (line.code) {
    return { nodes: line.fence ? null : text, layerClass: "" };
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(text);
  if (heading) {
    const level = heading[1].length;
    // Ningún título lleva raya: las únicas líneas horizontales del editor son
    // las que escribe el usuario con «---» (o con una tabla).
    const size = [
      "text-[1.5em] font-bold",
      "text-[1.35em] font-bold",
      "text-[1.22em] font-semibold",
      "text-[1.14em] font-semibold",
      "text-[1.07em] font-semibold text-gus-muted",
      "text-[1em] font-semibold text-gus-muted",
    ][level - 1];
    const rest = heading[2].replace(/\s+#+\s*$/, "");
    return { nodes: <span className={size}>{inlineNodes(rest, spell)}</span>, layerClass: "" };
  }

  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    // Borde (igual que el <hr> del preview) y no fondo: con el zoom fraccional
    // de la app, WebKitGTK descarta un fondo de 1px y la regla desaparecía.
    return { nodes: <span className="absolute inset-x-0 top-1/2 h-0 border-t border-gus-border" />, layerClass: "" };
  }

  const quote = /^(\s*)((?:>\s*)+)(.*)$/.exec(text);
  if (quote) {
    return {
      nodes: (
        <>
          {quote[1]}
          {inlineNodes(quote[3], spell)}
        </>
      ),
      layerClass: "border-l-2 border-gus-accent/50 pl-2",
    };
  }

  const list = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\](?=\s|$))?(.*)$/.exec(text);
  if (list) {
    const [, indent, marker, spacing, box, rest] = list;
    const ordered = /^\d/.test(marker);
    const checked = box !== undefined && box[1] !== " ";

    return {
      nodes: (
        <>
          {indent}
          <span className="text-gus-accent/70">{ordered ? marker : "•"}</span>
          {spacing}
          {box !== undefined && (
            <span className={checked ? "text-gus-accent" : "text-gus-muted"}>
              {checked ? "☑" : "☐"}
            </span>
          )}
          <span className={checked ? "text-gus-muted line-through" : undefined}>
            {inlineNodes(rest, spell)}
          </span>
        </>
      ),
      layerClass: "",
    };
  }

  return { nodes: inlineNodes(text, spell), layerClass: "" };
}

/** Selección absoluta dentro del documento (posiciones del textarea). */
export interface TableSelection {
  start: number;
  end: number;
}

/** Barra «+» de una tabla sobre la que está el ratón (MarkdownEditor la mide). */
export interface TableBarHover {
  /** Primera línea del bloque de tabla. */
  block: number;
  /** "side" = tira del costado (añade columna), "bottom" = tira de abajo (fila). */
  part: "side" | "bottom";
}

/** Borde de columna bajo el ratón, listo para arrastrar (MarkdownEditor lo mide). */
export interface TableResizeHover {
  /** Primera línea del bloque de tabla. */
  block: number;
  /** Columna cuyo borde derecho se agarra. */
  col: number;
}

interface TableBlockProps {
  lines: SourceLine[];
  start: number;
  rowPitch: number;
  /** Caracteres que caben en una fila del textarea (null si aún no se midió). */
  textCols: number | null;
  offsets: number[];
  spell: SpellFn | null;
  tableCaret: TableCellCaret | null;
  /** Selección absoluta dentro del bloque (puede abarcar varias filas). */
  selection: TableSelection | null;
  /** Rectángulo de celdas marcadas (varias celdas): se pinta como un cuadro. */
  rect: TableCellRect | null;
  /** Anchura en píxeles de cada columna (null = la que dé el contenido). */
  widths: number[] | null;
  /** Barra «+» de este bloque bajo el ratón (null = ninguna visible). */
  hoveredBar: "side" | "bottom" | null;
  /** Columna cuyo borde derecho se puede arrastrar (null = ninguna). */
  hoverResize: { col: number } | null;
}

/** Contenido de una celda; si está activa, marca la selección o el caret. */
function cellNodes(
  span: TableCellSpan,
  cellStart: number,
  cellEnd: number,
  active: boolean,
  selection: TableSelection | null,
  spell: SpellFn | null,
): ReactNode {
  const text = span.text;
  if (!selection) return inlineNodes(text, spell);

  const from = Math.min(Math.max(selection.start, cellStart), cellEnd);
  const to = Math.min(Math.max(selection.end, cellStart), cellEnd);

  // Sin texto seleccionado en esta celda: solo la activa dibuja el caret.
  if (from >= to) {
    if (!active) return inlineNodes(text, spell);
    const at = from - cellStart;
    return (
      <>
        {at > 0 && inlineNodes(text.slice(0, at), spell)}
        <span className="gus-cell-caret" />
        {at < text.length && inlineNodes(text.slice(at), spell)}
      </>
    );
  }

  const relStart = from - cellStart;
  const relEnd = to - cellStart;
  return (
    <>
      {relStart > 0 && inlineNodes(text.slice(0, relStart), spell)}
      <span className="rounded-[2px] bg-gus-accent/30">
        {inlineNodes(text.slice(relStart, relEnd), spell)}
      </span>
      {relEnd < text.length && inlineNodes(text.slice(relEnd), spell)}
    </>
  );
}

/** Grosor de las dos barras «+»: caben justo en el padding del overlay. */
const BAR_SIZE = 16;

/**
 * Las dos barras «+» de la tabla: una a lo alto de todo el costado derecho y
 * otra a todo el ancho por debajo. Están siempre en el DOM pero invisibles
 * (opacity 0) hasta que el ratón se posa sobre ellas, que es cuando se
 * enseñan. El overlay es de punteros inertes: hover y clic los resuelve
 * MarkdownEditor por coordenadas, leyendo los atributos `data-add-*`.
 */
const ADD_BAR =
  "absolute z-10 flex items-center justify-center rounded-full bg-gus-accent/90 text-white opacity-0 shadow-md transition-opacity duration-150";

/**
 * Tabla renderida al estilo Obsidian: nunca se ve la fuente Markdown. Una
 * línea de origen = una fila de altura exacta (rowPitch), así el bloque ocupa
 * exactamente las mismas filas que el textarea. La fila del separador (|---|)
 * no se dibuja: la cabecera abarca su banda. El cursor se edita por celda con
 * resaltado y un caret sintético en la posición real del texto.
 * Al acercar el ratón a los bordes se enseñan las dos barras «+»: la del
 * costado (toda la altura) añade una columna y la de abajo (todo el ancho)
 * añade una fila; solo se ven con el ratón encima de la barra.
 */
function TableBlock({
  lines,
  start,
  rowPitch,
  textCols,
  offsets,
  spell,
  tableCaret,
  selection,
  rect,
  widths,
  hoveredBar,
  hoverResize,
}: TableBlockProps) {
  const t = useT();
  const rows = lines.map((line) => splitTableCells(line.text));
  const aligns = rows[1].map((cell) => delimiterAlign(cell.text));
  const cols = rows.reduce((max, cells) => Math.max(max, cells.length), 1);
  const lastRow = rows.length - 1;
  // `lines` llega recortada al bloque (índice 0 = cabecera), así que el
  // cálculo es relativo: pasar el `start` del documento dejaba el mapa vacío
  // o desplazado y las celdas «>»/«^» se pintaban como texto literal.
  const merges = useMemo(
    () => computeTableMerges(lines, 0, rows.length - 1),
    [lines, rows.length],
  );
  /** Línea interior de la tabla: solo en el borde derecho y el de abajo de cada
   *  celda, para que el contorno de la tarjeta no se dibuje dos veces. */
  const cellLine = "1px solid color-mix(in oklab, var(--color-gus-border) 70%, transparent)";
  const cellBorders = (col: number, row: number, colSpan = 1, rowSpan = 1) => ({
    borderRight: col + colSpan - 1 < cols - 1 ? cellLine : undefined,
    borderBottom: (row === 0 ? 0 : row) + rowSpan - 1 < lastRow ? cellLine : undefined,
  });

  // El rectángulo marcado manda sobre la escalera de texto: se pinta el cuadro
  // entero y las celdas dejan de resaltar su interior por separado (si no, la
  // marca se llevaría por delante filas enteras de celdas que nadie marcó).
  const boxed = rect !== null && rect.top >= start && rect.bottom <= start + lastRow;
  // La fila del separador no se dibuja: la cabecera abarca su banda, así que
  // las líneas del bloque saltan una rejilla al pasar de la cabecera al cuerpo.
  const gridRowOf = (line: number) => {
    const i = line - start;
    return i === 0 ? 1 : i + 1;
  };
  const gridEndRowOf = (line: number) => {
    const i = line - start;
    return i === 0 ? 3 : i + 2;
  };
  const boxTop = boxed ? gridRowOf(rect.top) : 0;
  const boxBottom = boxed ? gridEndRowOf(rect.bottom) : 0;
  /**
   * Asa del borde de una columna: al arrastrarla se cambia la anchura de esa
   * columna. El asa invisible es la zona de agarre (7 px junto al borde) y solo
   * se ve la línea cuando el ratón está encima; el overlay es de punteros
   * inertes, así que MarkdownEditor la encuentra por coordenadas con
   * `data-resize-*`.
   */
  const resizeHandle = (col: number) => (
    <span
      data-resize-block={start}
      data-resize-col={col}
      style={{ top: 0, bottom: 0, right: 0, width: 7 }}
      className="absolute z-20 cursor-col-resize"
    >
      <span
        className={clsx(
          "absolute inset-y-0 w-[2px] bg-gus-accent transition-opacity duration-150 right-0",
          hoverResize?.col === col ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );

  // La rejilla mide lo que suman sus columnas, no un ancho de bloque: al
  // encoger una columna la tarjeta se encoge con ella y no queda un hueco vacío
  // al final. Sin anchuras fijadas, en cambio, se estira hasta el ancho de la
  // línea (las columnas `auto` reparten el sobrante), que es lo de siempre.
  const fixed = widths !== null && widths.length >= cols;

  // El crudo de una fila puede no caber en una línea del textarea: entonces el
  // motor lo envuelve y esa fila ocupa ahí más de un alto de línea, mientras la
  // tarjeta puede medir menos. La tarjeta reserva como alto mínimo el que ocupa
  // el crudo: así las líneas de debajo del bloque siguen cayendo donde les
  // toca (es lo que luego mide y compensa MarkdownEditor).
  const rawRows =
    textCols && textCols > 0
      ? lines.reduce(
          (rows, line) => rows + Math.max(1, Math.ceil(visualLength(line.text) / textCols)),
          0,
        )
      : 0;

  return (
    // El envoltorio cuelga de la tabla entera (los dos «+» viven por fuera de
    // la tarjeta); dentro, la rejilla es una tarjeta con esquinas redondeadas y
    // sus propias líneas, al estilo Obsidian.
    <div className={clsx("relative", fixed && "w-fit")}>
      <div
        data-table-block={start}
        style={{
          position: "relative",
          display: "grid",
          // Con anchuras fijas (el usuario arrastró un borde) la rejilla las
          // usa en píxeles; si no, cada columna mide lo que dé su contenido.
          gridTemplateColumns: fixed
            ? widths.map((width) => `${width}px`).join(" ")
            : `repeat(${cols}, auto)`,
          width: fixed ? "max-content" : undefined,
          minHeight: rawRows > 0 ? rawRows * rowPitch : undefined,
          // Cada fila mide una línea, como el textarea; pero si el texto de una
          // celda no cabe en su columna, la fila crece y el texto salta de línea
          // como en Excel. Ese alto de más lo mide MarkdownEditor y lo compensa
          // al hacer scroll y al situar el cursor.
          gridAutoRows: `minmax(${rowPitch}px, auto)`,
        }}
        className="overflow-hidden rounded-lg bg-gus-card/10 ring-1 ring-gus-border"
      >
        {rows.map((cells, i) => {
          if (i === 1) return null; // separador: la cabecera ocupa su banda

          const line = start + i;
          const lineStart = offsets[line];
          const header = i === 0;
          const padded: (TableCellSpan | null)[] = [...cells];
          while (padded.length < cols) padded.push(null);

          return padded.map((span, c) => {
            const mergeInfo = merges.get(`${i}:${c}`);
            if (mergeInfo?.isContinuation) {
              return null;
            }
            const colSpan = mergeInfo?.colSpan ?? 1;
            const rowSpan = mergeInfo?.rowSpan ?? 1;

            const active =
              tableCaret !== null && tableCaret.line === line && tableCaret.col === c;
            const cellStart = lineStart + (span?.start ?? lines[i].text.length);
            const cellEnd = lineStart + (span?.end ?? lines[i].text.length);
            // Con el cuadro marcado no se resalta el texto de cada celda: la
            // escalera que une las dos puntas se llevaría por delante celdas que
            // no están en el rectángulo.
            const cellSelection = boxed
              ? active && tableCaret
                ? { start: tableCaret.selStart, end: tableCaret.selStart }
                : null
              : active || overlaps(selection, cellStart, cellEnd)
                ? selection
                : null;

            // La identidad de la celda es su coordenada (fila, columna) en
            // la rejilla: la lista no se reordena ni se filtra (las filas
            // salen de los offsets del documento) y las celdas no tienen
            // estado interno que pueda quedar pegado a otra celda. La regla
            // señala la línea del `key`, que no admite comentarios dentro de
            // la etiqueta, así que se desactiva en bloque solo aquí.
            /* eslint-disable react-doctor/no-array-index-as-key */
            return (
              <div
                key={`${i}.${c}`}
                data-cell=""
                data-line={line}
                data-col={c}
                style={{
                  gridRow: header
                    ? "1 / span 2"
                    : rowSpan > 1
                      ? `${i + 1} / span ${rowSpan}`
                      : i + 1,
                  gridColumn: colSpan > 1 ? `${c + 1} / span ${colSpan}` : c + 1,
                  ...cellBorders(c, i, colSpan, rowSpan),
                  textAlign: aligns[c] ?? "left",
                }}
                className={clsx(
                  "relative px-3",
                  header ? "bg-gus-card/60 font-semibold text-gus-text" : "text-gus-text",
                  active && "bg-gus-accent/10 ring-2 ring-inset ring-gus-accent",
                )}
              >
                <div className="whitespace-pre-wrap break-words">
                  {span === null
                    ? null
                    : cellNodes(span, cellStart, cellEnd, active, cellSelection, spell)}
                </div>
                {resizeHandle(c + colSpan - 1)}
              </div>
            );
            /* eslint-enable react-doctor/no-array-index-as-key */
          });
        })}

        {/* Cuadro de la selección: celdas completas entre la ancla y el foco,
            como cuando se marca texto en el escritorio. */}
        {boxed && rect && (
          <div
            aria-hidden="true"
            data-table-selection=""
            style={{
              gridRow: `${boxTop} / ${boxBottom}`,
              gridColumn: `${rect.left + 1} / ${rect.right + 2}`,
            }}
            className="pointer-events-none relative z-10 rounded-md border border-gus-accent/70 bg-gus-accent/15"
          />
        )}
      </div>

      {/* Tira del costado: toda la altura de la tabla, fuera de su borde. */}
      <span
        data-add-col={cols - 1}
        data-add-block={start}
        data-add-bar="side"
        title={t("table.addColumn")}
        aria-hidden="true"
        style={{
          top: 0,
          bottom: 0,
          right: -BAR_SIZE,
          width: BAR_SIZE,
          opacity: hoveredBar === "side" ? 1 : 0,
        }}
        className={ADD_BAR}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>

      {/* Tira de abajo: todo el ancho de la tabla, pegada a su último borde. */}
      <span
        data-add-row={start + lastRow}
        data-add-block={start}
        data-add-bar="bottom"
        title={t("table.addRow")}
        aria-hidden="true"
        style={{
          left: 0,
          right: 0,
          bottom: -BAR_SIZE,
          height: BAR_SIZE,
          opacity: hoveredBar === "bottom" ? 1 : 0,
        }}
        className={ADD_BAR}
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
    </div>
  );
}

/** ¿La selección toca el interior de la celda? (Las celdas vacías, que no
 * tienen interior, cuentan si caen dentro de los dos extremos.) */
function overlaps(
  selection: TableSelection | null,
  cellStart: number,
  cellEnd: number,
): boolean {
  if (selection === null) return false;
  if (cellStart === cellEnd) return selection.start <= cellStart && selection.end >= cellEnd;
  return selection.start < cellEnd && selection.end > cellStart;
}

/** Situación de una línea dentro de un bloque de código (para pintarlo). */
interface CodeBlockLineInfo {
  /** Primera línea del bloque: la valla de apertura. */
  start: number;
  first: boolean;
  last: boolean;
  language: string | null;
  text: string;
}

/**
 * Pinta una línea troceada donde van el cursor y el texto seleccionado. Cada
 * trozo se dibuja como siempre (resaltado, sintaxis, corrector): el overlay
 * puede pintar la marca cuando el textarea no puede, porque un bloque de arriba
 * (una tabla envuelta o una imagen a tamaño real) ha crecido y su cursor
 * quedaría descolocado.
 */
function markUpNodes(
  text: string,
  marked: TableSelection | null,
  caretAt: number | null,
  render: (piece: string) => ReactNode,
): ReactNode {
  const from = marked ? Math.max(0, Math.min(marked.start, text.length)) : 0;
  const to = marked ? Math.max(from, Math.min(marked.end, text.length)) : 0;
  const at = caretAt === null ? -1 : Math.max(0, Math.min(caretAt, text.length));
  if (at < 0 && to <= from) return render(text);

  // `end` marca hasta dónde avanza el flujo tras insertar el nodo: el de la
  // selección trae ya dentro el texto de su trozo, así que hay que saltarlo
  // entero (si no, el resto se volvería a pintar desde el principio del
  // trozo y la línea saldría duplicada «al costado»).
  const marks: { at: number; end: number; node: ReactNode }[] = [];
  if (at >= 0) {
    marks.push({ at, end: at, node: <span key="caret" className="gus-cell-caret" /> });
  }
  if (to > from) {
    marks.push({
      at: from,
      end: to,
      node: (
        <span key="mark" className="rounded-[2px] bg-gus-accent/30">
          {render(text.slice(from, to))}
        </span>
      ),
    });
  }
  marks.sort((a, b) => a.at - b.at);

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.at > cursor) {
      nodes.push(<span key={`t${cursor}`}>{render(text.slice(cursor, mark.at))}</span>);
    }
    nodes.push(mark.node);
    cursor = Math.max(cursor, mark.end);
  }
  if (cursor < text.length) {
    nodes.push(<span key={`t${cursor}`}>{render(text.slice(cursor))}</span>);
  }
  return <>{nodes}</>;
}

interface PreviewLineProps {
  text: string;
  code: boolean;
  fence: boolean;
  caret: boolean;
  raw: boolean;
  hint?: boolean;
  spell: SpellFn | null;
  block?: CodeBlockLineInfo;
  /** El botón «copiar» de este bloque acaba de pulsarse (muestra ✔). */
  copied?: boolean;
  /** El cursor del textarea está sobre el botón «copiar» del bloque. */
  hovered?: boolean;
  /** Cursor dibujado aquí (posición dentro de la línea), o null. */
  caretAt?: number | null;
  /** Texto seleccionado en esta línea (posiciones locales), o null. */
  marked?: TableSelection | null;
}

const PreviewLine = memo(function PreviewLine({
  text,
  code,
  fence,
  caret,
  raw,
  hint = false,
  spell,
  block,
  copied = false,
  hovered = false,
  caretAt = null,
  marked = null,
}: PreviewLineProps) {
  const t = useT();
  if (raw) {
    const marked = spell && !code ? spellNodes(text, spell, "w") : text;
    return (
      <div className="min-h-[var(--gus-row-h)]">
        <span className="block whitespace-break-spaces break-words text-transparent">
          {text === "" ? "\u200B" : marked}
        </span>
      </div>
    );
  }

  /**
   * Pinta la línea troceada donde van el cursor y el texto seleccionado. Cada
   * trozo se dibuja como siempre (resaltado, sintaxis, corrector): el overlay
   * puede pintar la marca cuando el textarea no puede, porque un bloque de
   * arriba (una tabla envuelta o una imagen a tamaño real) ha crecido y su
   * cursor quedaría descolocado.
   */
  const markUp = (render: (piece: string) => ReactNode): ReactNode =>
    markUpNodes(text, marked, caretAt, render);

  // Fondo continuo del bloque con las esquinas redondeadas arriba y abajo,
  // pero separado de los bordes del editor como la tarjeta de la vista
  // previa: los -mx-3 compensan 12 px del px-10 del overlay, así el fondo deja
  // 28 px de hueco a cada lado y el texto sigue exactamente donde el textarea
  // lo escribe (ni un píxel de desplazamiento).
  const blockWrap = block
    ? clsx(
        "relative -mx-3 bg-gus-card px-3",
        block.first && "rounded-t",
        block.last && "rounded-b",
      )
    : undefined;

  // Botón «copiar» al estilo Obsidian (su «code-block-flair»): el nombre del
  // lenguaje, o el icono si la valla no trae ninguno. Va en el overlay, que
  // queda debajo del textarea, así que los clics los intercepta MarkdownEditor
  // por coordenadas (lo mismo que hace con las celdas de las tablas).
  const chip =
    block?.first === true ? (
      <span
        data-copy-line={block.start}
        title={t("editor.copyCode")}
        className={clsx(
          "absolute top-1.5 right-1.5 z-10 flex items-center rounded px-2 py-1 font-sans text-xs",
          copied
            ? "text-emerald-400"
            : clsx("text-gus-muted", hovered && "bg-gus-border/70 text-gus-text"),
        )}
      >
        {copied ? (
          <Check size={14} />
        ) : block.language ? (
          block.language
        ) : (
          <Copy size={14} />
        )}
      </span>
    ) : null;

  // Línea del cursor: código fuente visible para editar los marcadores.
  if (caret) {
    // La pista «/» se dibuja dentro de la propia línea vacía (ghost):
    // nunca flota sobre el texto y hace scroll con el contenido.
    const ghost = hint && text.trim() === "";
    return (
      <div className={clsx("min-h-[var(--gus-row-h)]", blockWrap)}>
        <span className="block whitespace-break-spaces break-words">
          {text === "" ? (
            "\u200B"
          ) : (
            markUp((piece) => (spell && !code ? spellNodes(piece, spell, "c") : piece))
          )}
          {ghost && (
            <span className="ml-1 italic text-gus-muted/50">
              Pulsa «/» para insertar bloques…
            </span>
          )}
        </span>
        {chip}
      </div>
    );
  }

  const { nodes, layerClass } = visibleFor({ text, fence, code }, spell);

  return (
    <div className={clsx("relative min-h-[var(--gus-row-h)]", blockWrap)}>
      <span className="block invisible whitespace-break-spaces break-words">{text || "\u200B"}</span>

      {nodes !== null && (
        <span
          className={clsx(
            "absolute inset-0 block overflow-hidden whitespace-break-spaces break-words",
            // Una capa absoluta se coloca contra el relleno del div, no contra
            // su contenido: en los bloques hay que repetir el px-3 para que el
            // texto visible caiga en la misma columna que el textarea (x=40)
            // y envuelva en el mismo ancho (si cambia uno, cambia el otro).
            block && "px-3",
            "text-gus-text",
            layerClass,
          )}
        >
          {markUp((piece) => visibleFor({ text: piece, fence, code }, spell).nodes)}
        </span>
      )}
      {chip}
    </div>
  );
});

/**
 * Línea que es entera una imagen: se pinta **a tamaño real**, como en la vista
 * de lectura, y ocupa las filas que le tocan (las que mida una vez cargada).
 *
 * Al crecer por encima de su markdown, el resto del overlay baja por el flujo
 * y deja de cuadrar con el textarea: MarkdownEditor mide ese sobrante con
 * `data-drift-line` (contra `data-line-measure`, que replica el alto que el
 * textarea reserva para la línea) y compensa scroll, clic y cursor, igual que
 * con las tablas envueltas. Si la línea tiene el cursor, su markdown se pinta
 * arriba para poder editarlo y la imagen ocupa el resto.
 */
const ImageLine = memo(function ImageLine({
  text,
  index,
  rowPitch,
  caret,
  spell,
  caretAt = null,
  marked = null,
  anchoVivo = null,
  resizando = false,
}: {
  text: string;
  /** Número de línea de origen, con el que se mide el sobrante. */
  index: number;
  rowPitch: number;
  caret: boolean;
  spell: SpellFn | null;
  caretAt?: number | null;
  marked?: TableSelection | null;
  /** Ancho al que se pinta mientras se arrastra el asa (la escala manda). */
  anchoVivo?: number | null;
  /** Si se enseña el asa (ratón encima u arrastre en marcha). */
  resizando?: boolean;
}) {
  const { notePath, vaultPath } = useContext(ImageNoteContext);
  const partes = parseImageLine(text);
  const destino = partes?.destination ?? "";
  const estado = useResolvedImage(destino, notePath, vaultPath);
  const src = estado.fase === "listo" ? estado.url : null;

  // Altura a la que la imagen queda renderizada (con sus topes de ancho y de
  // 70vh ya aplicados): de ella salen las filas que la línea ocupa. Mientras
  // carga, o si no existe, la línea se queda en su fila.
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [medida, setMedida] = useState<{ src: string; alto: number } | null>(null);
  const [natural, setNatural] = useState<{ src: string; w: number; h: number } | null>(null);

  // El ancho fijado lo mandan el markdown («foto|300») y, en su caso, el
  // redimensionado en marcha.
  const ancho = anchoVivo ?? partes?.ancho ?? null;
  // Con ancho fijado la altura se deduce de la escala al momento (sin pasar
  // por medir y volver a renderizar, que dejaría el sobrante un paso atrás);
  // sin ancho, manda la medida real tras la carga.
  const alto =
    ancho !== null && natural && natural.src === src
      ? (ancho * natural.h) / natural.w
      : src && medida?.src === src
        ? medida.alto
        : 0;
  const filasImagen = alto > 0 ? Math.max(1, Math.ceil(alto / rowPitch)) : 1;
  const filas = filasImagen + (caret ? 1 : 0);

  const medir = () => {
    const el = imgRef.current;
    if (!src || !el) return;
    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
      setNatural((prev) =>
        prev && prev.src === src && prev.w === el.naturalWidth && prev.h === el.naturalHeight
          ? prev
          : { src, w: el.naturalWidth, h: el.naturalHeight },
      );
    }
    const altoAhora = el.getBoundingClientRect().height;
    setMedida((prev) =>
      prev && prev.src === src && prev.alto === altoAhora ? prev : { src, alto: altoAhora },
    );
  };

  // Una imagen que ya venía cacheada puede montarse sin disparar `onLoad`:
  // se mide igual al aparecer en el DOM.
  useEffect(() => {
    const el = imgRef.current;
    if (src && el?.complete && el.naturalWidth > 0) medir();
    // `medir` lee `src` y `imgRef` del cierre, que es lo que cambia aquí.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const alt = partes?.alt ?? "";

  return (
    <div
      className="relative min-h-[var(--gus-row-h)]"
      data-drift-line={index}
      style={filas > 1 ? { minHeight: filas * rowPitch } : undefined}
    >
      {/* Medidor: el alto que el textarea reserva para esta línea (su markdown
          envuelve igual, porque es el mismo texto en el mismo ancho). */}
      <span data-line-measure className="block invisible whitespace-break-spaces break-words">
        {text || "\u200B"}
      </span>

      {/* Capa visible: absoluta y recortada, como en el resto de líneas. */}
      <span className="absolute inset-0 block overflow-hidden">
        {caret && (
          <span className="block whitespace-break-spaces break-words">
            {markUpNodes(text, marked, caretAt, (piece) =>
              spell ? spellNodes(piece, spell, "c") : piece,
            )}
          </span>
        )}
        {src ? (
          // El envase abraza la imagen para que el asa caiga en su esquina,
          // no en la de la línea (que va centrada con holgura).
          <span className="relative mx-auto block w-fit max-w-full">
            <img
              ref={imgRef}
              src={src}
              alt={alt}
              onLoad={medir}
              style={ancho !== null ? { width: `${ancho}px` } : undefined}
              className={clsx(
                "block max-w-full object-contain",
                // Con ancho fijado la altura la da la escala; el tope de 70vh
                // deformaría la imagen, así que solo aplica sin ancho.
                ancho === null && "max-h-[70vh]",
              )}
            />
            {/* Asa de la esquina: el overlay no recibe eventos, así que solo
                se dibuja aquí y MarkdownEditor la detecta por coordenadas. */}
            <span
              data-image-resize={index}
              className="absolute bottom-0 right-0 z-20 size-4 cursor-nwse-resize"
            >
              <span
                className={clsx(
                  "absolute inset-0 border-b-2 border-r-2 border-gus-accent transition-opacity duration-150",
                  resizando ? "opacity-100" : "opacity-0",
                )}
              />
            </span>
          </span>
        ) : (
          <span className="block text-gus-muted italic">
            {alt ? spellNodes(`🖼 ${alt}`, spell, "i") : "🖼 imagen"}
          </span>
        )}
      </span>
    </div>
  );
});

export interface InlinePreviewProps {
  lines: SourceLine[];
  caretLine: number;
  scrollbarWidth?: number;
  fontSize?: number;
  rowHeight?: number;
  overlayRef?: Ref<HTMLDivElement>;
  spell?: SpellFn | null;
  raw?: boolean;
  slashHint?: boolean;
  /** Ancho disponible medido en caracteres; null = aún sin medir. */
  tableCols?: number | null;
  /** Celda bajo el cursor para la edición estilo Excel (null = fuera de tabla). */
  tableCaret?: TableCellCaret | null;
  /** Selección absoluta mientras el cursor está en una tabla (multifila). */
  tableSelection?: TableSelection | null;
  /** Rectángulo de celdas marcadas (varias celdas): se pinta como un cuadro. */
  tableRect?: TableCellRect | null;
  /** Barra «+» de tabla que tiene el ratón encima (la que hay que enseñar). */
  hoveredBar?: TableBarHover | null;
  /** Anchura fijada de cada columna por bloque (null = la que dé el contenido). */
  tableWidths?: Map<number, number[]> | null;
  /** Cursor dibujado en el overlay, dentro de la línea del cursor. */
  caretAt?: number | null;
  /** Selección absoluta que el overlay pinta (el textarea la lleva oculta). */
  caretSel?: TableSelection | null;
  /** Borde de columna bajo el ratón, listo para arrastrar. */
  hoverResize?: TableResizeHover | null;
  /** Redimensionado de imagen en marcha: línea y ancho en píxeles. */
  imageResize?: { line: number; width: number } | null;
  /** Línea cuya asa tiene el ratón encima (o cuyo arrastre va en marcha). */
  hoverImageLine?: number | null;
  /** Primera línea del bloque cuyo botón «copiar» se acaba de pulsar (✔ 1 s). */
  copiedLine?: number | null;
  /** Primera línea del bloque que tiene el cursor encima (resalta su botón). */
  hoverLine?: number | null;
  /** Nota en la que se edita: con ella y `vaultPath` se resuelven las imágenes. */
  notePath?: string;
  /** Raíz del vault (null = aún sin vault) para resolver las imágenes. */
  vaultPath?: string | null;
}

export default function InlinePreview({
  lines,
  caretLine,
  scrollbarWidth = 0,
  fontSize,
  rowHeight = 23,
  overlayRef,
  spell = null,
  raw = false,
  slashHint = false,
  tableCols = null,
  tableCaret = null,
  tableSelection = null,
  tableRect = null,
  hoveredBar = null,
  tableWidths = null,
  hoverResize = null,
  imageResize = null,
  hoverImageLine = null,
  caretAt = null,
  caretSel = null,
  copiedLine = null,
  hoverLine = null,
  notePath = "",
  vaultPath = null,
}: InlinePreviewProps) {
  // La interlínea real la fija MarkdownEditor (medida sobre el textarea): al
  // escalar, el motor redondea las filas a píxeles enteros y el overlay debe
  // imitar ese redondeo para no desfasarse.
  const rootStyle: CSSProperties = {
    right: scrollbarWidth,
    fontSize: fontSize ? `${fontSize}px` : undefined,
    lineHeight: `${rowHeight}px`,
  };
  (rootStyle as Record<string, string | number>)["--gus-row-h"] = `${rowHeight}px`;

  const segments = useMemo(
    () => sourceSegments(lines, raw, tableCols),
    [lines, raw, tableCols],
  );

  // Nota y vault de las imágenes de las líneas: memoizados para que los
  // InlineImage no se repinten en cada repintado del overlay.
  const imageCtx = useMemo(() => ({ notePath, vaultPath }), [notePath, vaultPath]);

  // Cada línea sabe a qué bloque de código pertenece: así el fondo sale
  // continuo (primera/última línea redondeadas) y el botón «copiar» solo se
  // dibuja en la valla de apertura. En modo fuente no se decora nada.
  const blockLines = useMemo(() => {
    const map = new Map<number, CodeBlockLineInfo>();
    if (raw) return map;
    for (const block of codeBlocks(lines)) {
      for (let index = block.start; index <= block.end; index++) {
        map.set(index, {
          start: block.start,
          first: index === block.start,
          last: index === block.end,
          language: block.language,
          text: block.text,
        });
      }
    }
    return map;
  }, [lines, raw]);

  // Offset absoluto de cada línea dentro del body (para rangos de celda).
  const offsets = useMemo(() => {
    const list: number[] = [];
    let at = 0;
    for (const line of lines) {
      list.push(at);
      at += line.text.length + 1;
    }
    return list;
  }, [lines]);

  return (
    <ImageNoteContext.Provider value={imageCtx}>
      <div
        ref={overlayRef}
        aria-hidden="true"
        style={rootStyle}
        className="gus-source-overlay pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-gus-bg px-10 py-4 font-mono text-sm"
      >
      {segments.map((segment) => {
        if (segment.kind === "table") {
          return (
            <TableBlock
              key={`table-${segment.start}`}
              lines={lines.slice(segment.start, segment.end + 1)}
              start={segment.start}
              rowPitch={rowHeight}
              textCols={tableCols}
              offsets={offsets}
              spell={spell}
              tableCaret={tableCaret}
              selection={tableSelection}
              rect={tableRect}
              widths={tableWidths?.get(segment.start) ?? null}
              hoveredBar={
                hoveredBar && hoveredBar.block === segment.start ? hoveredBar.part : null
              }
              hoverResize={
                hoverResize && hoverResize.block === segment.start
                  ? { col: hoverResize.col }
                  : null
              }
            />
          );
        }

        const lineStart = offsets[segment.index];
        const lineLen = lines[segment.index].text.length;
        // La selección se recorta a esta línea: el overlay pinta solo su trozo.
        const marked = caretSel
          ? {
              start: Math.max(0, Math.min(caretSel.start - lineStart, lineLen)),
              end: Math.max(0, Math.min(caretSel.end - lineStart, lineLen)),
            }
          : null;

        const linea = lines[segment.index];
        // Una línea que es entera una imagen se pinta a tamaño real (y no en
        // modo fuente, donde va el markdown tal cual como en el textarea).
        if (!raw && !linea.code && parseImageLine(linea.text)) {
          return (
            <ImageLine
              key={segment.index}
              text={linea.text}
              index={segment.index}
              rowPitch={rowHeight}
              caret={segment.index === caretLine}
              spell={spell}
              caretAt={segment.index === caretLine ? caretAt : null}
              marked={marked}
              anchoVivo={imageResize?.line === segment.index ? imageResize.width : null}
              resizando={hoverImageLine === segment.index || imageResize?.line === segment.index}
            />
          );
        }

        const block = blockLines.get(segment.index);
        return (
          <PreviewLine
            key={segment.index}
            text={linea.text}
            code={linea.code}
            fence={linea.fence}
            caret={!raw && segment.index === caretLine}
            raw={raw}
            hint={slashHint}
            spell={spell}
            block={block}
            copied={block !== undefined && block.start === copiedLine}
            hovered={block !== undefined && block.start === hoverLine}
            caretAt={segment.index === caretLine ? caretAt : null}
            marked={marked}
          />
        );
      })}
      </div>
    </ImageNoteContext.Provider>
  );
}
