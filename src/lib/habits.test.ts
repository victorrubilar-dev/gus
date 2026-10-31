import { describe, expect, it } from "vitest";
import {
  addHabit,
  bestStreak,
  completionRate,
  currentStreak,
  dayProgress,
  EMPTY_HABITS,
  isScheduled,
  isWeekly,
  lastDays,
  markDay,
  onWeekday,
  removeHabit,
  toggleDay,
  weekDone,
  weekOf,
  type Habit,
} from "./habits";

// 2026-10-26 es lunes.
const habit = (id: string, days: number[], created = "2026-10-01"): Habit => ({ id, name: id, days, created });
const store = (habits: Habit[], log: Record<string, string[]> = {}) => ({ habits, log });

describe("programación", () => {
  it("solo toca en sus días y desde el alta", () => {
    const lunes = habit("a", [0], "2026-10-05");
    expect(isScheduled(lunes, "2026-10-26")).toBe(true); // lunes
    expect(isScheduled(lunes, "2026-10-27")).toBe(false); // martes
    expect(isScheduled(lunes, "2026-09-28")).toBe(false); // lunes anterior al alta
  });
});

describe("registro", () => {
  it("marca y desmarca sin repetidos y ordenado", () => {
    let s = toggleDay(EMPTY_HABITS, "a", "2026-10-02");
    s = toggleDay(s, "a", "2026-10-01");
    expect(s.log.a).toEqual(["2026-10-01", "2026-10-02"]);
    s = toggleDay(toggleDay(s, "a", "2026-10-01"), "a", "2026-10-02");
    expect(s.log).toEqual({});
  });

  it("marcar un día anterior al alta adelanta el comienzo del hábito", () => {
    const base = store([habit("a", [0, 1, 2, 3, 4, 5, 6], "2026-10-10")]);
    const s = markDay(base, "a", "2026-10-05");
    expect(s.habits[0].created).toBe("2026-10-05");
    expect(s.log.a).toEqual(["2026-10-05"]);
    expect(markDay(base, "a", "2026-10-12").habits[0].created).toBe("2026-10-10");
    expect(onWeekday(habit("l", [0], "2026-10-10"), "2026-10-05")).toBe(true); // lunes previo al alta
  });

  it("borrar un hábito borra su historial", () => {
    const s = removeHabit(toggleDay(addHabit(EMPTY_HABITS, habit("a", [0])), "a", "2026-10-05"), "a");
    expect(s).toEqual({ habits: [], log: {} });
  });
});

describe("rachas", () => {
  const diario = habit("d", [0, 1, 2, 3, 4, 5, 6]);

  it("cuenta días seguidos y hoy sin hacer no corta la racha", () => {
    const s = store([diario], { d: ["2026-10-24", "2026-10-25"] });
    expect(currentStreak(diario, s, "2026-10-26")).toBe(2);
  });

  it("un día programado anterior sin hacer sí la corta", () => {
    const s = store([diario], { d: ["2026-10-23", "2026-10-25", "2026-10-26"] });
    expect(currentStreak(diario, s, "2026-10-26")).toBe(2);
  });

  it("los días en que no toca no rompen la racha", () => {
    const lmv = habit("l", [0, 2, 4]); // lunes, miércoles, viernes
    const s = store([lmv], { l: ["2026-10-21", "2026-10-23", "2026-10-26"] }); // mié, vie, lun
    expect(currentStreak(lmv, s, "2026-10-26")).toBe(3);
  });

  it("calcula la mejor racha de la historia", () => {
    const s = store([diario], { d: ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-07"] });
    expect(bestStreak(diario, s, "2026-10-10")).toBe(3);
  });
});

describe("resúmenes", () => {
  it("anillo del día: solo cuentan los hábitos que tocan", () => {
    const s = store([habit("a", [0]), habit("b", [0, 1]), habit("c", [1])], { a: ["2026-10-26"] });
    expect(dayProgress(s, "2026-10-26")).toEqual({ done: 1, total: 2 }); // lunes: a y b
    expect(dayProgress(s, "2026-10-28")).toEqual({ done: 0, total: 0 }); // miércoles: ninguno
  });

  it("porcentaje de cumplimiento en una ventana, o null si no toca ningún día", () => {
    const lunes = habit("a", [0]);
    const s = store([lunes], { a: ["2026-10-19"] });
    expect(completionRate(lunes, s, "2026-10-26", 14)).toBe(50); // lunes 19 hecho, 26 no
    expect(completionRate(habit("z", [], "2026-10-01"), s, "2026-10-26", 14)).toBeNull();
  });

  it("lastDays acaba en hoy y atraviesa meses", () => {
    expect(lastDays("2026-11-02", 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("meta semanal", () => {
  // Semana del 26 oct (lunes) al 1 nov (domingo).
  const semanal = (goal: number, created = "2026-10-01"): Habit => ({ id: "w", name: "w", days: [0, 1, 2, 3, 4, 5, 6], created, weeklyGoal: goal });

  it("se puede hacer cualquier día desde el alta, no antes", () => {
    const h = semanal(3, "2026-10-05");
    expect(isWeekly(h)).toBe(true);
    expect(isScheduled(h, "2026-10-28")).toBe(true);
    expect(isScheduled(h, "2026-10-04")).toBe(false);
    expect(isWeekly(habit("a", [0]))).toBe(false);
  });

  it("la semana va de lunes a domingo y se cuenta lo hecho en ella", () => {
    expect(weekOf("2026-10-28")[0]).toBe("2026-10-26");
    expect(weekOf("2026-10-28")[6]).toBe("2026-11-01");
    const s = store([semanal(3)], { w: ["2026-10-25", "2026-10-26", "2026-10-29"] });
    expect(weekDone(s, "w", "2026-10-30")).toBe(2); // el domingo 25 es de la semana anterior
  });

  it("la racha son semanas seguidas que llegaron a la meta", () => {
    const h = semanal(2);
    const s = store([h], {
      w: ["2026-10-12", "2026-10-14", "2026-10-19", "2026-10-21", "2026-10-26", "2026-10-27"],
    });
    expect(currentStreak(h, s, "2026-10-28")).toBe(3);
    expect(bestStreak(h, s, "2026-10-28")).toBe(3);
  });

  it("la semana en curso sin cumplir aún no corta la racha, una pasada sí", () => {
    const h = semanal(2);
    const aun = store([h], { w: ["2026-10-19", "2026-10-21", "2026-10-26"] });
    expect(currentStreak(h, aun, "2026-10-28")).toBe(1);
    const corta = store([h], { w: ["2026-10-12", "2026-10-14", "2026-10-26", "2026-10-27"] });
    expect(currentStreak(h, corta, "2026-10-28")).toBe(1);
    expect(bestStreak(h, corta, "2026-10-28")).toBe(1);
  });

  it("en el anillo de hoy cuenta hasta cumplir la meta y no en los días pasados", () => {
    const h = semanal(2);
    const s0 = store([h]);
    expect(dayProgress(s0, "2026-10-28", "2026-10-28")).toEqual({ done: 0, total: 1 });
    const hecho = store([h], { w: ["2026-10-28"] });
    expect(dayProgress(hecho, "2026-10-28", "2026-10-28")).toEqual({ done: 1, total: 1 });
    const cumplida = store([h], { w: ["2026-10-26", "2026-10-27"] });
    expect(dayProgress(cumplida, "2026-10-28", "2026-10-28")).toEqual({ done: 0, total: 0 });
    expect(dayProgress(hecho, "2026-10-27", "2026-10-28")).toEqual({ done: 0, total: 0 });
  });

  it("el porcentaje compara lo hecho con lo que pedía la meta, sin pasar de 100", () => {
    const h = semanal(2, "2026-10-01");
    const s = store([h], { w: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"] });
    expect(completionRate(h, s, "2026-10-28", 7)).toBe(100);
    const medio = store([h], { w: ["2026-10-26"] });
    expect(completionRate(h, medio, "2026-10-28", 7)).toBe(50);
  });
});
