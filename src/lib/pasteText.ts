export function stripPasteFormatting(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^(\s*)(?:[-*+]\s+\[[ xX]\]|[-*+]|\d+\.)\s+/gm, "$1")
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/(\*|_)(?=\S)([^*_\n]*?\S)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n");
}
