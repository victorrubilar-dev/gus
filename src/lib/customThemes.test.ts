import { describe, expect, it } from "vitest";
import {
  customThemeKey,
  exportThemeJson,
  importThemeJson,
  lowContrastPairs,
  normalizeCustomThemes,
  type CustomTheme,
} from "./customThemes";
import { normalizeSettings } from "./settings";
import { resolveTheme } from "./themes";

const MIO: CustomTheme = {
  id: "abc",
  name: "Mío",
  scheme: "dark",
  accent: "#ff8800",
  colors: { bg: "#101010", panel: "#181818", card: "#202020", border: "#333333", text: "#f0f0f0", muted: "#a0a0a0", eyes: "#81b29a" },
};

describe("temas personalizados", () => {
  it("se quedan solo los válidos, sin repetir id", () => {
    const lista = normalizeCustomThemes([MIO, { ...MIO }, { ...MIO, id: "otro", accent: "rojo" }, 3, null]);
    expect(lista).toEqual([MIO]);
    expect(normalizeCustomThemes("nada")).toEqual([]);
  });

  it("exportar e importar devuelve el mismo tema con un id nuevo", () => {
    const json = exportThemeJson(MIO);
    expect(json).not.toContain('"id"');
    expect(importThemeJson(json, "nuevo")).toEqual({ ...MIO, id: "nuevo" });
  });

  it("un JSON roto o que no es un tema se explica", () => {
    expect(() => importThemeJson("{", "x")).toThrow("invalidJson");
    expect(() => importThemeJson('{"name":"x"}', "x")).toThrow("invalidTheme");
  });

  it("los ajustes aceptan el tema activo solo si existe", () => {
    const ok = normalizeSettings({ theme: customThemeKey(MIO), customThemes: [MIO] });
    expect(ok.theme).toBe("custom-abc");
    expect(resolveTheme(ok.theme, ok.customThemes).vars["--color-gus-bg"]).toBe("#101010");
    const huerfano = normalizeSettings({ theme: "custom-borrado", customThemes: [MIO] });
    expect(huerfano.theme).toBe("gus-oscuro");
  });

  it("avisa de los colores que no se leen bien", () => {
    expect(lowContrastPairs(MIO)).toEqual([]);
    expect(lowContrastPairs({ ...MIO, colors: { ...MIO.colors, muted: "#333333" } })).toEqual(["muted"]);
  });
});
