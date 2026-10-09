import { describe, expect, it } from "vitest";
import type { LinkGraph } from "./linkGraph";
import {
  DEFAULT_SIMULATION,
  buildGraphModel,
  clampScale,
  edgeKey,
  filterGraph,
  fitView,
  graphFolders,
  graphTags,
  mulberry32,
  neighborhood,
  seedPositions,
  simulationStep,
  toGraphPoint,
  zeroVelocities,
  zoomAt,
  type GraphModelNode,
} from "./graphLayout";

function node(relative: string, links: [string, number][], tags: string[] = []) {
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
    node("A.md", [["B", 2]]),
    node("B.md", [["A", 1], ["C", 1]]),
    node("C.md", []),
    node("Suelta.md", [["NoExiste", 1]]),
  ],
};

describe("modelo del grafo", () => {
  const model = buildGraphModel(graph);

  it("une los enlaces de las dos direcciones en una sola arista", () => {
    const edge = model.edges.find(
      (entry) =>
        (entry.source === "/vault/A.md" && entry.target === "/vault/B.md") ||
        (entry.source === "/vault/B.md" && entry.target === "/vault/A.md"),
    );
    expect(edge).toBeDefined();
    // 2 menciones de A→B y 1 de B→A: tres en total.
    expect(edge?.weight).toBe(3);
    expect(model.edges).toHaveLength(2);
  });

  it("las notas sin enlaces siguen en el mapa, como islas", () => {
    expect(model.nodes.map((entry) => entry.id)).toContain("/vault/C.md");
    expect(model.nodes.map((entry) => entry.id)).toContain("/vault/Suelta.md");
    expect(model.nodes.find((entry) => entry.id === "/vault/C.md")?.degree).toBe(1);
    expect(model.nodes.find((entry) => entry.id === "/vault/Suelta.md")?.degree).toBe(0);
  });

  it("guarda etiquetas y carpeta en minúsculas para el filtrado", () => {
    const filtered = buildGraphModel({
      generatedMs: 0,
      nodes: [node("Notas/Idea.md", [], ["Clases", "examen"])],
    });
    expect(filtered.nodes[0].folder).toBe("Notas");
    expect(filtered.nodes[0].tags).toEqual(["clases", "examen"]);
  });

  it("con un tope se quedan las notas más enlazadas", () => {
    const limited = buildGraphModel(graph, 2);
    expect(limited.nodes).toHaveLength(2);
    // Las islas se van antes que las conectadas.
    expect(limited.nodes.map((entry) => entry.id)).not.toContain("/vault/Suelta.md");
  });

  it("sin grafo el modelo está vacío", () => {
    expect(buildGraphModel(null)).toEqual({ nodes: [], edges: [] });
  });
});

describe("encuadre", () => {
  it("el zoom mueve el encuadre para no mover el punto bajo el cursor", () => {
    const view = { scale: 1, x: 0, y: 0 };
    const zoomed = zoomAt(view, 2, 100, 60);

    expect(zoomed.scale).toBe(2);
    // El punto del lienzo (100, 60) sigue mirando a lo mismo del modelo.
    expect(toGraphPoint(view, 100, 60)).toEqual(toGraphPoint(zoomed, 100, 60));
  });

  it("el encuadre no se pasa de los topes", () => {
    expect(clampScale(0.001)).toBe(0.2);
    expect(clampScale(999)).toBe(4);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it("«ajustar» centra el contenido con margen", () => {
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 200, y: 100 }],
    ]);
    const view = fitView(positions, 400, 300, 0);

    expect(view.scale).toBe(2);
    // El centro del contenido (100, 50) cae en el centro del lienzo.
    expect(toGraphPoint(view, 200, 150)).toEqual({ x: 100, y: 50 });
  });
});

function modelNode(id: string): GraphModelNode {
  return { id, label: id, folder: "", tags: [], degree: 0 };
}

describe("simulación de fuerzas", () => {
  it("los nodos enlazados acercan hasta su longitud de reposo", () => {
    const positions = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 600, y: 0 }],
    ]);
    const velocities = zeroVelocities(positions);
    const edges = [{ source: "a", target: "b", weight: 1 }];

    for (let step = 0; step < 200; step += 1) {
      simulationStep(positions, velocities, edges, { x: 300, y: 0 });
    }

    const distance = Math.abs(positions.get("b")!.x - positions.get("a")!.x);
    expect(distance).toBeLessThan(600);
    expect(distance).toBeGreaterThan(0);
  });

  it("dos nodos pegados se separan", () => {
    const positions = new Map([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 101, y: 100 }],
    ]);
    const velocities = zeroVelocities(positions);

    for (let step = 0; step < 30; step += 1) {
      simulationStep(positions, velocities, [], { x: 0, y: 0 });
    }

    expect(Math.abs(positions.get("b")!.x - positions.get("a")!.x)).toBeGreaterThan(1);
  });

  it("devuelve el desplazamiento mayor, que es cómo se sabe que se ha quieto", () => {
    const positions = new Map([["a", { x: 10, y: 10 }]]);
    const velocities = zeroVelocities(positions);

    const moving = simulationStep(positions, velocities, [], { x: 0, y: 0 });
    expect(moving).toBeGreaterThan(0);

    // Con la gravedad apagada y sin velocidades no se mueve nada.
    const still = simulationStep(positions, zeroVelocities(positions), [], { x: 10, y: 10 }, {
      ...DEFAULT_SIMULATION,
      gravity: 0,
    });
    expect(still).toBe(0);
  });

  it("la colocación inicial es determinista con la misma semilla", () => {
    const nodes = [modelNode("a"), modelNode("b"), modelNode("c")];
    const first = seedPositions(nodes, 400, 300, mulberry32(7));
    const second = seedPositions(nodes, 400, 300, mulberry32(7));

    expect(first).toEqual(second);
    expect(first.size).toBe(3);
  });
});

describe("vecindad", () => {
  it("reúne el nodo, sus aristas y sus vecinos", () => {
    const model = buildGraphModel(graph);
    const near = neighborhood(model, "/vault/B.md");

    expect(near.nodes.has("/vault/A.md")).toBe(true);
    expect(near.nodes.has("/vault/C.md")).toBe(true);
    expect(near.nodes.has("/vault/Suelta.md")).toBe(false);
    expect(near.edges.size).toBe(2);
  });

  it("sin nodo no se resalta nada", () => {
    const model = buildGraphModel(graph);
    expect(neighborhood(model, null).nodes.size).toBe(0);
  });

  it("la clave de arista es la misma que usa el resaltado", () => {
    const model = buildGraphModel(graph);
    expect(model.edges.every((edge) => neighborhood(model, edge.source).edges.has(edgeKey(edge)))).toBe(
      true,
    );
  });
});

describe("filtros", () => {
  const conCarpetas: LinkGraph = {
    generatedMs: 0,
    nodes: [
      node("Clases.md", [], ["clases"]),
      node("Matemáticas/Unidad 1.md", [["Clases", 1]], ["CLASES", "examen"]),
      node("Matemáticas/Unidad 2.md", [], []),
    ],
  };

  it("reúne carpetas y etiquetas del vault", () => {
    expect(graphFolders(conCarpetas)).toEqual(["Matemáticas"]);
    expect(graphTags(conCarpetas)).toEqual(["clases", "examen"]);
    expect(graphFolders(null)).toEqual([]);
  });

  it("el filtro de carpeta deja las de dentro, que forman parte de la sección", () => {
    const filtered = filterGraph(conCarpetas, "Matemáticas", "");
    expect(filtered?.nodes.map((entry) => entry.relative)).toEqual([
      "Matemáticas/Unidad 1.md",
      "Matemáticas/Unidad 2.md",
    ]);
  });

  it("el filtro de etiqueta no distingue mayúsculas", () => {
    const filtered = filterGraph(conCarpetas, "", "CLASES");
    expect(filtered?.nodes.map((entry) => entry.relative)).toEqual([
      "Clases.md",
      "Matemáticas/Unidad 1.md",
    ]);
  });

  it("sin filtros el grafo se devuelve tal cual", () => {
    expect(filterGraph(conCarpetas, "", "")).toBe(conCarpetas);
    expect(filterGraph(null, "a", "b")).toBeNull();
  });
});
