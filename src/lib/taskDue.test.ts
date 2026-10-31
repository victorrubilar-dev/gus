import { describe, expect, it } from "vitest";
import { dueKind, shortDate } from "./taskDue";

describe("dueKind", () => {
  it("una tarea hecha no vence aunque el plazo haya pasado", () => {
    expect(dueKind({ completes: true }, "2020-01-01", "2026-10-30")).toBe("done");
  });

  it("compara el día con hoy", () => {
    expect(dueKind({ completes: false }, "2026-10-29", "2026-10-30")).toBe("overdue");
    expect(dueKind({ completes: false }, "2026-10-30", "2026-10-30")).toBe("today");
    expect(dueKind({ completes: false }, "2026-10-31", "2026-10-30")).toBe("later");
  });
});

describe("shortDate", () => {
  it("un texto que no es fecha se devuelve igual", () => {
    expect(shortDate("mañana")).toBe("mañana");
  });

  it("añade el año solo si no es el actual", () => {
    const now = new Date(2026, 9, 30);
    expect(shortDate("2026-11-05", now)).not.toMatch(/2026/);
    expect(shortDate("2027-11-05", now)).toMatch(/2027/);
  });
});
