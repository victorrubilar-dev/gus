import { describe, expect, it } from "vitest";
import { MIN_COL_WIDTH, clampColumnWidths, sameWidths } from "./editorMeasure";

describe("sameWidths", () => {
  it("compara longitud y valores", () => {
    expect(sameWidths([1, 2], [1, 2])).toBe(true);
    expect(sameWidths([1, 2], [1, 3])).toBe(false);
    expect(sameWidths([1], [1, 2])).toBe(false);
    expect(sameWidths(undefined, [1])).toBe(false);
  });
});

describe("clampColumnWidths", () => {
  it("no toca lo que ya cabe", () => {
    expect(clampColumnWidths([100, 100], 300)).toEqual([100, 100]);
  });

  it("encoge en proporción hasta caber", () => {
    const next = clampColumnWidths([200, 100], 150);
    expect(next.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(150);
    expect(next[0]).toBeGreaterThan(next[1]);
  });

  it("ninguna columna baja del mínimo", () => {
    const next = clampColumnWidths([100, 100, 100], 10);
    expect(next.every((w) => w >= MIN_COL_WIDTH)).toBe(true);
  });
});
