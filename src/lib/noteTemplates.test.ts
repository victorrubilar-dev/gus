import { describe, expect, it } from "vitest";
import { templatesIn } from "./noteTemplates";

describe("plantillas de nota", () => {
  const notes = [
    { relative: "Plantillas/reunion.md" },
    { relative: "plantillas/sub/libro.md" },
    { relative: "Plantillas.md" },
    { relative: "otra/Plantillas/x.md" },
    { relative: "PlantillasViejas/y.md" },
  ];

  it("toma las notas de la carpeta y sus subcarpetas, sin mirar mayúsculas", () => {
    expect(templatesIn(notes, "Plantillas").map((n) => n.relative)).toEqual([
      "Plantillas/reunion.md",
      "plantillas/sub/libro.md",
    ]);
  });

  it("acepta carpetas anidadas y separadores de Windows", () => {
    expect(templatesIn([{ relative: "a\\b\\c.md" }], "a/b")).toHaveLength(1);
  });
});
