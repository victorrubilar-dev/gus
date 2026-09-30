import { memo, useMemo, type CSSProperties, type ReactNode, type Ref } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import type { SpellFn } from "../lib/spellCheck";
import { codeBlocks } from "../lib/codeBlocks";
import {
  delimiterAlign,
  sourceSegments,
  splitTableCells,
  type TableCellCaret,
  type TableCellSpan,
} from "../lib/tableLayout";

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

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment.bad) {
      plain += segment.text;
      continue;
    }
    if (plain) {
      nodes.push(plain);
      plain = "";
    }
    nodes.push(
      <span key={`${key}.${i}`} className="gus-misspelled">
        {segment.text}
      </span>,
    );
  }
  if (plain) nodes.push(plain);

  return nodes;
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
        consumed = end + 1;
        node = (
          <span key={key} className="text-gus-muted italic">
            {alt ? spellNodes(`🖼 ${alt}`, spell, `a${key}`) : "🖼 imagen"}
          </span>
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

interface TableBlockProps {
  lines: SourceLine[];
  start: number;
  rowPitch: number;
  offsets: number[];
  spell: SpellFn | null;
  tableCaret: TableCellCaret | null;
}

/** Contenido de una celda; si está activa, marca la selección o el caret. */
function cellNodes(
  span: TableCellSpan,
  cellStart: number,
  cellEnd: number,
  active: TableCellCaret | null,
  spell: SpellFn | null,
): ReactNode {
  if (!active) return inlineNodes(span.text, spell);
  const selStart = Math.min(Math.max(active.selStart, cellStart), cellEnd);
  const selEnd = Math.min(Math.max(active.selEnd, cellStart), cellEnd);
  const relStart = selStart - cellStart;
  const relEnd = selEnd - cellStart;
  const pre = span.text.slice(0, relStart);
  const mid = span.text.slice(relStart, relEnd);
  const post = span.text.slice(relEnd);
  return (
    <>
      {pre !== "" && inlineNodes(pre, spell)}
      {selStart === selEnd ? (
        <span className="gus-cell-caret" />
      ) : (
        <span className="rounded-[2px] bg-gus-accent/30">{inlineNodes(mid, spell)}</span>
      )}
      {post !== "" && inlineNodes(post, spell)}
    </>
  );
}

/**
 * Tabla renderida al estilo Obsidian: nunca se ve la fuente Markdown. Una
 * línea de origen = una fila de altura exacta (rowPitch), así el bloque ocupa
 * exactamente las mismas filas que el textarea. La fila del separador (|---|)
 * no se dibuja: la cabecera abarca su banda. El cursor se edita por celda con
 * resaltado y un caret sintético en la posición real del texto.
 */
function TableBlock({ lines, start, rowPitch, offsets, spell, tableCaret }: TableBlockProps) {
  const rows = lines.map((line) => splitTableCells(line.text));
  const aligns = rows[1].map((cell) => delimiterAlign(cell.text));
  const cols = rows.reduce((max, cells) => Math.max(max, cells.length), 1);
  const outline = "1px solid var(--color-gus-border)";
  const accentOutline = "1px solid var(--color-gus-accent)";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, auto)`,
        gridAutoRows: `${rowPitch}px`,
      }}
    >
      {rows.map((cells, i) => {
        if (i === 1) return null; // separador: la cabecera ocupa su banda

        const line = start + i;
        const lineStart = offsets[line];
        const header = i === 0;
        const padded: (TableCellSpan | null)[] = [...cells];
        while (padded.length < cols) padded.push(null);

        return padded.map((span, c) => {
          const active =
            tableCaret !== null && tableCaret.line === line && tableCaret.col === c;
          const cellStart = lineStart + (span?.start ?? lines[i].text.length);
          const cellEnd = lineStart + (span?.end ?? lines[i].text.length);

          return (
            <div
              key={`${i}.${c}`}
              data-cell=""
              data-line={line}
              data-col={c}
              style={{
                gridRow: header ? "1 / span 2" : i + 1,
                gridColumn: c + 1,
                outline: active ? accentOutline : outline,
                textAlign: aligns[c] ?? "left",
              }}
              className={clsx(
                "truncate px-2",
                header ? "bg-gus-card font-semibold text-gus-text" : "text-gus-text",
                active && !header && "bg-gus-accent/10",
              )}
            >
              {span === null
                ? null
                : cellNodes(span, cellStart, cellEnd, active ? tableCaret : null, spell)}
            </div>
          );
        });
      })}
    </div>
  );
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
}: PreviewLineProps) {
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
        title="Copiar código"
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
    const raw = spell && !code ? spellNodes(text, spell, "c") : text;
    // La pista «/» se dibuja dentro de la propia línea vacía (ghost):
    // nunca flota sobre el texto y hace scroll con el contenido.
    const ghost = hint && text.trim() === "";
    return (
      <div className={clsx("min-h-[var(--gus-row-h)]", blockWrap)}>
        <span className="block whitespace-break-spaces break-words">
          {text === "" ? "\u200B" : raw}
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
          {nodes}
        </span>
      )}
      {chip}
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
  /** Primera línea del bloque cuyo botón «copiar» se acaba de pulsar (✔ 1 s). */
  copiedLine?: number | null;
  /** Primera línea del bloque que tiene el cursor encima (resalta su botón). */
  hoverLine?: number | null;
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
  copiedLine = null,
  hoverLine = null,
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
              offsets={offsets}
              spell={spell}
              tableCaret={tableCaret}
            />
          );
        }

        const block = blockLines.get(segment.index);
        return (
          <PreviewLine
            key={segment.index}
            text={lines[segment.index].text}
            code={lines[segment.index].code}
            fence={lines[segment.index].fence}
            caret={!raw && segment.index === caretLine}
            raw={raw}
            hint={slashHint}
            spell={spell}
            block={block}
            copied={block !== undefined && block.start === copiedLine}
            hovered={block !== undefined && block.start === hoverLine}
          />
        );
      })}
    </div>
  );
}
