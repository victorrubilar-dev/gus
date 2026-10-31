import { describe, expect, it } from "vitest";
import { greetingFor, mergeRecents, notePreview, splitTodayTasks, type RecentItem } from "./dashboard";
import type { Task } from "./taskStore";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, tags: [], completes: false, ...extra });

describe("greetingFor", () => {
  it("cambia con la hora", () => {
    expect(greetingFor(4)).toBe("evening");
    expect(greetingFor(5)).toBe("morning");
    expect(greetingFor(11)).toBe("morning");
    expect(greetingFor(12)).toBe("afternoon");
    expect(greetingFor(19)).toBe("afternoon");
    expect(greetingFor(20)).toBe("evening");
  });
});

describe("splitTodayTasks", () => {
  const today = "2026-10-31";

  it("separa vencidas, de hoy y lo siguiente, sin las hechas", () => {
    const tasks = [
      task("vieja", { due: "2026-10-20" }),
      task("ayer", { due: "2026-10-30", priority: "urgente" }),
      task("hoy", { due: today }),
      task("hecha", { due: today, completes: true }),
      task("luego", { due: "2026-11-05" }),
      task("sin plazo"),
    ];
    const split = splitTodayTasks(tasks, today);
    expect(split.overdue.map((t) => t.id)).toEqual(["vieja", "ayer"]);
    expect(split.today.map((t) => t.id)).toEqual(["hoy"]);
    expect(split.upcoming.map((t) => t.id).sort()).toEqual(["luego", "sin plazo"]);
  });

  it("las de hoy van por importancia y lo siguiente se limita", () => {
    const tasks = [
      task("baja", { due: today, priority: "baja" }),
      task("alta", { due: today, priority: "alta" }),
      ...Array.from({ length: 6 }, (_, i) => task(`s${i}`)),
    ];
    const split = splitTodayTasks(tasks, today, 2);
    expect(split.today.map((t) => t.id)).toEqual(["alta", "baja"]);
    expect(split.upcoming).toHaveLength(2);
  });
});

describe("mergeRecents", () => {
  const item = (id: string, modifiedMs: number | null, kind: RecentItem["kind"] = "note"): RecentItem => ({ kind, id, name: id, detail: "", modifiedMs });

  it("ordena por fecha, deja lo que no la tiene al final y corta", () => {
    const merged = mergeRecents([item("a", 10), item("b", null), item("c", 30, "board"), item("d", 20, "pdf")], 3);
    expect(merged.map((i) => i.id)).toEqual(["c", "d", "a"]);
    expect(mergeRecents([item("a", 1), item("b", null)], 5).map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("notePreview", () => {
  it("quita frontmatter y marcas, y salta las líneas vacías", () => {
    const text = "---\ntags: [a]\n---\n\n# Martes\n\n- [ ] llamar al banco\n- comprar pan\n";
    expect(notePreview(text)).toEqual(["Martes", "llamar al banco"]);
    expect(notePreview(text, 3)).toEqual(["Martes", "llamar al banco", "comprar pan"]);
  });

  it("una nota vacía no tiene vista previa", () => {
    expect(notePreview("# \n\n")).toEqual([]);
  });
});
