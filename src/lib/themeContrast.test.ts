import css from "../App.css?raw";
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

const mezcla = (a: string, b: string, t: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, "0")).join("");

// Los tonos de Tailwind que App.css redefine en esquema claro (etiquetas, prioridades, errores)
// se pintan como texto sobre la superficie, a veces con un 15 % de su propio color de fondo.
describe("contraste de los colores de texto en esquema claro", () => {
  const bloque = css.match(/html\[data-scheme="light"\] \{([^}]*)\}/)?.[1] ?? "";
  const colores = [...bloque.matchAll(/--color-([a-z]+-\d+): (#[0-9a-f]{6});/g)];

  it("hay colores que comprobar", () => expect(colores.length).toBeGreaterThan(0));

  for (const tema of THEME_LIST.filter((t) => t.scheme === "light")) {
    it(tema.key, () => {
      const fallos: string[] = [];
      for (const [, nombre, color] of colores) {
        // rose-400 se usa con un 80 % de opacidad, solo sobre la superficie.
        const alfa = nombre === "rose-400" ? 0.8 : 1;
        for (const superficie of ["bg", "panel", "card"]) {
          const fondo = tema.vars[`--color-gus-${superficie}`];
          for (const tinte of alfa === 1 ? [0, 0.15] : [0]) {
            const ratio = contrast(mezcla(fondo, color, alfa), mezcla(fondo, color, tinte));
            if (ratio < 4.5) fallos.push(`${nombre} sobre ${superficie} (tinte ${tinte}): ${ratio.toFixed(2)}`);
          }
        }
      }
      expect(fallos).toEqual([]);
    });
  }
});
