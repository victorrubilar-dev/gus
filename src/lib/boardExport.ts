/** Pizarra → imagen: paleta, SVG como `data:` y PNG a partir del SVG. */
import type { BoardSvg, BoardSvgPalette } from "./boardSvg";

/** Tinta oscura sobre papel blanco: lo exportado se ve bien en cualquier visor. */
export const EXPORT_PALETTE: BoardSvgPalette = { text: "#1f2328", muted: "#6b7280" };
export const EXPORT_BACKGROUND = "#ffffff";

/** Lado máximo del PNG: por encima, los navegadores se niegan a pintar el lienzo. */
const MAX_SIDE = 8192;
const MAX_PIXELS = 50_000_000;

/** Los colores del tema actual, para pintar miniaturas que combinen con la interfaz. */
export function themePalette(): BoardSvgPalette {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { text: read("--color-gus-text", EXPORT_PALETTE.text), muted: read("--color-gus-muted", EXPORT_PALETTE.muted) };
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Texto UTF-8 en Base64, que es como viaja un archivo hasta el backend. */
export function utf8ToBase64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Factor de ampliación del PNG: el doble si cabe y menos si el dibujo es enorme. */
export function pngScale(width: number, height: number): number {
  const bySide = MAX_SIDE / Math.max(width, height, 1);
  const byArea = Math.sqrt(MAX_PIXELS / Math.max(width * height, 1));
  return Math.max(0.1, Math.min(2, bySide, byArea));
}

/** Rasteriza el SVG de una pizarra a PNG (con fondo, porque el SVG ya lo lleva). */
export async function svgToPng(board: BoardSvg): Promise<Uint8Array> {
  const scale = pngScale(board.width, board.height);
  const image = new Image();
  image.src = svgDataUrl(board.svg);
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(board.width * scale));
  canvas.height = Math.max(1, Math.round(board.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("El navegador no puede crear el lienzo de la imagen");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo generar el PNG");
  return new Uint8Array(await blob.arrayBuffer());
}
