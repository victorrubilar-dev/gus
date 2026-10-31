import { describe, expect, it } from "vitest";
import { bytesToBase64, pngScale, svgDataUrl, utf8ToBase64 } from "./boardExport";

describe("boardExport", () => {
  it("el PNG sale al doble y se encoge si el dibujo es enorme", () => {
    expect(pngScale(800, 600)).toBe(2);
    expect(pngScale(20_000, 1000)).toBeLessThan(0.5);
    expect(20_000 * pngScale(20_000, 1000)).toBeLessThanOrEqual(8192);
    const side = 9000;
    expect(side * side * pngScale(side, side) ** 2).toBeLessThanOrEqual(50_000_001);
  });

  it("el Base64 conserva los acentos y los bytes", () => {
    expect(utf8ToBase64("<svg>ñ</svg>")).toBe("PHN2Zz7DsTwvc3ZnPg==");
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe("AP+A");
  });

  it("el SVG viaja como data: URL escapada", () => {
    expect(svgDataUrl('<svg a="#"/>')).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23%22%2F%3E");
  });
});
