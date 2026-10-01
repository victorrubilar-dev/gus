import { describe, expect, it } from "vitest";
import { actionRect } from "./tableLayout";

/**
 * Rectángulo de tres celdas marcadas: la que el menú trae consigo.
 */
const MARCADO = { top: 1, bottom: 3, left: 0, right: 1 } as const;

/** Rectángulo que queda en el estado tras un clic llano. */
const DE_ESTADO = { top: 1, bottom: 2, left: 0, right: 2 } as const;

describe("rectángulo con el que se ejecuta una acción de tabla", () => {
  it("usa el del menú, que es el que la persona tenía marcado", () => {
    // El clic derecho colapsa la selección y el estado queda vacío: si se
    // mirara solo el estado, «Copiar celdas» se llevaría otra cosa (o nada).
    expect(actionRect(MARCADO, null)).toEqual(MARCADO);
  });

  it("manda el del menú aunque el estado tenga otro distinto", () => {
    expect(actionRect(MARCADO, DE_ESTADO)).toEqual(MARCADO);
  });

  it("si el menú no trae ninguno, tira del estado", () => {
    // Las acciones del menú «/» no llevan rectángulo: ahí vale el del estado.
    expect(actionRect(null, DE_ESTADO)).toEqual(DE_ESTADO);
  });

  it("si no hay ninguno de los dos, no hay rectángulo", () => {
    expect(actionRect(null, null)).toBeNull();
  });
});
