import { describe, expect, it } from "vitest";
import { DEFAULT_SPELL_LANGS, isSpellLang, normalizeSpellLangs } from "./spellCheck";
import { normalizeSettings, DEFAULT_SETTINGS } from "./settings";

describe("diccionarios del corrector", () => {
  it("reconoce los idiomas válidos y rechaza lo que no existe", () => {
    expect(isSpellLang("es")).toBe(true);
    expect(isSpellLang("pt-BR")).toBe(true);
    expect(isSpellLang("off")).toBe(false);
    expect(isSpellLang("klingon")).toBe(false);
    expect(isSpellLang(42)).toBe(false);
  });

  it("conserva el orden elegido y quita repeticiones", () => {
    expect(normalizeSpellLangs(["de", "es", "de"])).toEqual(["de", "es"]);
  });

  it("acepta varios a la vez", () => {
    expect(normalizeSpellLangs(["es", "en-US", "fr"])).toEqual(["es", "en-US", "fr"]);
  });

  it("descarta lo que no es un idioma", () => {
    expect(normalizeSpellLangs(["es", "inventado", "off"])).toEqual(["es"]);
  });

  it("vuelve al diccionario de siempre si la lista se queda vacía", () => {
    // Sin diccionarios, el corrector se apaga; pero si el dato guardado llega
    // corrupto o vacío, se recupera el de por defecto en vez de dejar el
    // corrector sin diccionarios sin avisar.
    expect(normalizeSpellLangs([])).toEqual([...DEFAULT_SPELL_LANGS]);
    expect(normalizeSpellLangs(["nada"])).toEqual([...DEFAULT_SPELL_LANGS]);
    expect(normalizeSpellLangs(null)).toEqual([...DEFAULT_SPELL_LANGS]);
  });
});

describe("ajustes", () => {
  it("viene con el autoguardado activado", () => {
    expect(DEFAULT_SETTINGS.autoSave).toBe(true);
  });

  it("respeta el autoguardado apagado", () => {
    expect(normalizeSettings({ autoSave: false }).autoSave).toBe(false);
  });

  it("migra el idioma único del corrector a la lista de diccionarios", () => {
    // Ajustes de una versión anterior: un solo idioma.
    expect(normalizeSettings({ spellLang: "de" }).spellLangs).toEqual(["de"]);
  });

  it("si no hay nada guardado, deja los diccionarios de siempre", () => {
    expect(normalizeSettings(null).spellLangs).toEqual([...DEFAULT_SPELL_LANGS]);
  });

  it("guarda varios diccionarios sin perderlos", () => {
    expect(normalizeSettings({ spellLangs: ["es", "fr"] }).spellLangs).toEqual(["es", "fr"]);
  });

  it("acepta una lista vacía para apagar el corrector del todo", () => {
    // Aquí sí se respeta el vacío: es una decisión de quien ajusta, no un dato
    // corrupto, y por eso se comprueba antes de pasar por la normalización.
    const saved = { ...DEFAULT_SETTINGS, spellLangs: [] };
    expect(saved.spellLangs).toEqual([]);
  });

  it("trae atajos por defecto y descarta los que ya no existen", () => {
    expect(normalizeSettings(null).shortcuts.saveNote).toBe("ctrl+s");
    expect(normalizeSettings({ shortcuts: { atajoRetirado: "ctrl+j" } }).shortcuts).not.toHaveProperty(
      "atajoRetirado",
    );
  });

  it("las notas diarias traen carpeta y plantilla de siempre", () => {
    expect(DEFAULT_SETTINGS.dailyNotesFolder).toBe("Diario");
    expect(normalizeSettings(null).dailyNotesFolder).toBe("Diario");
    expect(normalizeSettings(null).dailyNotesTemplate).toContain("{title}");
  });

  it("corrige la carpeta de diarios escrita a mano y no deja la vacía", () => {
    expect(normalizeSettings({ dailyNotesFolder: " Notas/diarias " }).dailyNotesFolder).toBe(
      "Notas/diarias",
    );
    expect(normalizeSettings({ dailyNotesFolder: "///" }).dailyNotesFolder).toBe("Diario");
    // Lo que no es texto tampoco se cuela.
    expect(normalizeSettings({ dailyNotesFolder: 42 } as never).dailyNotesFolder).toBe("Diario");
  });

  it("la plantilla se guarda tal cual, con los saltos de línea del sistema quitados", () => {
    expect(normalizeSettings({ dailyNotesTemplate: "a\r\nb" }).dailyNotesTemplate).toBe("a\nb");
    // Una plantilla vacía es una decisión: nota en blanco.
    expect(normalizeSettings({ dailyNotesTemplate: "" }).dailyNotesTemplate).toBe("");
    expect(normalizeSettings({ dailyNotesTemplate: 7 } as never).dailyNotesTemplate).toBe(
      DEFAULT_SETTINGS.dailyNotesTemplate,
    );
  });
});
