import { describe, expect, it } from "vitest";
import { cleanNoteIcon, parseNoteIcon, parseNoteTags, setNoteIcon } from "./noteTags";

describe("icono de la nota", () => {
  it("lee el emoji del frontmatter", () => {
    expect(parseNoteIcon('---\nicon: "📘"\n---\nTexto')).toBe("📘");
    expect(parseNoteIcon("---\ntags: [a]\nicon: 🧪\n---\nTexto")).toBe("🧪");
    expect(parseNoteIcon("icon: 📘\nTexto")).toBeNull();
    expect(parseNoteIcon("---\nicon:\n---\nX")).toBeNull();
  });

  it("crea el frontmatter si no había", () => {
    expect(setNoteIcon("# Hola\n", "📘")).toBe('---\nicon: "📘"\n---\n# Hola\n');
  });

  it("cambia el icono sin tocar las etiquetas", () => {
    const next = setNoteIcon('---\ntags: [casa]\nicon: "📘"\n---\nX', "🧪");
    expect(next).toBe('---\ntags: [casa]\nicon: "🧪"\n---\nX');
    expect(parseNoteTags(next)).toEqual(["casa"]);
  });

  it("quitar el icono borra la línea y el bloque si queda vacío", () => {
    expect(setNoteIcon('---\ntags: [casa]\nicon: "📘"\n---\nX', null)).toBe("---\ntags: [casa]\n---\nX");
    expect(setNoteIcon('---\nicon: "📘"\n---\nX', null)).toBe("X");
    expect(setNoteIcon("X", null)).toBe("X");
  });

  it("se queda con un solo emoji, aunque lleve variantes", () => {
    expect(cleanNoteIcon(" 🗂️ notas")).toBe("🗂️");
    expect(cleanNoteIcon("👩‍💻👍")).toBe("👩‍💻");
    expect(cleanNoteIcon("   ")).toBe("");
  });

  it("respeta los saltos de línea de Windows", () => {
    expect(setNoteIcon("---\r\ntags: [a]\r\n---\r\nX", "📘")).toBe('---\r\ntags: [a]\r\nicon: "📘"\r\n---\r\nX');
  });
});
