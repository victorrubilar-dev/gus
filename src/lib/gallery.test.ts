import { describe, expect, it } from "vitest";
import { filterGallery, galleryFolders, imageFolder, stepIndex } from "./gallery";
import type { VaultImage } from "./imageLinks";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

function imagen(relative: string, daysAgo: number): VaultImage {
  return { name: relative.split("/").pop() ?? relative, path: `/v/${relative}`, relative, modified_ms: NOW - daysAgo * DAY };
}

const IMAGENES = [
  imagen("captura.png", 1),
  imagen("viajes/Playa.jpg", 10),
  imagen("viajes/2024/monte.webp", 100),
  imagen("clases/diagrama.png", 400),
];

describe("galería", () => {
  it("saca la carpeta de cada imagen y lista las carpetas con la raíz primero", () => {
    expect(imageFolder(IMAGENES[0])).toBe("");
    expect(imageFolder(IMAGENES[2])).toBe("viajes/2024");
    expect(galleryFolders(IMAGENES)).toEqual(["", "clases", "viajes", "viajes/2024"]);
  });

  it("filtra por carpeta exacta, sin subcarpetas", () => {
    const viajes = filterGallery(IMAGENES, { folder: "viajes", period: "all", query: "" }, NOW);
    expect(viajes.map((image) => image.name)).toEqual(["Playa.jpg"]);
  });

  it("filtra por antigüedad", () => {
    const mes = filterGallery(IMAGENES, { folder: null, period: "month", query: "" }, NOW);
    expect(mes.map((image) => image.name)).toEqual(["captura.png", "Playa.jpg"]);
    const año = filterGallery(IMAGENES, { folder: null, period: "year", query: "" }, NOW);
    expect(año).toHaveLength(3);
  });

  it("busca por nombre o ruta sin distinguir mayúsculas", () => {
    expect(filterGallery(IMAGENES, { folder: null, period: "all", query: "playa" }, NOW)).toHaveLength(1);
    expect(filterGallery(IMAGENES, { folder: null, period: "all", query: "viajes" }, NOW)).toHaveLength(2);
  });

  it("anterior y siguiente dan la vuelta", () => {
    expect(stepIndex(0, -1, 4)).toBe(3);
    expect(stepIndex(3, 1, 4)).toBe(0);
    expect(stepIndex(1, 1, 4)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});
