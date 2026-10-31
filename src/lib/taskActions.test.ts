import { describe, expect, it } from "vitest";
import {
  addSubtask,
  cyclePriority,
  matchesTag,
  moveToColumn,
  setTags,
  tagCounts,
  taskFromNew,
  toggleDone,
} from "./taskActions";
import type { Task } from "./taskStore";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, tags: [], completes: false, ...extra });

describe("toggleDone", () => {
  it("marca y desmarca solo esa tarea", () => {
    const list = [task("a"), task("b")];
    const done = toggleDone(list, "a");
    expect(done.map((t) => t.completes)).toEqual([true, false]);
    expect(toggleDone(done, "a")[0].completes).toBe(false);
  });

  it("una tarea hecha deja de estar en progreso", () => {
    const [a] = toggleDone([task("a", { doing: true })], "a");
    expect(a.doing).toBeUndefined();
  });
});

describe("cyclePriority", () => {
  it("sube un escalón y al llegar al final la quita", () => {
    let list = [task("a")];
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      list = cyclePriority(list, "a");
      seen.push(list[0].priority);
    }
    expect(seen[0]).toBe("baja");
    expect(seen).toContain(undefined);
    expect("priority" in list[0] && list[0].priority === undefined).toBe(false);
  });
});

describe("moveToColumn", () => {
  it("done marca completada y quita doing", () => {
    const [a] = moveToColumn([task("a", { doing: true })], "a", "done");
    expect(a).toMatchObject({ completes: true });
    expect(a.doing).toBeUndefined();
  });

  it("doing y todo ajustan los dos campos", () => {
    const [doing] = moveToColumn([task("a", { completes: true })], "a", "doing");
    expect(doing).toMatchObject({ completes: false, doing: true });
    const [todo] = moveToColumn([doing], "a", "todo");
    expect(todo).toMatchObject({ completes: false });
    expect(todo.doing).toBeUndefined();
  });
});

describe("subtareas y etiquetas", () => {
  it("addSubtask añade al final con su padre", () => {
    const list = addSubtask([task("p"), task("q")], "p", "paso");
    expect(list).toHaveLength(3);
    expect(list[2]).toMatchObject({ title: "paso", parentId: "p", completes: false });
  });

  it("setTags solo toca esa tarea", () => {
    const list = setTags([task("a"), task("b")], "b", ["x"]);
    expect(list.map((t) => t.tags)).toEqual([[], ["x"]]);
  });

  it("matchesTag ignora mayúsculas y sin filtro deja pasar todo", () => {
    expect(matchesTag(["Docs"], "docs")).toBe(true);
    expect(matchesTag(["docs"], "libros")).toBe(false);
    expect(matchesTag([], null)).toBe(true);
  });

  it("tagCounts cuenta sin distinguir mayúsculas y ordena", () => {
    const counts = tagCounts([task("a", { tags: ["Docs", "api"] }), task("b", { tags: ["docs"] })]);
    expect(counts).toEqual([
      { label: "api", count: 1 },
      { label: "Docs", count: 2 },
    ]);
  });
});

describe("taskFromNew", () => {
  it("sin título no hay tarea", () => {
    expect(taskFromNew({ title: "   ", tags: [] })).toBeNull();
  });

  it("recorta el título y descarta los campos vacíos o inválidos", () => {
    const t = taskFromNew({ title: "  Hacer  ", description: "  ", tags: ["a"], due: null, priority: "nada" as never });
    expect(t).toMatchObject({ title: "Hacer", tags: ["a"], completes: false });
    expect(t).not.toHaveProperty("description");
    expect(t).not.toHaveProperty("due");
    expect(t).not.toHaveProperty("priority");
  });

  it("conserva descripción, plazo y prioridad válidos", () => {
    const t = taskFromNew({ title: "x", description: " d ", tags: [], due: "2026-11-01", priority: "alta" });
    expect(t).toMatchObject({ description: "d", due: "2026-11-01", priority: "alta" });
  });
});
