import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  comboFor,
  matchesCombo,
} from "./shortcuts";

/**
 * Réplica del manejador global de `App`: recibe un evento y devuelve qué acción
 * se dispararía. Sirve para comprobar de extremo a extremo que los atajos
 * llegan desde los valores por defecto hasta la acción.
 */
function simularAccion(key: string, code: string, mods: Partial<{
  ctrl: boolean; alt: boolean; shift: boolean; meta: boolean;
}> = {}): string | null {
  const event = {
    key, code,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  };

  const global = ["zoomIn", "zoomOut", "zoomReset", "newTask", "commandPalette",
    "focusSearch", "togglePanel"] as const;

  for (const id of global) {
    if (matchesCombo(event, comboFor(DEFAULT_SHORTCUTS, id))) return id;
  }
  return null;
}

describe("el zoom con el teclado, de extremo a extremo", () => {
  it("agranda con Ctrl+»+» y con Ctrl+Mayús+»+»", () => {
    expect(simularAccion("=", "Equal", { ctrl: true })).toBe("zoomIn");
    // El «+» de verdad: Mayús pulsado, que es como se escribe.
    expect(simularAccion("+", "Equal", { ctrl: true, shift: true })).toBe("zoomIn");
    expect(simularAccion("+", "NumpadAdd", { ctrl: true })).toBe("zoomIn");
  });

  it("achica con Ctrl+»-» y con Ctrl+Mayús+»-»", () => {
    expect(simularAccion("-", "Minus", { ctrl: true })).toBe("zoomOut");
    // Con Mayús, el guion llega como «_».
    expect(simularAccion("_", "Minus", { ctrl: true, shift: true })).toBe("zoomOut");
    expect(simularAccion("-", "NumpadSubtract", { ctrl: true })).toBe("zoomOut");
  });

  it("restablece el tamaño con Ctrl+0", () => {
    expect(simularAccion("0", "Digit0", { ctrl: true })).toBe("zoomReset");
  });

  it("no se dispara sin Ctrl", () => {
    expect(simularAccion("=", "Equal")).toBeNull();
    expect(simularAccion("-", "Minus")).toBeNull();
  });

  it("no confunde agrandar con achicar", () => {
    expect(simularAccion("=", "Equal", { ctrl: true })).not.toBe("zoomOut");
    expect(simularAccion("-", "Minus", { ctrl: true })).not.toBe("zoomIn");
  });

  it("no se pisa con la paleta ni con las tareas", () => {
    expect(simularAccion("k", "KeyK", { ctrl: true })).toBe("commandPalette");
    expect(simularAccion("N", "KeyN", { ctrl: true, shift: true })).toBe("newTask");
  });
});
