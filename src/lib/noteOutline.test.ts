import { describe, expect, it } from "vitest";
import { noteOutline } from "./noteOutline";

describe("índice de la nota", () => {
  it("saca los títulos con su nivel y su línea", () => {
    expect(noteOutline("# Uno\ntexto\n## Dos ##\n###### Seis")).toEqual([
      { level: 1, text: "Uno", line: 1 },
      { level: 2, text: "Dos", line: 3 },
      { level: 6, text: "Seis", line: 4 },
    ]);
  });

  it("ignora lo que hay dentro de bloques de código y lo que no es un título", () => {
    const body = "```md\n# dentro\n```\n#sin-espacio\n####### siete\n~~~\n## tampoco\n~~~\n## Fuera";
    expect(noteOutline(body).map((h) => h.text)).toEqual(["Fuera"]);
  });

  it("limpia énfasis, código y enlaces del texto", () => {
    expect(noteOutline("## **Plan** con `código`, [[nota|alias]], [[otra]] y [web](https://x.y)")[0].text).toBe(
      "Plan con código, alias, otra y web",
    );
  });

  it("un título vacío no entra", () => {
    expect(noteOutline("## \n# ##")).toEqual([]);
  });
});
