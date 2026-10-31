import { describe, expect, it } from "vitest";
import type { BoardElement } from "./board";
import { contentBounds, renderBoardSvg, wrapNote } from "./boardSvg";

const palette = { text: "#111111", muted: "#888888" };
const rect: BoardElement = { id: "r", type: "rect", color: "#ef4444", x: 10, y: 20, w: 100, h: 50, fill: true };

describe("contentBounds", () => {
  it("una pizarra vacía no tiene contenido", () => {
    expect(contentBounds([])).toBeNull();
    expect(renderBoardSvg([], { palette })).toBeNull();
  });

  it("abarca todos los elementos y cuenta el grosor de los trazos", () => {
    const pen: BoardElement = { id: "p", type: "pen", color: "#000000", width: 10, points: [[0, 0], [40, 0]] };
    const box = contentBounds([rect, pen]);
    expect(box).toMatchObject({ x: -5, y: -5 });
    expect((box?.x ?? 0) + (box?.w ?? 0)).toBe(111); // el rectángulo llega a 110 + 1 de borde
  });
});

describe("renderBoardSvg", () => {
  it("genera un SVG con tamaño, fondo y los elementos", () => {
    const out = renderBoardSvg([rect], { palette, background: "#ffffff", padding: 10 });
    expect(out?.width).toBe(122);
    expect(out?.height).toBe(72);
    expect(out?.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out?.svg).toContain('fill="#ffffff"');
    expect(out?.svg).toContain('fill-opacity="0.18"');
  });

  it("la tinta del tema y las variables se sustituyen por colores reales", () => {
    const text: BoardElement = { id: "t", type: "text", color: "var(--color-gus-text)", x: 0, y: 0, text: "hola", size: 20 };
    const out = renderBoardSvg([text], { palette });
    expect(out?.svg).not.toContain("var(");
    expect(out?.svg).toContain('fill="#111111"');
  });

  it("escapa el texto y descarta colores raros", () => {
    const text: BoardElement = { id: "t", type: "text", color: 'red" onload="x', x: 0, y: 0, text: '<script>alert("x")</script> & más', size: 20 };
    const svg = renderBoardSvg([text], { palette })?.svg ?? "";
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("onload");
  });

  it("una imagen sin cargar es un hueco; con datos, un <image>", () => {
    const image: BoardElement = { id: "i", type: "image", x: 0, y: 0, w: 50, h: 50, src: "fotos/a.png" };
    expect(renderBoardSvg([image], { palette })?.svg).toContain("stroke-dasharray");
    const cargada = renderBoardSvg([image], { palette, images: { "fotos/a.png": "data:image/png;base64,AAAA" } })?.svg ?? "";
    expect(cargada).toContain("<image");
    const peligrosa = renderBoardSvg([image], { palette, images: { "fotos/a.png": "https://evil.example/x.png" } })?.svg ?? "";
    expect(peligrosa).not.toContain("<image");
  });

  it("las flechas llevan su punta y los post-it su texto partido", () => {
    const arrow: BoardElement = { id: "a", type: "arrow", color: "#3b82f6", x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(renderBoardSvg([arrow], { palette })?.svg).toContain("<polygon");
    const note: BoardElement = { id: "n", type: "note", color: "#fde68a", x: 0, y: 0, w: 120, h: 100, text: "una nota bastante larga para que se parta" };
    expect((renderBoardSvg([note], { palette })?.svg.match(/<tspan/g) ?? []).length).toBeGreaterThan(1);
  });
});

describe("wrapNote", () => {
  it("respeta los saltos propios y parte lo que no cabe", () => {
    expect(wrapNote("a\nb", 200)).toEqual(["a", "b"]);
    const lines = wrapNote("palabra palabra palabra", 70);
    expect(lines.every((line) => line.length <= 9)).toBe(true);
    expect(wrapNote("x".repeat(30), 50).length).toBeGreaterThan(2);
  });
});
