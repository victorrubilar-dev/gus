interface CaretLocator {
  caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
}

let charWidthCache: { font: string; px: number } | null = null;

export function offsetAtPointer(
  area: HTMLTextAreaElement,
  x: number,
  y: number,
): number | null {
  const native = nativeOffset(area, x, y);
  if (native !== null) return native <= area.value.length ? native : null;
  return geometricOffset(area, x, y);
}

function nativeOffset(area: HTMLTextAreaElement, x: number, y: number): number | null {
  const doc = document as unknown as CaretLocator;
  let node: Node | null = null;
  let offset = 0;

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const position = doc.caretPositionFromPoint(x, y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  }

  if (node === null) return null;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement === area ? offset : null;
  return node === area ? offset : null;
}

function geometricOffset(area: HTMLTextAreaElement, x: number, y: number): number | null {
  const value = area.value;
  if (value.includes("\t")) return null;

  const rect = area.getBoundingClientRect();
  const view = getComputedStyle(area);
  const lineHeight = Number.parseFloat(view.lineHeight);
  const padLeft = Number.parseFloat(view.paddingLeft) || 0;
  const padTop = Number.parseFloat(view.paddingTop) || 0;
  const padRight = Number.parseFloat(view.paddingRight) || 0;
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;

  const charWidth = measureCharWidth(view);
  if (!charWidth) return null;

  const cap = Math.max(1, Math.floor((area.clientWidth - padLeft - padRight) / charWidth));
  const lines = value.split("\n");

  const row = Math.floor((y - rect.top - padTop + area.scrollTop) / lineHeight);
  if (row < 0) return 0;

  let lineIndex = 0;
  let rowsBefore = 0;
  while (lineIndex < lines.length) {
    const rows = wrapStarts(lines[lineIndex], cap).length;
    if (rowsBefore + rows > row) break;
    rowsBefore += rows;
    lineIndex += 1;
  }
  if (lineIndex >= lines.length) return value.length;

  const starts = wrapStarts(lines[lineIndex], cap);
  const rowStart = starts[Math.min(row - rowsBefore, starts.length - 1)];
  const column = Math.max(
    0,
    Math.floor((x - rect.left - padLeft + area.scrollLeft) / charWidth),
  );
  const indexInLine = Math.min(rowStart + column, lines[lineIndex].length);

  let offset = 0;
  for (let i = 0; i < lineIndex; i++) offset += lines[i].length + 1;
  return offset + indexInLine;
}

function wrapStarts(line: string, cap: number): number[] {
  const starts = [0];
  if (line.length <= cap) return starts;

  let rowStart = 0;
  let lastSpace = -1;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === " ") lastSpace = i;
    if (i - rowStart < cap) continue;

    const breakAt = lastSpace > rowStart ? lastSpace + 1 : i;
    starts.push(breakAt);
    rowStart = breakAt;
    lastSpace = -1;
    i = breakAt - 1; // la siguiente vuelta relee la fila que acaba de empezar
  }
  return starts;
}

function measureCharWidth(view: CSSStyleDeclaration): number | null {
  const font = `${view.fontStyle} ${view.fontWeight} ${view.fontSize} ${view.fontFamily}`;
  if (charWidthCache && charWidthCache.font === font) return charWidthCache.px;

  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  context.font = font;
  const px = context.measureText("MMMMMMMMMM").width / 10;
  if (!Number.isFinite(px) || px <= 0) return null;

  charWidthCache = { font, px };
  return px;
}
