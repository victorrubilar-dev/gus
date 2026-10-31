import { describe, expect, it } from "vitest";
import {
  goBack,
  goForward,
  goUp,
  navigateTo,
  rewriteTrail,
  splitTrail,
  TRAIL_HISTORY_LIMIT,
  type FolderEntry,
  type TrailState,
} from "./explorerTrail";

const dir = (path: string): FolderEntry => ({ name: path.split("/").pop() || path, path });
const root = dir("/v");
const start: TrailState = { trail: [root], past: [], future: [] };

describe("explorerTrail", () => {
  it("navegar guarda el paso anterior y vacía «adelante»", () => {
    const a = navigateTo(start, [root, dir("/v/a")]);
    expect(a.past).toEqual([[root]]);
    const back = goBack(a);
    expect(back.future).toHaveLength(1);
    expect(navigateTo(back, [root, dir("/v/b")]).future).toEqual([]);
  });

  it("ir a la misma ruta no crea historial", () => {
    expect(navigateTo(start, [root])).toBe(start);
  });

  it("atrás y adelante se deshacen entre sí; sin historial no hacen nada", () => {
    expect(goBack(start)).toBe(start);
    expect(goForward(start)).toBe(start);
    const a = navigateTo(start, [root, dir("/v/a")]);
    expect(goForward(goBack(a))).toEqual(a);
  });

  it("subir quita el último tramo y no pasa de la raíz", () => {
    const a = navigateTo(start, [root, dir("/v/a")]);
    expect(goUp(a).trail).toEqual([root]);
    expect(goUp(start)).toBe(start);
  });

  it("el historial tiene tope", () => {
    let state = start;
    for (let i = 0; i < TRAIL_HISTORY_LIMIT + 10; i++) state = navigateTo(state, [root, dir(`/v/${i}`)]);
    expect(state.past).toHaveLength(TRAIL_HISTORY_LIMIT);
  });

  it("reescribir corrige ruta, atrás y adelante sin añadir pasos", () => {
    const a = navigateTo(navigateTo(start, [root, dir("/v/a")]), [root, dir("/v/a"), dir("/v/a/b")]);
    const moved = rewriteTrail(goBack(a), (trail) => trail.map((f) => ({ ...f, path: f.path.replace("/v/a", "/v/z") })));
    expect(moved.trail[1].path).toBe("/v/z");
    expect(moved.future[0][2].path).toBe("/v/z/b");
    expect(moved.past).toHaveLength(a.past.length - 1);
  });

  it("splitTrail colapsa por niveles hasta dejar solo la carpeta actual", () => {
    const trail = [root, dir("/v/a"), dir("/v/a/b"), dir("/v/a/b/c")];
    const names = (level: number) => splitTrail(trail, level).visible.map((p) => p.index);
    expect(names(0)).toEqual([0, 1, 2, 3]);
    expect(names(1)).toEqual([0, 2, 3]);
    expect(names(2)).toEqual([0, 3]);
    expect(names(3)).toEqual([2, 3]);
    expect(names(99)).toEqual([3]);
    expect(splitTrail([root], 5)).toMatchObject({ hidden: [], maxLevel: 0 });
  });
});
