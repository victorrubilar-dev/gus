/**
 * Capa de «vista en vivo» detrás del textarea (estilo Obsidian).
 *
 * El textarea pinta su texto transparente (clase `gus-source-area`) y este
 * overlay dibuja por debajo el markdown renderizado de cada línea: títulos,
 * viñetas, casillas, citas, reglas horizontales y bloques de código. La única
 * excepción es la línea del cursor, que se ve como código fuente para poder
 * seguir editando `###`, `- [ ]`, etc.; en cuanto te mueves, se renderiza.
 *
 * Clave de la técnica: cada fila lleva su versión cruda **invisible**
 * («fantasma»), con la misma fuente y métricas que el textarea. Ese fantasma
 * fija la altura de la fila y su ajuste de línea, de modo que aunque el
 * renderizado oculte `###` o rompa distinto, el layout del textarea y del
 * overlay no se descuadra nunca y el cursor cae donde debe.
 *
 * Si los ajustes activan el corrector ortográfico, las faltas se subrayan en
 * esta misma capa: la onda cae bajo la palabra **renderizada**, que es donde
 * la lee el ojo (la fuente cruda con `**` desplazado el texto). En modo
 * «Ver crudo» (`raw`) la capa se usa igual pero solo para las ondas: repite
 * cada línea con texto invisible, porque el que se ve es el del textarea.
 */

import { memo, type ReactNode, type Ref } from "react";
import clsx from "clsx";
import type { SpellFn } from "../lib/spellCheck";

/** Línea del cuerpo con su contexto de bloque. */
export interface SourceLine {
  /** Texto crudo de la línea. */
  text: string;
  /** La línea es un delimitador de bloque cercado (``` o ~~~). */
  fence: boolean;
  /** La línea abre, cierra o pertenece a un bloque de código cercado. */
  code: boolean;
}

/** Altura de fila en píxeles: la comparten textarea, fantasma y renderizado. */
const LINE_HEIGHT = "leading-[23px]";

/**
 * Marca cada línea y reparte los bloques de código cercados. El estado de la
 * valla (```/~~~) es lo único que depende de líneas anteriores, por eso se
 * clasifica de una pasada y se memoriza junto al cuerpo.
 */
export function classifySource(lines: string[]): SourceLine[] {
  let open = false;

  return lines.map((text) => {
    const fence = /^\s*(?:`{3,}|~{3,})/.test(text);
    const line: SourceLine = { text, fence, code: open || fence };
    if (fence) open = !open;
    return line;
  });
}

// ---------------------------------------------------------------------------
// Tokenes en línea: énfasis, código, enlaces y `[[wikis]]`
// ---------------------------------------------------------------------------

type InlineKind = "code" | "wiki" | "image" | "link" | "bold" | "strike" | "italic";

interface InlineToken {
  /** Índice donde empieza el token. */
  at: number;
  kind: InlineKind;
}

/** Qué token (si alguno) empieza exactamente en la posición `i`. */
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

  // Un asterisco suelto: cursiva si cierra dentro de la misma línea
  // (`**` ya se resolvió arriba como negrita).
  if (char === "*" && text[i + 1] !== "*") {
    if (text.indexOf("*", i + 1) > i + 1) return { at: i, kind: "italic" };
  }

  return null;
}

/** Primer token de la línea (por la izquierda; a igualdad, el de más arriba). */
function findToken(text: string): InlineToken | null {
  for (let i = 0; i < text.length; i++) {
    const found = tokenAt(text, i);
    if (found) return found;
  }
  return null;
}

/**
 * Segmentos ortográficos → nodos: solo las faltas llevan la clase de
 * subrayado ondulado; el resto queda como texto plano (mismas métricas, el
 * layout no se mueve ni un píxel).
 */
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

/**
 * Nodos renderizados de un fragmento en línea: los marcadores desaparecen
 * (`**negrita**` → negrita de verdad) y se recurre a `depth` para no buclar
 * con texto mal formado. Con corrector activo, los textos planos se pasan por
 * `spellNodes` para subrayar las faltas; el código en línea y las
 * `[[referencias]]` quedan fuera (son nombres, no prosa).
 */
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
        node = (
          <code key={key} className="rounded bg-gus-card px-1 font-mono text-[0.9em] text-gus-accent">
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

// ---------------------------------------------------------------------------
// Renderizado por bloque de línea
// ---------------------------------------------------------------------------

/**
 * Nodos visibles y clases extra de la capa para una línea concreta. `spell`
 * es la segmentación ortográfica de los ajustes (`null` = apagado): los
 * bloques de código nunca se corrigen.
 */
function visibleFor(
  line: SourceLine,
  spell: SpellFn | null,
): { nodes: ReactNode | null; layerClass: string } {
  const { text } = line;

  // Bloques de código: el texto va literal (no se interpretan marcadores).
  if (line.code) {
    return { nodes: line.fence ? null : text, layerClass: "" };
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(text);
  if (heading) {
    const level = heading[1].length;
    // Mismo espíritu que la vista previa, pero contenido a la altura de fila:
    // `em` escala con la fuente elegida en los ajustes.
    const size = [
      "text-[1.5em] font-bold border-b border-gus-border",
      "text-[1.35em] font-bold border-b border-gus-border",
      "text-[1.22em] font-semibold",
      "text-[1.14em] font-semibold",
      "text-[1.07em] font-semibold text-gus-muted",
      "text-[1em] font-semibold text-gus-muted",
    ][level - 1];
    const rest = heading[2].replace(/\s+#+\s*$/, ""); // quita los `#` de cierre
    return { nodes: <span className={size}>{inlineNodes(rest, spell)}</span>, layerClass: "" };
  }

  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    return { nodes: <span className="absolute inset-x-0 top-1/2 h-px bg-gus-border" />, layerClass: "" };
  }

  const quote = /^(\s*)((?:>\s*)+)(.*)$/.exec(text);
  if (quote) {
    // El borde va en la capa (no en la fila): no debe estrechar el fantasma.
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

interface PreviewLineProps {
  /** Texto crudo de la línea. */
  text: string;
  /** La línea abre, cierra o pertenece a un bloque de código cercado. */
  code: boolean;
  /** La línea es un delimitador de bloque cercado (``` o ~~~). */
  fence: boolean;
  /** true si el cursor está en esta línea (se ve en crudo). */
  caret: boolean;
  /** Modo «Ver crudo»: solo se dibujan las ondas (el texto es del textarea). */
  raw: boolean;
  /** Segmentación del corrector de los ajustes (`null` = sin resaltado). */
  spell: SpellFn | null;
}

/**
 * Una fila del overlay. Con `raw` solo subraya (el textarea pinta el texto,
 * aquí la capa lo repite invisible para situar las ondas); con `caret` pinta
 * el texto tal cual; en el resto, fantasma invisible (métricas del textarea)
 * + capa renderizada encima. Las props son primitivas y `memo` compara por
 * valor: al teclear solo se vuelve a pintar la línea que cambió (y su
 * vecina, al moverse el cursor).
 */
const PreviewLine = memo(function PreviewLine({
  text,
  code,
  fence,
  caret,
  raw,
  spell,
}: PreviewLineProps) {
  // Vista en vivo desactivada: el texto lo escribe el textarea (visible) y
  // esta capa solo repite las líneas para tachar las faltas sin que se note.
  if (raw) {
    const marked = spell && !code ? spellNodes(text, spell, "w") : text;
    return (
      <div className={clsx("min-h-[23px]", LINE_HEIGHT)}>
        <span className="block whitespace-pre-wrap break-words text-transparent">
          {text === "" ? "\u200B" : marked}
        </span>
      </div>
    );
  }

  // Línea del cursor: código fuente visible para editar los marcadores.
  if (caret) {
    // Dentro de código (valla incluida) no se corrige: es texto literal.
    const raw = spell && !code ? spellNodes(text, spell, "c") : text;
    return (
      <div className={clsx("min-h-[23px]", LINE_HEIGHT)}>
        <span className="block whitespace-pre-wrap break-words">
          {text === "" ? "\u200B" : raw}
        </span>
      </div>
    );
  }

  const { nodes, layerClass } = visibleFor({ text, fence, code }, spell);

  return (
    <div className={clsx("relative min-h-[23px]", LINE_HEIGHT, code && "bg-gus-card")}>
      {/* Fantasma: mismo texto con la métrica exacta del textarea. */}
      <span className="block invisible whitespace-pre-wrap break-words">{text || "\u200B"}</span>

      {nodes !== null && (
        <span
          className={clsx(
            "absolute inset-0 block overflow-hidden whitespace-pre-wrap break-words",
            code ? "text-gus-accent" : "text-gus-text",
            layerClass,
          )}
        >
          {nodes}
        </span>
      )}
    </div>
  );
});

export interface InlinePreviewProps {
  /** Líneas clasificadas del cuerpo de la nota. */
  lines: SourceLine[];
  /** Índice (0-based) de la línea del cursor. */
  caretLine: number;
  /** Ancho del scrollbar del área, para no pisar su columna de texto. */
  scrollbarWidth?: number;
  /** Tamaño de letra de los ajustes (px); debe ser el mismo que el textarea. */
  fontSize?: number;
  /** Oculta la capa (mientras el IME compone texto el navegador pinta él). */
  hidden?: boolean;
  /** Capa que el editor desplaza en sincronía con el textarea. */
  overlayRef?: Ref<HTMLDivElement>;
  /** Segmentación ortográfica de los ajustes (`null` = sin corrector). */
  spell?: SpellFn | null;
  /**
   * Modo «Ver crudo»: no se renderiza markdown, solo se subrayan las faltas
   * sobre texto invisible (el textarea pinta el suyo encima).
   */
  raw?: boolean;
}

/** Overlay del markdown en vivo que se coloca detrás del textarea. */
export default function InlinePreview({
  lines,
  caretLine,
  scrollbarWidth = 0,
  fontSize,
  hidden,
  overlayRef,
  spell = null,
  raw = false,
}: InlinePreviewProps) {
  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      style={{
        right: scrollbarWidth,
        fontSize: fontSize ? `${fontSize}px` : undefined,
      }}
      className={clsx(
        "gus-source-overlay pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-gus-bg px-6 py-4 font-mono text-sm",
        LINE_HEIGHT,
        hidden && "invisible",
      )}
    >
      {lines.map((line, index) => (
        <PreviewLine
          key={index}
          text={line.text}
          code={line.code}
          fence={line.fence}
          caret={!raw && index === caretLine}
          raw={raw}
          spell={spell}
        />
      ))}
    </div>
  );
}
