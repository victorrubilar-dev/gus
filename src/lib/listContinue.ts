export interface ListEnterEdit {
  start: number;
  end: number;
  insert: string;
  caret: number;
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(?:\[([ xX])\](?=\s|$)\s*)?(.*)$/;

export function listEnterEdit(text: string, caret: number): ListEnterEdit | null {
  if (caret < 0 || caret > text.length) return null;

  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const before = text.slice(lineStart, caret);
  if (before === "") return null;

  const match = LIST_RE.exec(before);
  if (!match) return null;

  const indent = match[1];
  const marker = match[2];
  const box = match[4] !== undefined;
  const content = match[5];

  if (content.trim() === "") {
    return { start: lineStart, end: caret, insert: "", caret: lineStart };
  }

  let nextMarker = marker;
  if (/^\d/.test(marker)) {
    nextMarker = `${Number(marker.slice(0, -1)) + 1}${marker.slice(-1)}`;
  }

  const insert = `\n${indent}${nextMarker} ${box ? "[ ] " : ""}`;

  return { start: caret, end: caret, insert, caret: caret + insert.length };
}
