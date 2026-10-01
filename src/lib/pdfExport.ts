/**
 * Exportación de una nota a PDF.
 *
 * La nota se maqueta en columnas de ancho fijo (CSS Multicol, una columna por
 * página A4) y cada página se captura como imagen con `modern-screenshot`, que
 * deja el renderizado en manos del propio navegador. Así el PDF sale idéntico
 * a la vista previa del diálogo: tablas, fórmulas, diagramas y estilos incluidos.
 */
import { domToJpeg, waitUntilLoad, type Options } from "modern-screenshot";
import { t } from "./i18n";

/** Lienzo A4 (210 × 297 mm), en milímetros y en píxeles CSS (96 ppp). */
export const PDF_PAGE_WIDTH_MM = 210;
export const PDF_PAGE_HEIGHT_MM = 297;
export const PDF_PAGE_WIDTH_PX = (PDF_PAGE_WIDTH_MM * 96) / 25.4;
export const PDF_PAGE_HEIGHT_PX = (PDF_PAGE_HEIGHT_MM * 96) / 25.4;
/** Columna útil de cada página, en píxeles CSS (≈ 180 mm de ancho). */
export const PDF_COLUMN_WIDTH = 680;
export const PDF_COLUMN_HEIGHT = 1010;
/** Página A4 en puntos, la unidad del PDF. */
const PDF_PAGE_WIDTH_PT = 595.28;
const PDF_PAGE_HEIGHT_PT = 841.89;
/** Captura a 2× (≈ 192 ppp). */
const CAPTURE_SCALE = 2;
const JPEG_QUALITY = 0.92;

export interface PdfPageImage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

/**
 * Mueve el strip a la página indicada (el flujo va en horizontal).
 *
 * El paso real se lee de la maquetación, no se asume: la holgura de anchura
 * hace que cada columna pese unos píxeles más de 680 y el desfase acumulado
 * dejaría asomar un filo de la columna vecina.
 */
export function showStripPage(strip: HTMLElement, page: number): void {
  const layoutWidth = strip.offsetWidth;
  const columns = Math.max(1, Math.round(layoutWidth / PDF_COLUMN_WIDTH));
  const pitch = layoutWidth > 0 ? layoutWidth / columns : PDF_COLUMN_WIDTH;
  strip.style.transform = `translateX(${-page * pitch}px)`;
}

/** Da al strip la anchura necesaria para `pages` columnas. */
function setStripPages(strip: HTMLElement, pages: number): void {
  // Los 2 px de holgura evitan que un redondeo recorte la última columna.
  strip.style.width = `${pages * PDF_COLUMN_WIDTH + 2}px`;
}

/**
 * Columnas que ocupa el contenido: se lee la posición del marcador final, una
 * línea de altura 0 que cierra el strip. Todas las medidas se pasan a
 * coordenadas de maquetación para que el escalado de la previsualización (y
 * los 2 px de holgura de la anchura) no deformen el recuento.
 */
function countStripPages(strip: HTMLElement): number {
  const marker = strip.querySelector<HTMLElement>("[data-pdf-end]");
  if (!marker) return 1;

  const layoutWidth = strip.offsetWidth;
  if (layoutWidth <= 0) return 1;
  const columns = Math.max(1, Math.round(layoutWidth / PDF_COLUMN_WIDTH));
  const layoutColumnWidth = layoutWidth / columns;

  const stripRect = strip.getBoundingClientRect();
  const scale = stripRect.width > 0 ? stripRect.width / layoutWidth : 1;
  const markerRect = marker.getBoundingClientRect();

  const column = Math.round((markerRect.left - stripRect.left) / (layoutColumnWidth * scale));
  // Si el marcador cae al borde superior de una columna es que el contenido
  // acabó justo en el cierre de la anterior: esa columna queda vacía.
  const startsEmpty = (markerRect.top - stripRect.top) / scale <= 1;
  return Math.max(1, startsEmpty && column > 0 ? column : column + 1);
}

/**
 * Pagina el strip y devuelve el número de páginas. Amplía su anchura hasta que
 * el contenido ya no llega a la última columna.
 */
export function layoutStrip(strip: HTMLElement): number {
  let pages = 12;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    setStripPages(strip, pages);
    const used = countStripPages(strip);
    if (used < pages) return used;
    pages *= 2;
  }
  return pages;
}

/** Espera a que el contenido tenga fuentes, imágenes e iconos resueltos. */
export async function settlePage(node: HTMLElement): Promise<void> {
  try {
    await Promise.all([waitUntilLoad(node), document.fonts?.ready]);
  } catch {
    // Sin medios que cargar: se sigue adelante.
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const binary = atob(comma === -1 ? dataUrl : dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Dimensiones reales de un JPEG leídas de su cabecera (SOF). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let at = 2;
  while (at + 8 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      return {
        height: (bytes[at + 5] << 8) | bytes[at + 6],
        width: (bytes[at + 7] << 8) | bytes[at + 8],
      };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      at += 2;
      continue;
    }
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }
  throw new Error(t("pdf.export.badJpeg"));
}

/** Captura una ventana de página como JPEG listo para el PDF. */
export async function capturePdfPage(element: HTMLElement, background: string): Promise<PdfPageImage> {
  const shoot = (font: Options["font"]) =>
    domToJpeg(element, {
      // Tamaño propio de la hoja: así el escalado de la previsualización no
      // influye en la captura y el PDF sale siempre a resolución completa.
      width: PDF_PAGE_WIDTH_PX,
      height: PDF_PAGE_HEIGHT_PX,
      scale: CAPTURE_SCALE,
      quality: JPEG_QUALITY,
      backgroundColor: background,
      font,
    });

  let dataUrl: string;
  try {
    dataUrl = await shoot({ preferredFormat: "woff2" });
  } catch {
    // Si incrustar las tipografías falla, se captura igual con las del
    // sistema: las fórmulas se ven peor, pero la nota sí se exporta.
    dataUrl = await shoot(false);
  }

  const jpeg = dataUrlToBytes(dataUrl);
  const { width, height } = jpegSize(jpeg);
  return { jpeg, width, height };
}

function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    // PDFDocEncoding cubre el Latin-1: el resto se sustituye.
    const safe = code >= 32 && code <= 255 ? char : "?";
    out += safe === "(" || safe === ")" || safe === "\\" ? `\\${safe}` : safe;
  }
  return `(${out})`;
}

/**
 * Monta el PDF con las páginas capturadas, cada una a tamaño A4. Todo el texto
 * del PDF son las imágenes: no hay capa de texto seleccionable.
 */
export function buildPdf(pages: PdfPageImage[], title: string): Uint8Array {
  if (pages.length === 0) throw new Error(t("pdf.export.noPages"));

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const write = (part: string | Uint8Array): void => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  };

  // Ids fijos: catálogo, páginas, tríos (página, contenido, imagen) e info.
  const pageId = (index: number): number => 3 + index * 3;
  const contentId = (index: number): number => 4 + index * 3;
  const imageId = (index: number): number => 5 + index * 3;
  const infoId = 3 + pages.length * 3;
  const size = infoId + 1;
  const offsets = new Array<number>(size).fill(0);

  // Cabecera y comentario binario: avisa de que el contenido no es solo texto.
  write(
    new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
    ]),
  );

  const object = (id: number, body: string): void => {
    offsets[id] = offset;
    write(`${id} 0 obj\n${body}\nendobj\n`);
  };

  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(" ");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    object(
      pageId(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH_PT} ${PDF_PAGE_HEIGHT_PT}] ` +
        `/Resources << /XObject << /Im0 ${imageId(index)} 0 R >> >> /Contents ${contentId(index)} 0 R >>`,
    );

    const content = `q\n${PDF_PAGE_WIDTH_PT} 0 0 ${PDF_PAGE_HEIGHT_PT} 0 0 cm\n/Im0 Do\nQ\n`;
    offsets[contentId(index)] = offset;
    write(
      `${contentId(index)} 0 obj\n<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`,
    );

    offsets[imageId(index)] = offset;
    write(
      `${imageId(index)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    write(page.jpeg);
    write("\nendstream\nendobj\n");
  });

  object(
    infoId,
    `<< /Title ${pdfString(title)} /Producer (Gus) /Creator (Gus) >>`,
  );

  const xrefOffset = offset;
  write(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) {
    write(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const pdf = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    pdf.set(chunk, at);
    at += chunk.length;
  }
  return pdf;
}

/** Base64 para enviar el PDF por IPC (Rust lo decodifica al escribir). */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}
