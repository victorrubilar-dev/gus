import { describe, expect, it } from "vitest";
import {
  backlinksTo,
  graphFolder,
  incomingCountMap,
  outgoingFrom,
  resolveGraphNode,
  type LinkGraph,
  type LinkNode,
} from "./linkGraph";

function node(relative: string, links: [string, number][], tags: string[] = []): LinkNode {
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  return {
    name,
    path: `/vault/${relative}`,
    relative,
    tags,
    links: links.map(([target, count]) => ({ target, count })),
  };
}

const graph: LinkGraph = {
  generatedMs: 0,
  nodes: [
    node("Ideas.md", [["Proyecto", 2], ["Falta", 1]]),
    node("Notas/Proyecto.md", [["Ideas", 1]]),
    node("Notas/Otra.md", [["Ideas|mis ideas", 3], ["Inexistente", 1]]),
  ],
};

describe("resolución de destinos", () => {
  it("resuelve por título completo antes que por nombre base", () => {
    expect(resolveGraphNode(graph.nodes, "Notas/Proyecto")?.relative).toBe("Notas/Proyecto.md");
    expect(resolveGraphNode(graph.nodes, "Proyecto")?.relative).toBe("Notas/Proyecto.md");
  });

  it("ignora la extensión, el alias no existe en el destino y lo vacío no resuelve", () => {
    expect(resolveGraphNode(graph.nodes, "Ideas.md")?.relative).toBe("Ideas.md");
    expect(resolveGraphNode(graph.nodes, "")).toBeNull();
    expect(resolveGraphNode(graph.nodes, "Nada")?.relative).toBeUndefined();
  });

  it("lee las carpetas de cada nota", () => {
    expect(graphFolder(node("Notas/Proyecto.md", []))).toBe("Notas");
    expect(graphFolder(node("Suelta.md", []))).toBe("");
  });
});

describe("enlaces entrantes", () => {
  it("cuenta las menciones de cada nota que enlaza", () => {
    const backlinks = backlinksTo(graph, "/vault/Ideas.md");
    expect(backlinks.map((entry) => entry.node.relative)).toEqual(["Notas/Otra.md", "Notas/Proyecto.md"]);
    expect(backlinks[0].count).toBe(3);
    expect(backlinks[1].count).toBe(1);
  });

  it("las menciones repetidas de una misma nota se suman", () => {
    const duplicated: LinkGraph = {
      generatedMs: 0,
      nodes: [node("A.md", [["B", 2], ["b|alias", 3]]), node("B.md", [])],
    };
    expect(backlinksTo(duplicated, "/vault/B.md")[0].count).toBe(5);
  });

  it("sin grafo no hay nada que mostrar", () => {
    expect(backlinksTo(null, "/vault/Ideas.md")).toEqual([]);
  });
});

describe("enlaces salientes", () => {
  it("resuelve los que apuntan a una nota y deja los rotos sin resolver", () => {
    const outgoing = outgoingFrom(graph, "/vault/Ideas.md");
    expect(outgoing.map((entry) => entry.target)).toEqual(["Proyecto", "Falta"]);
    expect(outgoing[0].resolved?.relative).toBe("Notas/Proyecto.md");
    expect(outgoing[1].resolved).toBeNull();
  });

  it("una nota sin enlaces (o inexistente) sale vacía", () => {
    expect(outgoingFrom(graph, "/vault/Inexistente.md")).toEqual([]);
  });
});

describe("contador del editor", () => {
  it("reúne cuántas veces se enlaza cada nota", () => {
    expect(incomingCountMap(graph)).toEqual({
      "/vault/Ideas.md": 4,
      "/vault/Notas/Proyecto.md": 2,
    });
  });

  it("sin grafo devuelve un mapa vacío", () => {
    expect(incomingCountMap(null)).toEqual({});
  });
});
