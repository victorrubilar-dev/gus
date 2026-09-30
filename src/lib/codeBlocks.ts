/** Línea ya clasificada por `classifySource` (compatible structuralmente). */
export interface SourceLineLike {
  text: string;
  fence: boolean;
  code: boolean;
}

export interface CodeBlockInfo {
  /** Primera línea del bloque: la valla de apertura (``` o ~~~). */
  start: number;
  /** Última línea: la valla de cierre, o la última de la nota si quedó sin cerrar. */
  end: number;
  /** Lenguaje escrito en la valla («python», «js»…); `null` si no lo trae. */
  language: string | null;
  /** Contenido sin las vallas: exactamente lo que se copia al portapapeles. */
  text: string;
}

/** Valla con lenguaje: captura lo que hay justo después de ``` o ~~~. */
const FENCE_WITH_LANG = /^\s*(?:`{3,}|~{3,})[ \t]*([^\s`]*)/;

/**
 * Localiza los bloques de código de la nota con la misma segmentación que usa
 * `classifySource` en el overlay: entre la valla de apertura y la de cierre
 * (o el fin del documento). Tanto el overlay (para pintar el bloque y el
 * botón «copiar») como la vista previa lo usan, así ambos ven lo mismo.
 */
export function codeBlocks(lines: readonly SourceLineLike[]): CodeBlockInfo[] {
  const blocks: CodeBlockInfo[] = [];
  let open = false;
  let start = 0;
  let language: string | null = null;
  let body: string[] = [];

  lines.forEach((line, index) => {
    if (!open) {
      // `code` sin bloque abierto: es la valla de apertura (así lo marca
      // classifySource, que solo enciende `code` con una valla o dentro).
      if (!line.code) return;
      open = true;
      start = index;
      language = FENCE_WITH_LANG.exec(line.text)?.[1] || null;
      body = [];
      return;
    }

    if (line.fence) {
      // Valla de cierre: el bloque queda cerrado con su contenido.
      blocks.push({ start, end: index, language, text: body.join("\n") });
      open = false;
      return;
    }

    body.push(line.text);
  });

  if (open) {
    blocks.push({ start, end: lines.length - 1, language, text: body.join("\n") });
  }

  return blocks;
}
