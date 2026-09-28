import { toLocalCoord } from "./uiZoom";

export interface CaretAnchor {
  top: number;
  left: number;
  height: number;
}

const MIRRORED_STYLES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "letter-spacing",
  "line-height",
  "word-spacing",
  "text-transform",
  "text-indent",
  "box-sizing",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
] as const;

export function caretAnchor(textarea: HTMLTextAreaElement, caret: number): CaretAnchor {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");

  mirror.setAttribute("aria-hidden", "true");
  mirror.style.position = "fixed";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  for (const property of MIRRORED_STYLES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }

  mirror.textContent = textarea.value.slice(0, caret);

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  try {
    const rect = textarea.getBoundingClientRect();
    return {
      top: toLocalCoord(rect.top) + marker.offsetTop - textarea.scrollTop,
      left: toLocalCoord(rect.left) + marker.offsetLeft - textarea.scrollLeft,
      height: marker.offsetHeight || 18,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}

export function lineAtCaret(text: string, caret: number): string {
  const from = caret <= 0 ? 0 : text.lastIndexOf("\n", caret - 1) + 1;
  const to = text.indexOf("\n", caret);
  return text.slice(from, to === -1 ? text.length : to);
}
