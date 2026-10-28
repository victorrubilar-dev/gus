import { describe, expect, it } from "vitest";
import {
  createHistory,
  recordHistory,
  redoHistory,
  undoHistory,
  type HistorySnapshot,
} from "./editorHistory";

const estado = (content: string, at: number): HistorySnapshot => ({
  content,
  start: content.length,
  end: content.length,
  at,
});

describe("historial de deshacer", () => {
  it("agrupa escrituras continuas en un solo paso", () => {
    const h = createHistory();
    recordHistory(h, estado("a", 0));
    recordHistory(h, estado("ab", 300));
    recordHistory(h, estado("abc", 600));
    expect(h.past).toHaveLength(1);
    expect(h.past[0].content).toBe("a");
  });

  it("una pausa de más de 800 ms abre un paso nuevo", () => {
    const h = createHistory();
    recordHistory(h, estado("a", 0));
    recordHistory(h, estado("ab", 900));
    expect(h.past).toHaveLength(2);
  });

  it("force abre un grupo nuevo aunque no haya pausa (pegar, cortar)", () => {
    const h = createHistory();
    recordHistory(h, estado("a", 0));
    recordHistory(h, estado("ab", 100), true);
    expect(h.past).toHaveLength(2);
  });

  it("deshacer y rehacer devuelven el estado y se intercambian", () => {
    const h = createHistory();
    recordHistory(h, estado("", 0), true);
    const antes = undoHistory(h, estado("hola", 5000));
    expect(antes?.content).toBe("");
    const despues = redoHistory(h, estado("", 6000));
    expect(despues?.content).toBe("hola");
  });

  it("un cambio nuevo invalida lo que se podía rehacer", () => {
    const h = createHistory();
    recordHistory(h, estado("", 0), true);
    undoHistory(h, estado("hola", 5000));
    recordHistory(h, estado("", 6000), true);
    expect(h.future).toHaveLength(0);
    expect(redoHistory(h, estado("x", 7000))).toBeNull();
  });

  it("sin pasos, deshacer no devuelve nada", () => {
    expect(undoHistory(createHistory(), estado("", 0))).toBeNull();
  });

  it("no guarda más de 200 pasos", () => {
    const h = createHistory();
    for (let i = 0; i < 250; i += 1) recordHistory(h, estado(String(i), i * 1000), true);
    expect(h.past).toHaveLength(200);
    expect(h.past[0].content).toBe("50");
  });
});
