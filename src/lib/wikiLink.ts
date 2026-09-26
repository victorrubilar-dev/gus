// La extensión a la vista es necesaria para que los smoke tests con Node (sin el resolutor de Vite) puedan importar este módulo.
import { safeFileName } from "./fileName.ts";

export interface WikiNote {
  name: string;
  path: string;
  relative: string;
}

export interface WikiTarget {
  target: string;
  label: string;
}

export function normalizeWikiText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function stripMdExtension(value: string): string {
  return value.replace(/\.md$/i, "");
}

export function wikiNoteTitle(note: WikiNote): string {
  return stripMdExtension(note.relative);
}

export function wikiNoteBaseTitle(note: WikiNote): string {
  return stripMdExtension(note.name);
}

export function wikiNoteFolder(note: WikiNote): string {
  const slash = note.relative.lastIndexOf("/");
  return slash === -1 ? "raíz" : note.relative.slice(0, slash);
}

export function parseWikiLink(raw: string): WikiTarget | null {
  const pipe = raw.indexOf("|");
  const target = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
  if (!target) return null;

  const alias = (pipe === -1 ? target : raw.slice(pipe + 1).trim()) || target;
  return { target, label: alias };
}

export function findWikiNote(notes: readonly WikiNote[], target: string): WikiNote | null {
  const wanted = normalizeWikiText(stripMdExtension(target));
  if (!wanted) return null;

  let byTitle: WikiNote | null = null;
  for (const note of notes) {
    if (normalizeWikiText(wikiNoteTitle(note)) === wanted) return note;
    if (byTitle === null && normalizeWikiText(wikiNoteBaseTitle(note)) === wanted) {
      byTitle = note;
    }
  }

  return byTitle;
}

export function wikiMatches(notes: readonly WikiNote[], query: string, limit = 8): WikiNote[] {
  const wanted = normalizeWikiText(stripMdExtension(query));
  const scored: { note: WikiNote; score: number }[] = [];

  for (const note of notes) {
    const base = normalizeWikiText(wikiNoteBaseTitle(note));
    const full = normalizeWikiText(wikiNoteTitle(note));

    if (!wanted) {
      scored.push({ note, score: 0 });
      continue;
    }

    let score = -1;
    if (base.startsWith(wanted)) score = 0;
    else if (full.startsWith(wanted)) score = 1;
    else if (base.includes(wanted)) score = 2;
    else if (full.includes(wanted)) score = 3;

    if (score >= 0) scored.push({ note, score });
  }

  scored.sort(
    (a, b) => a.score - b.score || a.note.relative.localeCompare(b.note.relative),
  );
  return scored.slice(0, limit).map((entry) => entry.note);
}

export function wikiInsertText(notes: readonly WikiNote[], note: WikiNote): string {
  const base = wikiNoteBaseTitle(note);
  const ambiguous = notes.some(
    (other) => other.path !== note.path && wikiNoteBaseTitle(other) === base,
  );
  return `[[${ambiguous ? wikiNoteTitle(note) : base}]]`;
}

export function wikiTargetToPath(target: string): string | null {
  const cleaned = stripMdExtension(target)
    .trim()
    .replace(/\\/g, "/");

  const segments = cleaned
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "" && segment !== "." && segment !== "..")
    .map((segment) => safeFileName(segment))
    .filter((segment) => segment !== "");

  return segments.length > 0 ? segments.join("/") : null;
}

export function encodeWikiUrl(target: string): string {
  return `wiki:${encodeURIComponent(target)}`;
}

export function decodeWikiUrl(href: string): string | null {
  if (!href.startsWith("wiki:")) return null;

  const raw = href.slice("wiki:".length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return raw;
  }
}

export function detectWikiQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /\[\[([^\[\]\n]*)$/.exec(before);
  if (!match) return null;

  return { start: caret - match[1].length - 2, query: match[1] };
}

export function detectSlashQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)\/([^\s]*)$/.exec(before);
  if (!match) return null;

  return { start: caret - match[1].length - 1, query: match[1] };
}

interface WikiMdastNode {
  type: string;
  value?: string;
  url?: string;
  title?: string;
  children?: WikiMdastNode[];
}

const WIKI_LINK = /\[\[([^\[\]\n]+)\]\]/g;

export function remarkWikiLinks() {
  return (tree: WikiMdastNode) => transformWikiChildren(tree);
}

function transformWikiChildren(node: WikiMdastNode): void {
  if (!node.children) return;

  const next: WikiMdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string" && child.value.includes("[[")) {
      next.push(...splitWikiText(child.value));
    } else {
      transformWikiChildren(child);
      next.push(child);
    }
  }
  node.children = next;
}

function splitWikiText(value: string): WikiMdastNode[] {
  const out: WikiMdastNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  WIKI_LINK.lastIndex = 0;
  while ((match = WIKI_LINK.exec(value)) !== null) {
    const parsed = parseWikiLink(match[1]);
    if (!parsed) continue;

    if (match.index > last) out.push({ type: "text", value: value.slice(last, match.index) });
    out.push({
      type: "link",
      url: encodeWikiUrl(parsed.target),
      title: parsed.target,
      children: [{ type: "text", value: parsed.label }],
    });
    last = match.index + match[0].length;
  }

  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out;
}
