import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LIST,
  comboFor,
  comboFromEvent,
  comboLabel,
  isEditableShortcut,
  matchesCombo,
  normalizeShortcuts,
  parseCombo,
  shortcutConflict,
} from "./shortcuts";
import { setLanguage } from "./i18n/core";

/** Evento de teclado con la forma que usan las comparaciones. */
function key(
  name: string,
  mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {},
) {
  return {
    key: name,
    code: "",
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  };
}

describe("combinaciones", () => {
  it("lee una combinación con modificadores", () => {
    expect(parseCombo("Ctrl+Shift+K")).toEqual({ ctrl: true, alt: false, shift: true, key: "k" });
  });

  it("acepta alias de modificadores", () => {
    expect(parseCombo("cmd+alt+x")).toEqual({ ctrl: true, alt: true, shift: false, key: "x" });
    expect(parseCombo("Option+Enter")).toEqual({
      ctrl: false,
      alt: true,
      shift: false,
      key: "enter",
    });
  });

  it("rechaza combinaciones imposibles", () => {
    expect(parseCombo("ctrl")).toBeNull();
    expect(parseCombo("ctrl+a+b")).toBeNull();
    expect(parseCombo("")).toBeNull();
    // Texto que no es una tecla: se descarta en vez de guardarse como atajo.
    expect(parseCombo("esto no es un atajo")).toBeNull();
    expect(parseCombo("ctrl+quimera")).toBeNull();
  });

  it("normaliza el «+» del teclado numérico al «=» de la tecla física", () => {
    // Ctrl+= y Ctrl++ tienen que ser el mismo atajo.
    expect(comboFromEvent(key("+", { ctrl: true }))).toBe(comboFromEvent(key("=", { ctrl: true })));
  });

  it("acepta los signos que se usan como tecla, no solo letras", () => {
    // Regresión: con un filtro demasiado estrecho, «ctrl+=» y «ctrl+-» se
    // descartaban por no ser un atajo y el zoom se quedaba sin teclado.
    expect(parseCombo("ctrl+=")).toEqual({ ctrl: true, alt: false, shift: false, key: "=" });
    expect(parseCombo("ctrl+-")).toEqual({ ctrl: true, alt: false, shift: false, key: "-" });
    expect(parseCombo("ctrl+`")).not.toBeNull();
  });

  it("convierte ⌘ y Ctrl en el mismo atajo", () => {
    expect(comboFromEvent(key("k", { meta: true }))).toBe(comboFromEvent(key("k", { ctrl: true })));
  });
});

describe("comparación con un evento", () => {
  it("reconoce el atajo exacto", () => {
    expect(matchesCombo(key("k", { ctrl: true }), "ctrl+k")).toBe(true);
  });

  it("no acepta un modificador de más o de menos", () => {
    expect(matchesCombo(key("k", { ctrl: true, shift: true }), "ctrl+k")).toBe(false);
    expect(matchesCombo(key("k"), "ctrl+k")).toBe(false);
  });

  it("distingue mayúsculas sinerrecces", () => {
    expect(matchesCombo(key("K", { ctrl: true, shift: true }), "ctrl+shift+k")).toBe(true);
  });
});

describe("etiquetas de las teclas", () => {
  beforeEach(() => setLanguage("es"));

  it("usa símbolos para las flechas", () => {
    expect(comboLabel("alt+arrowup")).toBe("Alt+↑");
  });

  it("nombra el resto de teclas en el idioma activo", () => {
    expect(comboLabel("alt+enter")).toBe("Alt+Intro");
    setLanguage("en");
    expect(comboLabel("alt+enter")).toBe("Alt+Enter");
  });

  it("devuelve cadena vacía si no hay atajo", () => {
    expect(comboLabel("")).toBe("");
  });
});

describe("catálogo de atajos", () => {
  it("no repite combinación entre atajos que no son contextuales", () => {
    const seen = new Map<string, string>();
    for (const entry of SHORTCUT_LIST) {
      if (entry.contextual) continue;
      const combo = entry.defaultCombo;
      const other = seen.get(combo);
      expect(other, `«${combo}» la usan ${other} y ${entry.id}`).toBeUndefined();
      seen.set(combo, entry.id);
    }
  });

  it("solo deja sin modificador teclas que no escriben texto", () => {
    const bare = SHORTCUT_LIST.filter((entry) => !/ctrl|alt/.test(entry.defaultCombo));
    // Ahora mismo no hay ninguno: cualquier tecla suelta se reserva al teclado.
    expect(bare.every((entry) => /^f([1-9]|1\d|2[0-4])$/.test(entry.defaultCombo))).toBe(true);
  });

  it("marca como del sistema solo los atajos que no se pueden reasignar", () => {
    for (const entry of SHORTCUT_LIST) {
      const editable = isEditableShortcut(entry.id);
      expect(editable).toBe(!entry.system);
    }
  });
});

describe("el zoom con el teclado", () => {
  it("agranda con Ctrl+= y también con Ctrl+Mayús+»+»", () => {
    // El «+» se escribe con Mayús, así que esa es la pulsación natural.
    expect(matchesCombo(key("=", { ctrl: true }), "ctrl+=")).toBe(true);
    expect(matchesCombo(key("+", { ctrl: true, shift: true }), "ctrl+=")).toBe(true);
  });

  it("achica con Ctrl+- y también con Ctrl+Mayús+»-» (que llega como «_»)", () => {
    expect(matchesCombo(key("-", { ctrl: true }), "ctrl+-")).toBe(true);
    expect(matchesCombo(key("_", { ctrl: true, shift: true }), "ctrl+-")).toBe(true);
  });

  it("también con el teclado numérico", () => {
    expect(matchesCombo(key("+", { ctrl: true }), "ctrl+=")).toBe(true);
    expect(matchesCombo(key("-", { ctrl: true }), "ctrl+-")).toBe(true);
  });

  it("graba el atajo sin el Mayús, para que no dependa de cómo se pulse", () => {
    expect(comboFromEvent(key("+", { ctrl: true, shift: true }))).toBe("ctrl+=");
    expect(comboFromEvent(key("_", { ctrl: true, shift: true }))).toBe("ctrl+-");
  });

  it("el Mayús sigue contando en las teclas que no tienen variante", () => {
    expect(matchesCombo(key("n", { ctrl: true }), "ctrl+shift+n")).toBe(false);
    expect(matchesCombo(key("N", { ctrl: true, shift: true }), "ctrl+shift+n")).toBe(true);
  });

  it("se enseña como «+» y «−», que es como se dicen", () => {
    expect(comboLabel("ctrl+=")).toBe("Ctrl++");
    expect(comboLabel("ctrl+-")).toBe("Ctrl+−");
  });
});

describe("ajustes de atajos", () => {
  it("devuelve los valores por defecto si no hay nada guardado", () => {
    expect(normalizeShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    expect(normalizeShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
  });

  it("conserva solo las combinaciones legibles", () => {
    const saved = normalizeShortcuts({
      saveNote: "Ctrl+Alt+S",
      newNote: "esto no es un atajo",
      zoomIn: "",
    });

    expect(saved.saveNote).toBe("ctrl+alt+s");
    // Cadena inválida: se queda el valor por defecto.
    expect(saved.newNote).toBe(DEFAULT_SHORTCUTS.newNote);
    // Vacío = sin atajo, y se guarda como tal.
    expect(saved.zoomIn).toBe("");
  });

  it("descarta atajos de acciones que ya no existen", () => {
    const saved = normalizeShortcuts({ atajoAntiguo: "ctrl+j" });
    expect(saved).not.toHaveProperty("atajoAntiguo");
  });

  it("usa el valor guardado y, si no hay, el de por defecto", () => {
    const map = { saveNote: "ctrl+s" };
    expect(comboFor(map, "saveNote")).toBe("ctrl+s");
    expect(comboFor(map, "undo")).toBe(DEFAULT_SHORTCUTS.undo);
    expect(comboFor(null, "undo")).toBe(DEFAULT_SHORTCUTS.undo);
  });
});

describe("conflictos", () => {
  it("avisa si la combinación ya la usa otro atajo editable", () => {
    const clash = shortcutConflict("ctrl+n", "saveNote");
    expect(clash?.id).toBe("newNote");
  });

  it("no avisa si se reasigna el atajo que ya tenía", () => {
    expect(shortcutConflict("ctrl+s", "saveNote")).toBeNull();
  });

  it("no molesta con los atajos del sistema", () => {
    // Ctrl+C es del sistema: elegirlo no se considera un conflicto editable.
    expect(shortcutConflict("ctrl+c", "saveNote")).toBeNull();
  });

  it("deja coexistir a los atajos que atienden en sitios distintos", () => {
    // Alt+↑ mueve la línea en el editor y sube de carpeta en el explorador.
    expect(shortcutConflict("alt+arrowup", "parentFolder")).toBeNull();
    expect(shortcutConflict("alt+arrowup", "moveLineUp")).toBeNull();
  });
});
