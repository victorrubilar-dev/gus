import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  dueEndMs,
  dueStartMs,
  isoDay,
  notifiedKey,
  reminderMomentMs,
  shouldNotifyDailyNote,
  tasksToNotify,
  type RemindableTask,
} from "./notifications";

/** 2026-10-10 12:00 en la zona horaria local de la máquina que corre los tests. */
const NOON = new Date(2026, 9, 10, 12, 0, 0, 0).getTime();

function task(id: string, due?: string, completes = false): RemindableTask {
  return { id, title: `Tarea ${id}`, due, completes };
}

describe("fechas de vencimiento", () => {
  it("un vencimiento sin hora se cumple al terminar su día", () => {
    const end = dueEndMs("2026-10-12");
    expect(end).not.toBeNull();
    expect(new Date(end!).getDate()).toBe(12);
    expect(new Date(end!).getHours()).toBe(23);
    expect(new Date(end!).getMinutes()).toBe(59);
  });

  it("una fecha imposible no produce vencimiento", () => {
    expect(dueEndMs("2026-02-31")).toBeNull();
    expect(dueEndMs("2026-13-01")).toBeNull();
    expect(dueEndMs("12/10/2026")).toBeNull();
    expect(dueEndMs("")).toBeNull();
  });

  it("el aviso suena al empezar la antelación elegida", () => {
    const start = dueStartMs("2026-10-12")!;
    expect(dueStartMs("2026-10-12")).not.toBeNull();
    expect(new Date(start).getHours()).toBe(0);
    expect(reminderMomentMs("2026-10-12", 0)).toBe(start);
    expect(reminderMomentMs("2026-10-12", 1)).toBe(start - DAY_MS);
    expect(dueStartMs("2026-02-31")).toBeNull();
    expect(reminderMomentMs("2026-02-31", 1)).toBeNull();
  });

  it("la clave de aviso caduca cada día", () => {
    const hoy = notifiedKey("a", "2026-10-12", NOON);
    const manana = notifiedKey("a", "2026-10-12", NOON + DAY_MS);
    expect(hoy).not.toBe(manana);
    // Misma tarea y mismo día: la misma clave, que es lo que evita repetir.
    expect(notifiedKey("a", "2026-10-12", NOON)).toBe(hoy);
    expect(isoDay(NOON)).toBe("2026-10-10");
  });
});

describe("tareas que merecen aviso", () => {
  it("avisa de las que caen dentro de la antelación", () => {
    const tareas = [task("hoy", "2026-10-10"), task("manana", "2026-10-11")];

    // Sin antelación solo suena la del día.
    expect(tasksToNotify(tareas, 0, NOON, new Set()).map((t) => t.id)).toEqual(["hoy"]);
    // Con un día de antelación entran las dos.
    expect(tasksToNotify(tareas, 1, NOON, new Set()).map((t) => t.id)).toEqual([
      "hoy",
      "manana",
    ]);
    // Con siete, entra también la de dentro de una semana.
    expect(
      tasksToNotify([...tareas, task("semana", "2026-10-17")], 7, NOON, new Set()).map((t) => t.id),
    ).toEqual(["hoy", "manana", "semana"]);
  });

  it("no avisa de lo que ya venció ni de lo que falta mucho", () => {
    const tareas = [task("pasada", "2026-10-08"), task("lejana", "2026-10-30")];
    expect(tasksToNotify(tareas, 1, NOON, new Set())).toEqual([]);
    // Con la mayor antelación posible (14 días) la de dentro de 20 sigue fuera.
    expect(tasksToNotify(tareas, 14, NOON, new Set())).toEqual([]);
    // Lo vencido no suena nunca: ya está en la lista de la pestaña de tareas.
    expect(tasksToNotify([task("pasada", "2026-10-08")], 14, NOON, new Set())).toEqual([]);
  });

  it("el vencimiento de hoy suena durante todo su día", () => {
    const noche = new Date(2026, 9, 10, 23, 30, 0, 0).getTime();
    expect(tasksToNotify([task("a", "2026-10-10")], 0, noche, new Set()).length).toBe(1);
  });

  it("salta las completadas, las sin fecha y las ya avisadas hoy", () => {
    const tareas = [
      task("hecha", "2026-10-10", true),
      task("sin-fecha"),
      task("avisada", "2026-10-10"),
      task("nueva", "2026-10-10"),
    ];
    const avisadas = new Set([notifiedKey("avisada", "2026-10-10", NOON)]);

    expect(tasksToNotify(tareas, 1, NOON, avisadas).map((t) => t.id)).toEqual(["nueva"]);
  });

  it("una tarea con fecha corrupta se ignora en vez de romper", () => {
    expect(tasksToNotify([task("mala", "ayer")], 1, NOON, new Set())).toEqual([]);
  });
});

describe("recordatorio de la nota del día", () => {
  it("solo suena si está encendido, no existe y no se avisó hoy", () => {
    expect(shouldNotifyDailyNote(true, false, null, NOON)).toBe(true);
    expect(shouldNotifyDailyNote(true, false, "2026-10-10", NOON)).toBe(false);
    // Ayer sí que se avisó, así que hoy vuelve a tocar.
    expect(shouldNotifyDailyNote(true, false, "2026-10-09", NOON)).toBe(true);
    expect(shouldNotifyDailyNote(false, false, null, NOON)).toBe(false);
    // Con la nota ya escrita no hay nada que recordar.
    expect(shouldNotifyDailyNote(true, true, null, NOON)).toBe(false);
  });
});
