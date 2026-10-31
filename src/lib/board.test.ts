import { describe, expect, it } from "vitest";
import {
  boxFrom,
  eraseAt,
  EMPTY_HISTORY,
  handlePoint,
  hits,
  parseBoard,
  recordChange,
  redo,
  resizeTo,
  serializeBoard,
  topmostAt,
  toWorld,
  translate,
  undo,
  zoomAt,
  type BoardElement,
} from "./board";

const rect = (id: string, x: number, y: number, w = 100, h = 50): BoardElement => ({ type: "rect", id, color: "#ef4444", x, y, w, h, fill: false });

describe("geometría", () => {
  it("normaliza un arrastre hacia arriba y a la izquierda", () => {
    expect(boxFrom([100, 80], [20, 10])).toEqual({ x: 20, y: 10, w: 80, h: 70 });
  });

  it("acierta sobre cada forma", () => {
    const ellipse: BoardElement = { type: "ellipse", id: "e", color: "#fff", x: 0, y: 0, w: 100, h: 100, fill: false };
    expect(hits(ellipse, [50, 50], 0)).toBe(true);
    expect(hits(ellipse, [2, 2], 0)).toBe(false); // esquina del cuadro, fuera de la elipse
    const diamond: BoardElement = { ...ellipse, type: "diamond" };
    expect(hits(diamond, [50, 5], 0)).toBe(true);
    expect(hits(diamond, [5, 5], 0)).toBe(false);
    const arrow: BoardElement = { type: "arrow", id: "a", color: "#fff", x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(hits(arrow, [50, 4], 6)).toBe(true);
    expect(hits(arrow, [50, 20], 6)).toBe(false);
    const pen: BoardElement = { type: "pen", id: "p", color: "#fff", width: 2, points: [[0, 0], [50, 50]] };
    expect(hits(pen, [25, 26], 3)).toBe(true);
    expect(hits(pen, [50, 0], 3)).toBe(false);
  });

  it("elige el elemento de más arriba", () => {
    const els = [rect("abajo", 0, 0), rect("arriba", 50, 10)];
    expect(topmostAt(els, [60, 20], 0)?.id).toBe("arriba");
    expect(topmostAt(els, [10, 10], 0)?.id).toBe("abajo");
    expect(topmostAt(els, [500, 500], 0)).toBeNull();
  });

  it("mueve cada tipo de elemento", () => {
    const pen: BoardElement = { type: "pen", id: "p", color: "#fff", width: 2, points: [[0, 0], [1, 1]] };
    expect(translate(pen, 5, 5)).toMatchObject({ points: [[5, 5], [6, 6]] });
    const line: BoardElement = { type: "line", id: "l", color: "#fff", x1: 0, y1: 0, x2: 4, y2: 4 };
    expect(translate(line, 1, 2)).toMatchObject({ x1: 1, y1: 2, x2: 5, y2: 6 });
    expect(translate(rect("r", 1, 1), 2, 3)).toMatchObject({ x: 3, y: 4 });
  });

  it("redimensiona con un mínimo y deja quieto el trazo", () => {
    expect(resizeTo(rect("r", 10, 10), [200, 100])).toMatchObject({ w: 190, h: 90 });
    expect(resizeTo(rect("r", 10, 10), [0, 0])).toMatchObject({ w: 24, h: 24 });
    const pen: BoardElement = { type: "pen", id: "p", color: "#fff", width: 2, points: [[0, 0]] };
    expect(handlePoint(pen)).toBeNull();
    expect(resizeTo(pen, [9, 9])).toBe(pen);
    const arrow: BoardElement = { type: "arrow", id: "a", color: "#fff", x1: 0, y1: 0, x2: 4, y2: 4 };
    expect(resizeTo(arrow, [9, 8])).toMatchObject({ x2: 9, y2: 8 });
  });
});

describe("goma", () => {
  const stroke: BoardElement = { type: "pen", id: "trazo", color: "#fff", width: 3, points: [[0, 50], [200, 50]] };

  it("borra un trazo y deja el resto", () => {
    const els = [rect("r", 300, 300), stroke];
    expect(eraseAt(els, [100, 52], 8).map((el) => el.id)).toEqual(["r"]);
  });

  it("una forma hueca solo se borra por el contorno, no por dentro", () => {
    const hueca = rect("hueca", 0, 0, 200, 100);
    expect(eraseAt([hueca], [100, 50], 8)).toEqual([hueca]); // centro
    expect(eraseAt([hueca], [100, 2], 8)).toEqual([]); // borde superior
    expect(eraseAt([hueca], [2, 50], 8)).toEqual([]); // borde izquierdo
  });

  it("una forma rellena se borra también por dentro", () => {
    const rellena: BoardElement = { ...rect("llena", 0, 0, 200, 100), fill: true } as BoardElement;
    expect(eraseAt([rellena], [100, 50], 8)).toEqual([]);
  });

  it("un trazo que cruza una forma hueca se borra sin llevarse la forma", () => {
    const hueca = rect("hueca", 0, 0, 200, 100);
    expect(eraseAt([hueca, stroke], [100, 50], 8).map((el) => el.id)).toEqual(["hueca"]);
  });

  it("borra solo el de más arriba y no toca la lista si no hay nada", () => {
    const a: BoardElement = { type: "note", id: "a", color: "#fde68a", x: 0, y: 0, w: 100, h: 100, text: "" };
    const b: BoardElement = { ...a, id: "b" };
    expect(eraseAt([a, b], [50, 50], 8).map((el) => el.id)).toEqual(["a"]);
    const lista = [a];
    expect(eraseAt(lista, [900, 900], 8)).toBe(lista);
  });

  it("formas pequeñas con radio grande no producen NaN", () => {
    const chica: BoardElement = { type: "ellipse", id: "e", color: "#fff", x: 0, y: 0, w: 4, h: 4, fill: false };
    expect(eraseAt([chica], [2, 2], 8)).toEqual([]);
  });
});

describe("vista", () => {
  it("el zoom deja fijo el punto bajo el cursor y respeta los límites", () => {
    const view = { x: 10, y: 20, scale: 1 };
    const [wx, wy] = toWorld(view, 300, 200);
    const zoomed = zoomAt(view, 2, 300, 200);
    expect(toWorld(zoomed, 300, 200)).toEqual([wx, wy]);
    expect(zoomAt(view, 1000, 0, 0).scale).toBe(4);
    expect(zoomAt(view, 0.0001, 0, 0).scale).toBe(0.2);
  });
});

describe("historial", () => {
  it("deshace y rehace, y un cambio nuevo borra lo rehacible", () => {
    const a: BoardElement[] = [];
    const b = [rect("1", 0, 0)];
    const c = [rect("1", 0, 0), rect("2", 5, 5)];

    let history = recordChange(EMPTY_HISTORY, a); // a → b
    history = recordChange(history, b); // b → c
    const back = undo(history, c);
    expect(back?.elements).toEqual(b);
    const forward = redo(back!.history, back!.elements);
    expect(forward?.elements).toEqual(c);

    expect(recordChange(back!.history, b).future).toEqual([]);
    expect(undo(EMPTY_HISTORY, a)).toBeNull();
    expect(redo(EMPTY_HISTORY, a)).toBeNull();
  });
});

describe("lectura", () => {
  it("ida y vuelta", () => {
    const board = { name: "Ideas", elements: [rect("1", 0, 0)] };
    expect(parseBoard(serializeBoard(board), "x")).toEqual(board);
  });

  it("descarta lo inválido en vez de fallar", () => {
    const json = JSON.stringify({
      name: "  ",
      elements: [
        { type: "rect", id: "ok", x: 0, y: 0, w: 5, h: 5, color: "red; background:url(x)" },
        { type: "rect", id: "mal", x: "0", y: 0, w: 5, h: 5 },
        { type: "pen", id: "vacío", width: 2, points: [] },
        { type: "nave", id: "n" },
        42,
      ],
    });
    const board = parseBoard(json, "Sin título");
    expect(board.name).toBe("Sin título");
    expect(board.elements.map((el) => el.id)).toEqual(["ok"]);
    expect((board.elements[0] as { color: string }).color).toBe("var(--color-gus-text)"); // color sospechoso → el del tema
    expect(parseBoard("{no es json", "Sin título")).toEqual({ name: "Sin título", elements: [] });
  });
});
