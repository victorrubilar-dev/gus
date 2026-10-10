import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  canSearch,
  endOfDayMs,
  folderOfRelative,
  filtersActive,
  relativeNotePath,
  searchTerms,
  snippetHits,
  snippetText,
  startOfDayMs,
  type SearchSnippet,
} from "./searchIndex";

describe("searchTerms", () => {
  it("parte la consulta en minúsculas, sin huecos ni repetidos", () => {
    expect(searchTerms("  Revolución   INDUSTRIAL  ")).toEqual(["revolución", "industrial"]);
  });

  it("no deja pasar consultas vacías o de solo espacios", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms("   \t  ")).toEqual([]);
  });

  it("canSearch solo dice que sí cuando hay término", () => {
    expect(canSearch("hola")).toBe(true);
    expect(canSearch("  h  ")).toBe(true);
    expect(canSearch("   ")).toBe(false);
  });
});

describe("filtros", () => {
  it("los filtros por defecto no están activos", () => {
    expect(filtersActive(EMPTY_FILTERS)).toBe(false);
  });

  it("cualquier filtro puesto se cuenta como activo", () => {
    expect(filtersActive({ ...EMPTY_FILTERS, folder: "Clases" })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, tags: ["examen"] })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, modifiedAfterMs: 1 })).toBe(true);
    expect(filtersActive({ ...EMPTY_FILTERS, modifiedBeforeMs: 1 })).toBe(true);
  });
});

describe("fragmentos", () => {
  const snippet: SearchSnippet = {
    line: 12,
    segments: [
      { text: "La ", hit: false },
      { text: "Revolución", hit: true },
      { text: " empezó en ", hit: false },
      { text: "Inglaterra", hit: true },
    ],
  };

  it("recompone el texto original sin la marca", () => {
    expect(snippetText(snippet)).toBe("La Revolución empezó en Inglaterra");
  });

  it("cuenta los aciertos, no los segmentos", () => {
    expect(snippetHits(snippet)).toBe(2);
    expect(snippetHits({ line: 1, segments: [{ text: "nada", hit: false }] })).toBe(0);
  });
});

describe("rutas relativas", () => {
  it("quita la raíz del vault y unifica con barra", () => {
    expect(relativeNotePath("/vault", "/vault/Clases/Historia.md")).toBe("Clases/Historia.md");
    expect(relativeNotePath("/vault/", "/vault/Suelta.md")).toBe("Suelta.md");
  });

  it("en Windows usa barra invertida y devuelve barra recta", () => {
    expect(relativeNotePath("C:\\vault", "C:\\vault\\Clases\\Una.md")).toBe("Clases/Una.md");
  });

  it("rechaza lo que no esté dentro del vault", () => {
    expect(relativeNotePath("/vault", "/otralado/Una.md")).toBeNull();
    expect(relativeNotePath("/vault", "/vault")).toBeNull();
  });

  it("la carpeta de una nota en la raíz es vacía", () => {
    expect(folderOfRelative("Suelta.md")).toBe("");
    expect(folderOfRelative("Clases/Semana 1/Una.md")).toBe("Clases/Semana 1");
  });
});

describe("fechas del filtro", () => {
  it("un día cubre de la primera a la última milésima, en local", () => {
    const start = startOfDayMs("2026-10-09");
    const end = endOfDayMs("2026-10-09");
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(end! - start!).toBe(24 * 60 * 60 * 1000 - 1);
    expect(new Date(start!).getDate()).toBe(9);
  });

  it("una fecha imposible no produce rango", () => {
    expect(startOfDayMs("2026-02-31")).toBeNull();
    expect(endOfDayMs("2026-13-01")).toBeNull();
    expect(startOfDayMs("09/10/2026")).toBeNull();
    expect(startOfDayMs("")).toBeNull();
  });
});
