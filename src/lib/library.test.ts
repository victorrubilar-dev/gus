import { describe, expect, it } from "vitest";
import {
  addShelf,
  assignShelf,
  EMPTY_LIBRARY,
  filterPdfs,
  removeShelf,
  renameShelf,
  shelfOf,
  type VaultPdf,
} from "./library";

const pdf = (relative: string): VaultPdf => ({
  name: relative.split("/").pop() ?? relative,
  path: `/v/${relative}`,
  relative,
  modified_ms: 0,
});

describe("estanterías", () => {
  it("añade sin repetir ni aceptar vacíos", () => {
    let store = addShelf(EMPTY_LIBRARY, "  Clases ");
    store = addShelf(store, "clases");
    store = addShelf(store, "   ");
    expect(store.shelves).toEqual(["Clases"]);
  });

  it("renombrar mueve sus PDF y no choca con otra estantería", () => {
    let store = addShelf(addShelf(EMPTY_LIBRARY, "Clases"), "Libros");
    store = assignShelf(store, "a.pdf", "Clases");
    expect(renameShelf(store, "Clases", "libros")).toBe(store);
    const renamed = renameShelf(store, "Clases", "Cursos");
    expect(renamed.shelves).toEqual(["Cursos", "Libros"]);
    expect(renamed.assign["a.pdf"]).toBe("Cursos");
  });

  it("permite cambiar solo las mayúsculas del nombre", () => {
    const store = addShelf(EMPTY_LIBRARY, "clases");
    expect(renameShelf(store, "clases", "Clases").shelves).toEqual(["Clases"]);
  });

  it("borrar una estantería suelta sus PDF sin perderlos", () => {
    let store = assignShelf(addShelf(EMPTY_LIBRARY, "Clases"), "a.pdf", "Clases");
    store = removeShelf(store, "Clases");
    expect(store.assign).toEqual({});
    expect(filterPdfs([pdf("a.pdf")], store, { kind: "none" })).toHaveLength(1);
  });

  it("una asignación a una estantería inexistente cuenta como suelta", () => {
    const store = { shelves: [], assign: { "a.pdf": "Fantasma" } };
    expect(shelfOf(store, "a.pdf")).toBeNull();
  });

  it("filtra por todos, sueltos y estantería", () => {
    const store = assignShelf(addShelf(EMPTY_LIBRARY, "Clases"), "a.pdf", "Clases");
    const pdfs = [pdf("a.pdf"), pdf("b.pdf")];
    expect(filterPdfs(pdfs, store, { kind: "all" })).toHaveLength(2);
    expect(filterPdfs(pdfs, store, { kind: "none" }).map((p) => p.relative)).toEqual(["b.pdf"]);
    expect(filterPdfs(pdfs, store, { kind: "shelf", name: "Clases" }).map((p) => p.relative)).toEqual(["a.pdf"]);
  });
});
