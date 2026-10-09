import { describe, expect, it } from "vitest";
import {
  DAILY_DEFAULT_FOLDER,
  DAILY_DEFAULT_TEMPLATE,
  dailyFileName,
  dailyHeading,
  dailyNoteDateFor,
  dailyRelativePath,
  dailyTitle,
  isSameDay,
  isoDate,
  normalizeDailyTemplate,
  renderDailyTemplate,
  sanitizeDailyFolder,
  shiftDay,
} from "./dailyNotes";

/** 9 de octubre de 2026, mediodía (la hora no debe influir en nada). */
const day = new Date(2026, 9, 9, 12, 30, 45);

describe("ruta de la nota del día", () => {
  it("usa nombre numérico para que el explorador ordene por fecha", () => {
    expect(isoDate(day)).toBe("2026-10-09");
    expect(dailyFileName(day)).toBe("2026-10-09.md");
    expect(dailyRelativePath("Diario", day)).toBe("Diario/2026-10-09.md");
  });

  it("pone un cero delante de los días y meses de un solo dígito", () => {
    expect(dailyFileName(new Date(2026, 0, 3, 8))).toBe("2026-01-03.md");
  });

  it("la carpeta se sanea: sin separadores sueltos ni caracteres prohibidos", () => {
    expect(sanitizeDailyFolder("Diario")).toBe("Diario");
    expect(sanitizeDailyFolder("  Notas diarias  ")).toBe("Notas diarias");
    expect(sanitizeDailyFolder("diario/sub")).toBe("diario/sub");
    expect(sanitizeDailyFolder("D:ia*io?")).toBe("Diaio");
    expect(sanitizeDailyFolder("/diario/")).toBe("diario");
    // Lo que no deja nada usable vuelve al valor por defecto.
    expect(sanitizeDailyFolder("   ")).toBe(DAILY_DEFAULT_FOLDER);
    expect(sanitizeDailyFolder("///")).toBe(DAILY_DEFAULT_FOLDER);
    expect(sanitizeDailyFolder(null)).toBe(DAILY_DEFAULT_FOLDER);
  });

  it("la carpeta no puede profundizar sin límite", () => {
    expect(sanitizeDailyFolder("a/b/c/d/e")).toBe("a/b/c/d");
  });
});

describe("plantilla", () => {
  it("viene con título y secciones de trabajo", () => {
    expect(DAILY_DEFAULT_TEMPLATE).toContain("{title}");
    expect(normalizeDailyTemplate(undefined)).toBe(DAILY_DEFAULT_TEMPLATE);
  });

  it("rellena los huecos con la fecha, en el idioma pedido", () => {
    const rendered = renderDailyTemplate("# {title}\n\n{weekday} · {month} · {year}", day, "es");
    expect(rendered).toBe("# 9 de octubre de 2026\n\nviernes · octubre · 2026");
  });

  it("en inglés el título se escribe a la inglesa", () => {
    expect(dailyTitle(day, "en")).toBe("October 9, 2026");
    expect(dailyTitle(day, "es")).toBe("9 de octubre de 2026");
  });

  it("las llaves que no son un hueco se quedan como estaban", () => {
    expect(renderDailyTemplate("{title} y {otracosa}", day, "es")).toBe(
      "9 de octubre de 2026 y {otracosa}",
    );
  });

  it("sanea saltos de línea y topa la longitud", () => {
    expect(normalizeDailyTemplate("a\r\nb\rc")).toBe("a\nb\nc");
    expect(normalizeDailyTemplate("x".repeat(5000))).toHaveLength(4000);
    // Una plantilla vacía es una decisión, no un error: se respeta.
    expect(normalizeDailyTemplate("")).toBe("");
  });

  it("expone los huecos por separado para la ayuda de Ajustes", () => {
    const values = dailyHeading(day, "es");
    expect(values.title).toBe("9 de octubre de 2026");
    expect(values.date).toBe("2026-10-09");
    expect(values.year).toBe("2026");
    expect(values.weekday).toBe("viernes");
    expect(values.month).toBe("octubre");
  });
});

describe("navegación entre días", () => {
  it("corre un día hacia delante y hacia atrás", () => {
    expect(isoDate(shiftDay(day, 1))).toBe("2026-10-10");
    expect(isoDate(shiftDay(day, -1))).toBe("2026-10-08");
    expect(isoDate(shiftDay(day, 0))).toBe("2026-10-09");
  });

  it("cruza meses y años", () => {
    expect(isoDate(shiftDay(new Date(2026, 0, 1, 12), -1))).toBe("2025-12-31");
    expect(isoDate(shiftDay(new Date(2026, 11, 31, 12), 1))).toBe("2027-01-01");
  });

  it("no se descuadra con el cambio de hora (que va a medianoche)", () => {
    // En Chile el reloj se adelanta a las 24:00: el día siguiente debe ser 27.
    const antes = new Date(2026, 8, 26, 23, 30);
    expect(isoDate(shiftDay(antes, 1))).toBe("2026-09-27");
  });

  it("compara días sin mirar la hora", () => {
    expect(isSameDay(new Date(2026, 9, 9, 1), new Date(2026, 9, 9, 23))).toBe(true);
    expect(isSameDay(new Date(2026, 9, 9, 1), new Date(2026, 9, 10, 1))).toBe(false);
  });
});

describe("detección de notas diarias", () => {
  const vault = "/home/ana/gus-vaults/trabajo";

  it("reconoce la nota de un día dentro de la carpeta de diarios", () => {
    expect(dailyNoteDateFor(`${vault}/Diario/2026-10-09.md`, vault, "Diario")).toEqual(
      new Date(2026, 9, 9, 12),
    );
  });

  it("no confunde con otras notas ni con carpetas de dentro", () => {
    expect(dailyNoteDateFor(`${vault}/Ideas/2026-10-09.md`, vault, "Diario")).toBeNull();
    expect(dailyNoteDateFor(`${vault}/Diario/2026-10-09-1.md`, vault, "Diario")).toBeNull();
    expect(dailyNoteDateFor(`${vault}/Diario/vieja/2026-10-09.md`, vault, "Diario")).toBeNull();
    expect(dailyNoteDateFor(`${vault}/Diario/9 de octubre.md`, vault, "Diario")).toBeNull();
    expect(dailyNoteDateFor(`${vault}/2026-10-09.md`, vault, "Diario")).toBeNull();
  });

  it("rechaza fechas imposibles", () => {
    expect(dailyNoteDateFor(`${vault}/Diario/2026-02-30.md`, vault, "Diario")).toBeNull();
    expect(dailyNoteDateFor(`${vault}/Diario/2026-13-01.md`, vault, "Diario")).toBeNull();
  });

  it("aguanta rutas de Windows y mayúsculas mezcladas", () => {
    expect(
      dailyNoteDateFor("C:\\vaults\\Trabajo\\Diario\\2026-10-09.md", "C:/vaults/trabajo", "Diario"),
    ).toEqual(new Date(2026, 9, 9, 12));
  });

  it("con otra carpeta de diarios la nota deja de valer", () => {
    expect(dailyNoteDateFor(`${vault}/Diario/2026-10-09.md`, vault, "Bitácora")).toBeNull();
  });
});
