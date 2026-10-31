import { describe, expect, it } from "vitest";
import { copyName } from "./boardNames";

describe("copyName", () => {
  it("añade el sufijo y numera si ya existe", () => {
    expect(copyName("Plan", ["Plan"], "copia")).toBe("Plan (copia)");
    expect(copyName("Plan", ["Plan", "Plan (copia)"], "copia")).toBe("Plan (copia 2)");
    expect(copyName("Plan", ["Plan", "Plan (copia)", "Plan (copia 2)"], "copia")).toBe("Plan (copia 3)");
  });

  it("copiar una copia no encadena sufijos y no distingue mayúsculas", () => {
    expect(copyName("Plan (copia)", ["Plan", "Plan (copia)"], "copia")).toBe("Plan (copia 2)");
    expect(copyName("Plan (copia 2)", ["PLAN (COPIA)"], "copia")).toBe("Plan (copia 2)");
  });
});
