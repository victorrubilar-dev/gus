import { describe, expect, it } from "vitest";
import { tableSkeleton } from "./tableLayout";
import { SLASH_ITEMS, filterSlashItems } from "../components/EditorMenus";

/** La entrada de tabla del menú «/». */
const tabla = SLASH_ITEMS.find((item) => item.id === "table");

describe("la tabla del menú «/»", () => {
  it("existe y es de 3 columnas por 5 filas", () => {
    expect(tabla).toBeDefined();
    expect(tabla!.size).toEqual({ cols: 3, rows: 5 });
  });

  it("inserta directa: ya no lleva a otro grupo de tamaños", () => {
    // Antes elegías «Tabla» y el menú cambiaba a una segunda pantalla de
    // tamaños; ahora inserta en el momento.
    expect(tabla!.convertSelection).toBeUndefined();
    expect(tabla!.snippet).toBe("");
  });

  it("nace con cabecera, separador y cinco filas de cuerpo", () => {
    const esqueleto = tableSkeleton(3, 5);
    const filas = esqueleto.text.split("\n");

    // «filas» son las de cuerpo: la cabecera y su separador van aparte.
    expect(filas).toHaveLength(7);
    expect(splitCeldas(filas[0]).map((c) => c.trim())).toEqual([
      "Columna 1",
      "Columna 2",
      "Columna 3",
    ]);
    expect(splitCeldas(filas[1]).every((c) => c.trim() === "---")).toBe(true);
    // Las cinco de cuerpo, vacías y con tres celdas.
    expect(filas.slice(2)).toHaveLength(5);
    expect(filas.slice(2).every((l) => splitCeldas(l).length === 3)).toBe(true);
  });

  it("deja el cursor en la primera celda de datos", () => {
    const esqueleto = tableSkeleton(3, 5);
    const hasta = esqueleto.text.slice(0, esqueleto.caret);
    const filas = hasta.split("\n");

    // El texto previo al cursor llega hasta la primera celda de la primera
    // fila de cuerpo (línea 2, tras el «|» inicial).
    expect(filas.length).toBeGreaterThanOrEqual(3);
    expect(esqueleto.caret).toBeGreaterThan(0);
    expect(esqueleto.caret).toBeLessThanOrEqual(esqueleto.text.length);
    // Hasta el cursor solo llega la cabecera, el separador y el arranque de la
    // primera celda de la primera fila de cuerpo: «| » y nada más.
    expect(esqueleto.text.slice(0, esqueleto.caret)).toBe(
      `${filas[0]}\n${filas[1]}\n| `,
    );
  });

  it("sigue encontrándose al escribir «tabla»", () => {
    const encontrados = filterSlashItems("tabla");
    expect(encontrados.some((item) => item.id === "table")).toBe(true);
  });

  it("no queda ningún grupo de tamaños aparte", () => {
    // Los tamaños 2×2, 4×3 y 5×5 se fueron con la segunda pantalla.
    const todos = filterSlashItems("");
    const conTamaño = todos.filter((item) => item.size !== undefined);
    expect(conTamaño.map((item) => item.size)).toEqual([{ cols: 3, rows: 5 }]);
  });
});

function splitCeldas(linea: string): string[] {
  return linea
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|");
}
