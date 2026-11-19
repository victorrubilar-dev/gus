/** Índice de una nota: sus títulos ATX (`#` a `######`) fuera de los bloques de código. */

export interface OutlineHeading {
  level: number;
  text: string;
  /** Línea (1-based) dentro del texto analizado: la misma que da react-markdown. */
  line: number;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** Texto legible del título: sin énfasis, código ni sintaxis de enlaces. */
function plainText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .trim();
}

export function noteOutline(body: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  let fence: string | null = null;

  body.split(/\r?\n/).forEach((line, index) => {
    const marker = FENCE_RE.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;

    const match = HEADING_RE.exec(line);
    // `# ##` es un título vacío: lo que queda son solo las almohadillas de cierre.
    const text = match && !/^#+$/.test(match[2]) ? plainText(match[2]) : "";
    if (match && text) headings.push({ level: match[1].length, text, line: index + 1 });
  });

  return headings;
}
