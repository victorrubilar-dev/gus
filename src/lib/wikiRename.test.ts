import { describe, expect, it } from "vitest";
import { planLinkRewrites, rewriteWikiLinks, type LinkingNote } from "./wikiRename";

const V = "/v";

function note(relative: string, ...targets: string[]): LinkingNote {
  return {
    path: `${V}/${relative}`,
    name: relative.split("/").pop()!,
    relative,
    links: targets.map((target) => ({ target })),
  };
}

function plan(notes: LinkingNote[], from: string, to: string) {
  return planLinkRewrites(notes, V, [{ from: `${V}/${from}`, to: `${V}/${to}` }]).map((entry) => ({
    path: entry.path,
    targets: Object.fromEntries(entry.targets),
  }));
}

describe("planLinkRewrites", () => {
  it("renombrar una nota reescribe quien la enlaza, sin distinguir mayúsculas ni tildes", () => {
    const notes = [note("Nueva.md"), note("Otra.md", "Vieja", "Sin destino")];
    expect(plan(notes, "Vieja.md", "Nueva.md")).toEqual([{ path: `${V}/Otra.md`, targets: { vieja: "Nueva" } }]);
    expect(plan([note("Nueva.md"), note("Otra.md", "MÉTODOS")], "Métodos.md", "Nueva.md")).toEqual([
      { path: `${V}/Otra.md`, targets: { metodos: "Nueva" } },
    ]);
  });

  it("mover una nota no toca un enlace por nombre que sigue resolviendo", () => {
    expect(plan([note("B/Nota.md"), note("Otra.md", "Nota")], "A/Nota.md", "B/Nota.md")).toEqual([]);
  });

  it("un enlace con carpeta pasa a la carpeta nueva al mover la carpeta", () => {
    const notes = [note("Clases/Nota.md"), note("Otra.md", "Apuntes/Nota")];
    expect(plan(notes, "Apuntes", "Clases")).toEqual([{ path: `${V}/Otra.md`, targets: { "apuntes/nota": "Nota" } }]);
  });

  it("si el nombre queda repetido usa la ruta para no apuntar a otra nota", () => {
    const notes = [note("X/Nota.md"), note("Nota.md"), note("Otra.md", "Y/Nota", "Nota")];
    // Y/Nota → X/Nota: «Nota» sola ya apuntaría a la de la raíz.
    expect(plan(notes, "Y/Nota.md", "X/Nota.md")).toEqual([{ path: `${V}/Otra.md`, targets: { "y/nota": "X/Nota" } }]);
  });

  it("la propia nota movida también se reescribe si se enlazaba con la ruta vieja", () => {
    expect(plan([note("B/Nota.md", "A/Nota")], "A/Nota.md", "B/Nota.md")).toEqual([
      { path: `${V}/B/Nota.md`, targets: { "a/nota": "Nota" } },
    ]);
  });
});

describe("rewriteWikiLinks", () => {
  const targets = new Map([["vieja", "Nueva"]]);

  it("conserva el alias y respeta mayúsculas o .md en el original", () => {
    expect(rewriteWikiLinks("Ver [[Vieja]], [[vieja.md|esta]] y [[ Vieja |otra]].", targets)).toBe(
      "Ver [[Nueva]], [[Nueva|esta]] y [[Nueva|otra]].",
    );
  });

  it("no toca código en línea ni bloques cercados", () => {
    const text = "`[[Vieja]]` [[Vieja]]\n```md\n[[Vieja]]\n```\n~~~~\n[[Vieja]]\n~~~\n~~~~\n[[Vieja]]";
    expect(rewriteWikiLinks(text, targets)).toBe(
      "`[[Vieja]]` [[Nueva]]\n```md\n[[Vieja]]\n```\n~~~~\n[[Vieja]]\n~~~\n~~~~\n[[Nueva]]",
    );
  });

  it("deja igual lo que no está en la lista y los finales de línea CRLF", () => {
    expect(rewriteWikiLinks("[[Otra]]\r\n[[Vieja]]\r\n", targets)).toBe("[[Otra]]\r\n[[Nueva]]\r\n");
  });
});
