import { describe, expect, it } from "vitest";
import { formatSelection } from "./textFormat";

describe("formatSelection", () => {
  it("envuelve la selección con los marcadores", () => {
    expect(formatSelection("bold", "hola")).toEqual({ text: "**hola**", caret: 8 });
    expect(formatSelection("italic", "hola").text).toBe("*hola*");
    expect(formatSelection("strike", "hola").text).toBe("~~hola~~");
    expect(formatSelection("code", "hola").text).toBe("`hola`");
  });

  it("repetir el formato lo quita", () => {
    expect(formatSelection("bold", "**hola**")).toEqual({ text: "hola", caret: 4 });
  });

  it("no confunde marcadores sueltos con un envoltorio", () => {
    expect(formatSelection("code", "`").text).toBe("```");
  });

  it("sin selección deja el cursor entre los marcadores", () => {
    expect(formatSelection("bold", "")).toEqual({ text: "****", caret: 2 });
    expect(formatSelection("code", "")).toEqual({ text: "``", caret: 1 });
  });

  it("el enlace deja el cursor dentro de los paréntesis", () => {
    expect(formatSelection("link", "web")).toEqual({ text: "[web]()", caret: 6 });
    expect(formatSelection("link", "")).toEqual({ text: "[]()", caret: 3 });
  });
});
