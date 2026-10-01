import { describe, expect, it } from "vitest";
import es from "./locales/es";
import en from "./locales/en";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  detectClosestLanguage,
  detectLanguage,
  resolveSystemLanguage,
  setLanguage,
  translate,
} from "./core";

type Catalog = Record<string, string>;

const esCatalog = es as Catalog;
const enCatalog = en as Catalog;

describe("catálogos", () => {
  it("el inglés trae todas las claves del español", () => {
    // Esta es la garantía que mantiene la app traducida: si se añade una clave
    // en español y se olvida el inglés, el tipo de en.ts no cuadra.
    const missing = Object.keys(esCatalog).filter((key) => !(key in enCatalog));
    expect(missing).toEqual([]);
  });

  it("el inglés no trae claves que el español no tiene", () => {
    const extra = Object.keys(enCatalog).filter((key) => !(key in esCatalog));
    expect(extra).toEqual([]);
  });

  it("no deja ninguna traducción sin hacer", () => {
    // Salvo los nombres propios (idiomas, marcas), ningún valor puede ser
    // idéntico en ambos catálogos si lleva palabras del idioma de destino.
    const untranslated = Object.keys(esCatalog).filter(
      (key) => enCatalog[key] === esCatalog[key] && /[áéíóúñ¿¡]/.test(esCatalog[key]),
    );
    expect(untranslated).toEqual([]);
  });

  it("ninguna traducción se queda sin los huecos que la usa", () => {
    const bad = Object.entries(enCatalog).filter(
      ([key, value]) => key in esCatalog && /\{(\w+)\}/.test(esCatalog[key]) && !/\{(\w+)\}/.test(value),
    );
    expect(bad).toEqual([]);
  });

  it("las variantes de plural coinciden con su clave base", () => {
    const orphan = Object.keys(esCatalog).filter((key) => {
      const base = key.split("__")[0];
      return key.includes("__") && !(base in esCatalog);
    });
    expect(orphan).toEqual([]);
  });
});

describe("traducción", () => {
  it("devuelve el texto del idioma pedido", () => {
    expect(translate("es", "common.save")).toBe("Guardar");
    expect(translate("en", "common.save")).toBe("Save");
  });

  it("sustituye los parámetros", () => {
    expect(translate("es", "app.vaultNotFound", { path: "/tmp" })).toContain("/tmp");
    expect(translate("en", "app.vaultNotFound", { path: "/tmp" })).toContain("/tmp");
  });

  it("elige la variante de plural según el idioma", () => {
    // En español 1 es «one» y 2 es «many»; en inglés 1 es «one» y 2 «other».
    expect(translate("es", "trash.count", { count: 1 })).toContain("1 elemento");
    expect(translate("es", "trash.count", { count: 3 })).toContain("3 elementos");
    expect(translate("en", "trash.count", { count: 1 })).toContain("1 item");
    expect(translate("en", "trash.count", { count: 3 })).toContain("3 items");
  });

  it("deja el hueco si falta un parámetro, en vez de imprimir «undefined»", () => {
    expect(translate("es", "app.vaultNotFound")).toContain("{path}");
  });

  it("cae al español si el idioma activo no trae la clave", () => {
    const saved = enCatalog["common.save"];
    enCatalog["common.save"] = "";
    try {
      expect(translate("en", "common.save")).toBe("Guardar");
    } finally {
      enCatalog["common.save"] = saved;
    }
  });
});

describe("idioma activo", () => {
  it("se puede cambiar sin tocar el resto", () => {
    setLanguage("en");
    expect(translate("en", "common.save")).toBe("Save");
    setLanguage("es");
    expect(translate("es", "common.save")).toBe("Guardar");
  });

  it("solo admite los idiomas del catálogo", () => {
    expect(LANGUAGES).toContain("es");
    expect(LANGUAGES).toContain("en");
    expect(LANGUAGES).not.toContain("xx" as never);
  });

  it("detecta el idioma del sistema por su parte antes del guion", () => {
    // El navegador puede decir «en-US» o «es-419»: se mira solo «en» / «es».
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "en-GB", languages: ["en-GB"] },
      configurable: true,
    });
    expect(detectLanguage()).toBe("en");

    Object.defineProperty(globalThis, "navigator", {
      value: { language: "es-419", languages: ["es-419"] },
      configurable: true,
    });
    expect(detectLanguage()).toBe("es");

    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });

  it("devuelve null si el sistema no habla ninguno de los nuestros", () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { language: "ja-JP", languages: ["ja-JP"] },
      configurable: true,
    });
    expect(detectLanguage()).toBeNull();
    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });

  it("si el idioma no está traducido, elige el más parecido y si no inglés", () => {
    const original = globalThis.navigator;

    // Una lengua afín al español se resuelve en español…
    for (const language of ["pt-PT", "fr-CA", "it-IT", "ro-RO"]) {
      Object.defineProperty(globalThis, "navigator", {
        value: { language, languages: [language] },
        configurable: true,
      });
      expect(detectClosestLanguage()).toBe("es");
      expect(resolveSystemLanguage()).toBe("es");
    }

    // …y una sin relación cercana, en inglés.
    for (const language of ["de-DE", "ja-JP", "ru-RU", "zh-CN"]) {
      Object.defineProperty(globalThis, "navigator", {
        value: { language, languages: [language] },
        configurable: true,
      });
      expect(detectClosestLanguage()).toBeNull();
      expect(resolveSystemLanguage()).toBe("en");
    }

    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });

  it("si el sistema no informa de idioma, se queda en el español por defecto", () => {
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    expect(resolveSystemLanguage()).toBe(DEFAULT_LANGUAGE);
    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });
});
