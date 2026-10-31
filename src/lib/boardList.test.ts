import { describe, expect, it } from "vitest";
import { isBoardSort, listBoards, normalizeSearch } from "./boardList";

const board = (name: string, modifiedMs: number | null, pinned = false) => ({ name, modifiedMs, pinned });
const names = (list: { name: string }[]) => list.map((b) => b.name);

describe("listBoards", () => {
  const all = [board("Beta", 20), board("alfa", 30), board("Cero", 10), board("Fijada vieja", 1, true)];

  it("las más recientes primero, y las fijadas siempre arriba", () => {
    expect(names(listBoards(all, "", "recent"))).toEqual(["Fijada vieja", "alfa", "Beta", "Cero"]);
    expect(names(listBoards(all, "", "oldest"))).toEqual(["Fijada vieja", "Cero", "Beta", "alfa"]);
  });

  it("por nombre, sin distinguir mayúsculas, en los dos sentidos", () => {
    expect(names(listBoards(all, "", "name"))).toEqual(["Fijada vieja", "alfa", "Beta", "Cero"]);
    expect(names(listBoards(all, "", "nameDesc"))).toEqual(["Fijada vieja", "Cero", "Beta", "alfa"]);
  });

  it("busca por nombre sin mirar acentos ni mayúsculas", () => {
    const lista = [board("Ideas rápidas", 1), board("Plan", 2)];
    expect(names(listBoards(lista, "RAPIDAS", "recent"))).toEqual(["Ideas rápidas"]);
    expect(names(listBoards(lista, "  plan ", "recent"))).toEqual(["Plan"]);
    expect(listBoards(lista, "zzz", "recent")).toEqual([]);
  });

  it("los números se ordenan como números y lo que no tiene fecha va al final", () => {
    expect(names(listBoards([board("Pizarra 10", 1), board("Pizarra 2", 1)], "", "name"))).toEqual(["Pizarra 2", "Pizarra 10"]);
    expect(names(listBoards([board("sin fecha", null), board("con fecha", 5)], "", "recent"))).toEqual(["con fecha", "sin fecha"]);
  });

  it("no toca la lista original", () => {
    const copia = [...all];
    listBoards(all, "", "name");
    expect(all).toEqual(copia);
  });
});

describe("utilidades", () => {
  it("normaliza y valida el orden guardado", () => {
    expect(normalizeSearch("  Árbol ÑU ")).toBe("arbol nu");
    expect(isBoardSort("name")).toBe(true);
    expect(isBoardSort("otro")).toBe(false);
  });
});
