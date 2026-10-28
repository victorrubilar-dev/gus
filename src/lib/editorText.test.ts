import { describe, expect, it } from "vitest";
import { countWords, lineRangeAt } from "./editorText";

describe("countWords", () => {
  it("cuenta palabras separadas por cualquier espacio", () => {
    expect(countWords("uno  dos\ntres\tcuatro")).toBe(4);
  });

  it("no cuenta nada en un texto vacío o solo con espacios", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });
});

describe("lineRangeAt", () => {
  const texto = "primera\nsegunda\ntercera";

  it("devuelve la línea con su salto final", () => {
    expect(lineRangeAt(texto, 2)).toEqual([0, 8]);
    expect(lineRangeAt(texto, 10)).toEqual([8, 16]);
  });

  it("la última línea llega hasta el final sin salto", () => {
    expect(lineRangeAt(texto, texto.length)).toEqual([16, texto.length]);
  });

  it("en la posición 0 empieza en 0", () => {
    expect(lineRangeAt(texto, 0)).toEqual([0, 8]);
  });
});
