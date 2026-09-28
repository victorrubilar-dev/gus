import { memo, type CSSProperties, type ReactNode, type Ref } from "react";
import clsx from "clsx";
import type { SpellFn } from "../lib/spellCheck";

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
    const size = [
      "text-[1.5em] font-bold border-b border-gus-border",
      "text-[1.35em] font-bold border-b border-gus-border",
      "text-[1.22em] font-semibold",
      "text-[1.14em] font-semibold",
      "text-[1.07em] font-semibold text-gus-muted",
      "text-[1em] font-semibold text-gus-muted",
    ][level - 1];
    const rest = heading[2].replace(/\s+#+\s*$/, "");
    return { nodes: <span className={size}>{inlineNodes(rest, spell)}</span>, layerClass: "" };
  }

  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
    return { nodes: <span className="absolute inset-x-0 top-1/2 h-px bg-gus-border" />, layerClass: "" };
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

interface PreviewLineProps {
  text: string;
  code: boolean;
  fence: boolean;
  caret: boolean;
  raw: boolean;
  hint?: boolean;
  spell: SpellFn | null;
}

const PreviewLine = memo(function PreviewLine({
  text,
  code,
  fence,
  caret,
  raw,
  hint = false,
  spell,
}: PreviewLineProps) {
  if (raw) {
    const marked = spell && !code ? spellNodes(text, spell, "w") : text;
    return (
      <div className="min-h-[var(--gus-row-h)]">
        <span className="block whitespace-pre-wrap break-words text-transparent">
          {text === "" ? "\u200B" : marked}
        </span>
      </div>
    );
  }

  // Línea del cursor: código fuente visible para editar los marcadores.
  if (caret) {
    const raw = spell && !code ? spellNodes(text, spell, "c") : text;
    // La pista «/» se dibuja dentro de la propia línea vacía (ghost):
    // nunca flota sobre el texto y hace scroll con el contenido.
    const ghost = hint && text.trim() === "";
    return (
      <div className="min-h-[var(--gus-row-h)]">
        <span className="block whitespace-pre-wrap break-words">
          {text === "" ? "\u200B" : raw}
          {ghost && (
            <span className="ml-1 italic text-gus-muted/50">
              Pulsa «/» para insertar bloques…
            </span>
          )}
        </span>
      </div>
    );
  }

  const { nodes, layerClass } = visibleFor({ text, fence, code }, spell);

  return (
    <div className={clsx("relative min-h-[var(--gus-row-h)]", code && "bg-gus-card")}>
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
  lines: SourceLine[];
  caretLine: number;
  scrollbarWidth?: number;
  fontSize?: number;
  rowHeight?: number;
  hidden?: boolean;
  overlayRef?: Ref<HTMLDivElement>;
  spell?: SpellFn | null;
  raw?: boolean;
  slashHint?: boolean;
}

export default function InlinePreview({
  lines,
  caretLine,
  scrollbarWidth = 0,
  fontSize,
  rowHeight = 23,
  hidden,
  overlayRef,
  spell = null,
  raw = false,
  slashHint = false,
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

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      style={rootStyle}
      className={clsx(
        "gus-source-overlay pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-gus-bg px-6 py-4 font-mono text-sm",
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
          hint={slashHint}
          spell={spell}
        />
      ))}
    </div>
  );
}
