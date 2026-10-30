import { describe, expect, it } from "vitest";
import type { Task } from "./taskStore";
import {
  canBlockBy,
  canSetParent,
  cleanRelations,
  descendantIds,
  flattenTree,
  pendingBlockers,
  removeWithRelations,
  setParent,
  subtaskProgress,
  toggleBlocker,
} from "./taskTree";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, tags: [], completes: false, ...extra });

describe("subtareas", () => {
  const tasks = [task("a"), task("b", { parentId: "a" }), task("c", { parentId: "b", completes: true }), task("d")];

  it("ordena en árbol con su profundidad", () => {
    expect(flattenTree(tasks).map((row) => [row.task.id, row.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["d", 0],
    ]);
  });

  it("una subtarea cuyo padre no existe se muestra como raíz", () => {
    expect(flattenTree([task("x", { parentId: "fantasma" })]).map((r) => r.depth)).toEqual([0]);
  });

  it("calcula el progreso con todas las subtareas", () => {
    expect(descendantIds(tasks, "a")).toEqual(new Set(["b", "c"]));
    expect(subtaskProgress(tasks, "a")).toEqual({ done: 1, total: 2 });
    expect(subtaskProgress(tasks, "d")).toEqual({ done: 0, total: 0 });
  });

  it("no deja colgar una tarea de sí misma ni de su descendiente", () => {
    expect(canSetParent(tasks, "a", "a")).toBe(false);
    expect(canSetParent(tasks, "a", "c")).toBe(false);
    expect(canSetParent(tasks, "d", "c")).toBe(true);
    expect(setParent(tasks, "a", "c")).toEqual(tasks);
    expect(setParent(tasks, "d", "a").find((t) => t.id === "d")?.parentId).toBe("a");
    expect(setParent(tasks, "b", null).find((t) => t.id === "b")?.parentId).toBeUndefined();
  });
});

describe("dependencias", () => {
  it("bloquea y desbloquea, y rechaza ciclos", () => {
    let tasks = [task("a"), task("b"), task("c")];
    tasks = toggleBlocker(tasks, "b", "a"); // b espera a a
    tasks = toggleBlocker(tasks, "c", "b"); // c espera a b
    expect(canBlockBy(tasks, "a", "c")).toBe(false); // cerraría a→c→b→a
    expect(toggleBlocker(tasks, "a", "c")).toEqual(tasks);
    expect(canBlockBy(tasks, "a", "a")).toBe(false);

    tasks = toggleBlocker(tasks, "b", "a");
    expect(tasks.find((t) => t.id === "b")?.blockedBy).toBeUndefined();
  });

  it("solo cuentan los bloqueos sin completar", () => {
    const tasks = [task("a", { completes: true }), task("b"), task("c", { blockedBy: ["a", "b"] })];
    expect(pendingBlockers(tasks, tasks[2]).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("limpieza", () => {
  it("borrar sube las subtareas y quita los bloqueos", () => {
    const tasks = [task("a"), task("b", { parentId: "a" }), task("c", { parentId: "b", blockedBy: ["b"] })];
    const next = removeWithRelations(tasks, "b");
    expect(next.map((t) => t.id)).toEqual(["a", "c"]);
    expect(next[1].parentId).toBe("a");
    expect(next[1].blockedBy).toBeUndefined();
  });

  it("al cargar descarta lo inválido y conserva lo válido", () => {
    const messy = [
      task("a", { parentId: "b", blockedBy: ["fantasma", "a", "b"] }),
      task("b", { parentId: "a", blockedBy: ["a"] }),
    ];
    const clean = cleanRelations(messy);
    // El ciclo de jerarquía se corta y solo sobrevive una dependencia.
    const parents = clean.filter((t) => t.parentId).length;
    expect(parents).toBeLessThanOrEqual(1);
    expect(clean.find((t) => t.id === "a")?.blockedBy).toEqual(["b"]);
    expect(clean.find((t) => t.id === "b")?.blockedBy).toBeUndefined();
  });
});
