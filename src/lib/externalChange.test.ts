import { describe, expect, it } from "vitest";
import { externalAction } from "./externalChange";

describe("externalAction", () => {
  it("ignora el eco de lo que ya está guardado", () => {
    expect(externalAction("a", "a", false)).toBe("ignore");
    expect(externalAction("a", "a", true)).toBe("ignore");
  });

  it("recarga si cambió fuera y no hay nada sin guardar", () => {
    expect(externalAction("b", "a", false)).toBe("reload");
  });

  it("avisa de conflicto si cambió fuera y hay texto sin guardar", () => {
    expect(externalAction("b", "a", true)).toBe("conflict");
  });
});
