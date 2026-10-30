import { describe, expect, it } from "vitest";
import { safeTableCaret } from "./tableLayout";

describe("safeTableCaret", () => {
  const tabla = "| a | b |\n|---|---|\n| 1 | 2 |";

  it("deja el cursor donde está si no hay tabla", () => {
    expect(safeTableCaret("texto suelto", 3)).toBe(3);
  });

  it("deja el cursor dentro de una celda", () => {
    expect(safeTableCaret(tabla, 3)).toBe(3);
  });

  it("mete dentro de la primera celda un cursor que cae en el separador", () => {
    const enSeparador = tabla.indexOf("---");
    expect(safeTableCaret(tabla, enSeparador)).toBeLessThan(enSeparador);
    expect(safeTableCaret(tabla, enSeparador)).toBeGreaterThan(0);
  });
});
