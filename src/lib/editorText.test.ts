import { describe, expect, it } from "vitest";
import { countWords, deletionRange, lineRangeAt } from "./editorText";

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

describe("deletionRange", () => {
  it("borra la selección tal cual", () => {
    expect(deletionRange("hola mundo", 2, 6, true, false)).toEqual([2, 6]);
  });

  it("Backspace borra un carácter y no sale del inicio", () => {
    expect(deletionRange("abc", 2, 2, true, false)).toEqual([1, 2]);
    expect(deletionRange("abc", 0, 0, true, false)).toEqual([0, 0]);
  });

  it("Supr borra un carácter y no sale del final", () => {
    expect(deletionRange("abc", 1, 1, false, false)).toEqual([1, 2]);
    expect(deletionRange("abc", 3, 3, false, false)).toEqual([3, 3]);
  });

  it("con Ctrl borra una palabra y nunca cruza el salto de línea", () => {
    expect(deletionRange("uno dos", 7, 7, true, true)).toEqual([4, 7]);
    expect(deletionRange("uno\ndos", 4, 4, true, true)).toEqual([4, 4]);
    expect(deletionRange("uno dos", 0, 0, false, true)).toEqual([0, 3]);
  });
});
