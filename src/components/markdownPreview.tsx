/**
 * Vista previa del editor: render de Markdown con wiki-enlaces, KaTeX, Mermaid
 * y tablas, y las imágenes del vault.
 */
import { Children, cloneElement, isValidElement, lazy, type ReactElement, type ReactNode } from "react";
import type { Components, UrlTransform } from "react-markdown";
import clsx from "clsx";
import { decodeImageDest, splitImageAlt } from "../lib/imageLinks";
import { useT } from "../lib/i18n";
import { computeTableMerges, type TableLine } from "../lib/tableLayout";
import { remarkWikiLinks } from "../lib/wikiLink";
import { useResolvedImage } from "./useResolvedImage";

/** Los bloques de la vista previa, al estilo Obsidian: fondo de bloque,
 *  esquinas a 4px (--code-radius) y sin borde (--code-border-width: 0px). */
export const PRE_CLASS =
  "gus-scrollbar overflow-x-auto whitespace-pre-wrap rounded bg-gus-card px-4 py-3 text-[13px] leading-relaxed text-gus-text [&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-inherit";

/**
 * Lee el contenido del bloque que envuelve un <pre> de react-markdown y
 * detecta si es mermaid: ese bloque se sustituye por el diagrama y no debe
 * llevar botón de copiar (en Obsidian pasa lo mismo: el procesador de
 * mermaid quita el `<pre>` original antes de añadir su botón).
 */
export function readCodeBlock(children: ReactNode): { text: string; mermaid: boolean } {
  const parts: string[] = [];
  let mermaid = false;

  const walk = (node: ReactNode): void => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (isValidElement(node)) {
      const props = node.props as { className?: unknown; children?: ReactNode };
      if (
        typeof props.className === "string" &&
        /(?:^|\s)language-mermaid(?:\s|$)/.test(props.className)
      ) {
        mermaid = true;
      }
      walk(props.children);
    }
  };

  walk(children);
  return { text: parts.join("").replace(/\n+$/, ""), mermaid };
}

/** Texto plano de un nodo React: hace falta para leer los marcadores «>» y «^». */
export function plainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement(node)) {
    return plainText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** Fila React (tr) con forma de línea de tabla markdown, lista para parsearla. */
export function rowToMarkdown(row: ReactElement): string {
  const cells = Children.toArray((row.props as { children?: ReactNode }).children);
  const body = cells
    // Los «|» de la celda se escapan: splitTableCells respeta el escape y el
    // recuento de columnas no se rompe.
    .map((cell) => plainText(cell).replace(/\|/g, "\\|"))
    .map((text) => ` ${text} `)
    .join("|");
  return `|${body}|`;
}

/**
 * Pinta las celdas combinadas en el modo de visualización: las celdas «>» y «^»
 * que dejó la fusión desaparecen y la maestra acumula colSpan/rowSpan. El
 * cálculo es el mismo que usa el modo edición (computeTableMerges), corrido
 * sobre una rejilla reconstruida aquí, porque react-markdown ya ha convertido
 * la tabla en filas y ya no trae el separador `|---|`.
 */
export function applyPreviewMerges(children: ReactNode): ReactNode {
  const sections = Children.toArray(children);

  // 1. Rejilla de texto: cabecera, separador inventado (el HTML no lo lleva) y cuerpo.
  const grid: TableLine[] = [];
  const placements: { section: ReactElement; rows: { row: ReactElement; at: number | null }[] }[] =
    [];
  let needsSeparator = true;

  for (const section of sections) {
    if (!isValidElement(section)) continue;
    const rows = Children.toArray((section.props as { children?: ReactNode }).children);
    const placed: { row: ReactElement; at: number | null }[] = [];

    for (const row of rows) {
      if (!isValidElement(row)) continue;
      placed.push({ row, at: grid.length });
      grid.push({ text: rowToMarkdown(row), code: false });
      if (needsSeparator) {
        needsSeparator = false;
        grid.push({ text: "| --- |", code: false });
      }
    }

    placements.push({ section, rows: placed });
  }

  const merges = computeTableMerges(grid, 0, Math.max(0, grid.length - 1));

  // 2. Volver a montar las secciones sin las celdas de continuación, con los
  //    spans en las maestras (cloneElement conserva los props de react-markdown).
  return placements.map(({ section, rows }) => {
    const rebuiltRows = rows.map(({ row, at }) => {
      const cells = Children.toArray((row.props as { children?: ReactNode }).children);
      const merged: ReactNode[] = [];

      cells.forEach((cell, c) => {
        const info = at === null ? undefined : merges.get(`${at}:${c}`);
        if (info?.isContinuation) return;
        if (info && (info.colSpan > 1 || info.rowSpan > 1) && isValidElement(cell)) {
          merged.push(
            cloneElement(cell as ReactElement<{ colSpan?: number; rowSpan?: number }>, {
              colSpan: info.colSpan,
              rowSpan: info.rowSpan,
            }),
          );
        } else {
          merged.push(cell);
        }
      });

      return cloneElement(row, {}, merged);
    });

    return cloneElement(section, {}, rebuiltRows);
  });
}

export const MarkdownBody = lazy(async () => {
  const [
    { default: ReactMarkdown, defaultUrlTransform },
    { default: remarkGfm },
    { default: remarkMath },
    { default: rehypeKatex },
  ] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
    import("remark-math"),
    import("rehype-katex"),
  ]);
  await import("katex/dist/katex.min.css");

  const urlTransform: UrlTransform = (value) =>
    value.startsWith("wiki:") ? value : defaultUrlTransform(value);

  function Preview({ components, children }: { components: Components; children: string }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkWikiLinks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    );
  }

  return { default: Preview };
});

/**
 * Imagen de la vista previa: mientras carga y si no la encuentra se avisa en
 * el sitio de dejar un hueco roto. La resolución a datos de imagen vive en
 * `useResolvedImage`, la misma que pinta las imágenes en el modo edición.
 */
export function PreviewImage({
  src,
  alt,
  notePath,
  vaultPath,
}: {
  src?: string;
  alt?: string;
  notePath: string;
  vaultPath: string | null;
}) {
  const t = useT();
  const estado = useResolvedImage(src, notePath, vaultPath);

  if (estado.fase === "listo") {
    // El ancho fijado vive en el propio texto alternativo («foto|300», estilo
    // Obsidian): se saca de aquí y se pinta tal cual. Sin ancho manda el tamaño
    // con tope de 70vh, como siempre.
    const { alt: texto, ancho } = splitImageAlt(alt ?? "");
    return (
      <img
        src={estado.url}
        alt={texto}
        loading="lazy"
        style={ancho !== null ? { width: `${ancho}px` } : undefined}
        className={clsx(
          "my-4 max-w-full rounded-lg border border-gus-border bg-gus-card object-contain",
          ancho === null && "max-h-[70vh]",
        )}
      />
    );
  }

  const nombre = splitImageAlt(alt ?? "").alt || (src ? decodeImageDest(src) : "");

  if (estado.fase === "fallo") {
    return (
      <span className="my-4 block break-words rounded-lg border border-dashed border-rose-400/40 bg-rose-400/5 px-3 py-2 text-xs text-rose-300">
        {t("editor.imageBroken", { name: nombre })}
      </span>
    );
  }

  return (
    <span className="my-4 block rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-xs text-gus-muted">
      {t("editor.imageLoading")}
    </span>
  );
}
