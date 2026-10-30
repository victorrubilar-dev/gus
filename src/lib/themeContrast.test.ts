import { describe, expect, it } from "vitest";
import { THEME_LIST } from "./themes";

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// WCAG AA para texto menor de 18 px: 4,5:1 del texto, del secundario y del acento sobre cada superficie.
describe("contraste de los temas", () => {
  for (const theme of THEME_LIST) {
    it(theme.key, () => {
      const fallos: string[] = [];
      for (const surface of ["bg", "panel", "card"]) {
        const fondo = theme.vars[`--color-gus-${surface}`];
        const textos = { text: theme.vars["--color-gus-text"], muted: theme.vars["--color-gus-muted"], accent: theme.accent };
        for (const [nombre, color] of Object.entries(textos)) {
          const ratio = contrast(color, fondo);
          if (ratio < 4.5) fallos.push(`${nombre} sobre ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(fallos).toEqual([]);
    });
  }
});
