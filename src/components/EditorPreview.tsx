import { Suspense, type KeyboardEvent } from "react";
import type { Components } from "react-markdown";
import clsx from "clsx";
import { Check } from "lucide-react";
import { highlightCode } from "../lib/highlight";
import { decodeWikiUrl, findWikiNote, type WikiNote } from "../lib/wikiLink";
import CopyCodeButton from "./CopyCodeButton";
import MermaidDiagram from "./MermaidDiagram";
import { MarkdownBody, PreviewImage, PRE_CLASS, applyPreviewMerges, readCodeBlock } from "./markdownPreview";
import { useT } from "../lib/i18n";

interface PreviewComponentsArgs {
  path: string;
  vaultPath?: string | null;
  wikiNotes: WikiNote[];
  linkRefs?: Record<string, number> | null;
  onOpenWikiLink?: (target: string) => void;
  /** Líneas que ocupa el frontmatter: las casillas se mapean a la fuente sin él. */
  previewOffset: number;
  taskCheckedAt: (line: number) => boolean | null;
  toggleTaskAt: (line: number) => void;
}

interface EditorPreviewProps extends PreviewComponentsArgs {
  body: string;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** Componentes con los que se pinta el Markdown de la nota (vista previa y exportación a PDF). */
export function usePreviewComponents({
  path,
  vaultPath,
  wikiNotes,
  linkRefs,
  onOpenWikiLink,
  previewOffset,
  taskCheckedAt,
  toggleTaskAt,
}: PreviewComponentsArgs): Components {
  const t = useT();

  return {
    h1: ({ children }) => (
      <h1 className="mt-7 mb-3 text-3xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-3 text-2xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-xl font-semibold text-gus-text first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-2 text-lg font-semibold text-gus-text first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-4 mb-2 text-body font-semibold tracking-wider text-gus-muted uppercase first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-4 mb-2 text-body font-semibold tracking-wider text-gus-muted/80 uppercase first:mt-0">
        {children}
      </h6>
    ),
    p: ({ children }) => <p className="my-3 leading-7 text-gus-text first:mt-0 last:mb-0">{children}</p>,
    a: ({ href, children }) => {
      const wikiTarget = href ? decodeWikiUrl(href) : null;

      if (wikiTarget !== null) {
        const match = findWikiNote(wikiNotes, wikiTarget);
        const known = match !== null;
        // Contador de referencias: cuántas notas del vault enlazan aquí.
        const refs = match ? linkRefs?.[match.path] : undefined;
        const openLabel = known
          ? t("editor.wikiOpen", { name: wikiTarget })
          : t("editor.wikiCreate", { name: wikiTarget });

        return (
          <button
            type="button"
            onClick={() => onOpenWikiLink?.(wikiTarget)}
            title={
              refs
                ? `${openLabel} · ${t("editor.linkRefs", { count: refs })}`
                : openLabel
            }
            className={clsx(
              "inline cursor-pointer rounded text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              known
                ? "text-gus-accent underline decoration-gus-accent/40 underline-offset-2 hover:decoration-gus-accent"
                : "text-gus-muted underline decoration-dashed decoration-gus-muted/60 hover:text-gus-text",
            )}
          >
            {children}
            {refs !== undefined && refs > 0 && (
              <sup
                className="ml-0.5 rounded-full border border-gus-accent/30 bg-gus-accent/10 px-1 text-meta leading-4 tabular-nums text-gus-accent/90"
                aria-label={t("editor.linkRefs", { count: refs })}
              >
                {refs}
              </sup>
            )}
          </button>
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-gus-accent underline decoration-gus-accent/40 underline-offset-2 transition-colors hover:decoration-gus-accent"
        >
          {children}
        </a>
      );
    },
    img: (props) => (
      <PreviewImage
        src={props.src}
        alt={props.alt}
        notePath={path}
        vaultPath={vaultPath ?? null}
      />
    ),
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ol>
    ),
    li: ({ node, children }) => {
      const rawClass = node?.properties?.className;
      const classNames = Array.isArray(rawClass) ? rawClass.map(String) : [];
      const line = node?.position?.start?.line;

      if (!classNames.includes("task-list-item") || typeof line !== "number") {
        return <li className="leading-7">{children}</li>;
      }

      const sourceLine = line - previewOffset;
      const checked = taskCheckedAt(sourceLine) === true;

      return (
        <li className="my-1.5 flex list-none items-start gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={t(checked ? "editor.taskPending" : "editor.taskDone")}
            onClick={() => toggleTaskAt(sourceLine)}
            className={clsx(
              "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              checked
                ? "border-gus-accent bg-gus-accent text-gus-bg"
                : "border-gus-muted/50 bg-gus-card hover:border-gus-accent/60",
            )}
          >
            {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
          </button>
          <div className={clsx("min-w-0 flex-1", checked && "text-gus-muted line-through")}>
            {children}
          </div>
        </li>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="my-4 rounded-r-xl border-l-4 border-gus-accent/60 bg-gus-card px-4 py-3 text-gus-muted italic [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-gus-border" />,
    strong: ({ children }) => <strong className="font-semibold text-gus-text">{children}</strong>,
    del: ({ children }) => <del className="text-gus-muted line-through">{children}</del>,
    pre: ({ children }) => {
      const block = readCodeBlock(children);

      // Mermaid: el diagrama ocupa el bloque y no tiene código que copiar.
      if (block.mermaid) {
        return <pre className={clsx(PRE_CLASS, "my-4")}>{children}</pre>;
      }

      // Envoltorio «group» para que el botón de copiar aparezca al pasar el
      // ratón, igual que en Obsidian (que lo oculta con :not(:hover)).
      return (
        <div className="group relative my-4">
          <pre className={PRE_CLASS}>{children}</pre>
          <CopyCodeButton text={block.text} />
        </div>
      );
    },
    code: ({ className, children }) => {
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <MermaidDiagram code={String(children).replace(/\n+$/, "")} />;
      }

      if (language) {
        // Resaltado con Prism, el motor que usa Obsidian en la vista de
        // lectura; si el lenguaje no tiene gramática, texto plano.
        const html = highlightCode(String(children), language);
        if (html !== null) {
          return (
            <code
              className={clsx("gus-code font-mono", className)}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return <code className={clsx("font-mono", className)}>{children}</code>;
      }

      // Código en línea al estilo Obsidian: color de texto normal (el acento
      // queda para los enlaces), con el fondo del bloque.
      return (
        <code className="rounded bg-gus-card px-1 py-0.5 font-mono text-[0.9em] text-gus-text">
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border">
        <table className="w-full text-left text-sm">{applyPreviewMerges(children)}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gus-card text-meta tracking-wide text-gus-muted uppercase">
        {children}
      </thead>
    ),
    // `style` trae la alineación de la columna (remark-gfm) y colSpan/rowSpan
    // los suya applyPreviewMerges (celdas combinadas): sin propagarlos aquí
    // se quedaban en el props y no se pintaban.
    th: ({ children, colSpan, rowSpan, style }) => (
      <th colSpan={colSpan} rowSpan={rowSpan} style={style} className="border-b border-gus-border px-3 py-2 font-semibold text-gus-text">
        {children}
      </th>
    ),
    tr: ({ children }) => <tr className="odd:bg-gus-card/40">{children}</tr>,
    td: ({ children, colSpan, rowSpan, style }) => (
      <td colSpan={colSpan} rowSpan={rowSpan} style={style} className="border-b border-gus-border/60 px-3 py-2 align-top text-gus-text">
        {children}
      </td>
    ),
    input: () => null,
  };
}

/** Vista de lectura de la nota: Markdown renderizado, con enlaces [[wiki]] y casillas vivas. */
export default function EditorPreview({ body, onKeyDown, ...args }: EditorPreviewProps) {
  const t = useT();
  const previewComponents = usePreviewComponents(args);

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label={t("editor.previewPane")}
      className="gus-scrollbar min-h-0 flex-1 overflow-y-auto bg-gus-bg px-6 py-5 focus:outline-none"
    >
      {body.trim() === "" ? (
        <p className="text-sm text-gus-muted">{t("editor.emptyNoteHint")}</p>
      ) : (
        <article className="mx-auto max-w-3xl pb-10">
          <Suspense fallback={<p className="text-sm text-gus-muted">{t("editor.previewLoading")}</p>}>
            <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
          </Suspense>
        </article>
      )}
    </div>
  );
}
