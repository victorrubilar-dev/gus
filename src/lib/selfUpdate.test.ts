import { describe, expect, it } from "vitest";
import { percentDone, reduceDownload, START_PROGRESS } from "./selfUpdate";

describe("progreso de la descarga", () => {
  it("acumula los trozos y calcula el porcentaje", () => {
    let progress = reduceDownload(START_PROGRESS, { event: "Started", data: { contentLength: 1000 } });
    expect(percentDone(progress)).toBe(0);
    progress = reduceDownload(progress, { event: "Progress", data: { chunkLength: 250 } });
    progress = reduceDownload(progress, { event: "Progress", data: { chunkLength: 250 } });
    expect(progress).toEqual({ downloaded: 500, total: 1000 });
    expect(percentDone(progress)).toBe(50);
  });

  it("al terminar llega al 100 % aunque falte algún trozo por contar", () => {
    let progress = reduceDownload(START_PROGRESS, { event: "Started", data: { contentLength: 1000 } });
    progress = reduceDownload(progress, { event: "Progress", data: { chunkLength: 900 } });
    expect(percentDone(reduceDownload(progress, { event: "Finished" }))).toBe(100);
  });

  it("sin tamaño conocido no hay porcentaje", () => {
    const progress = reduceDownload(START_PROGRESS, { event: "Started", data: {} });
    expect(progress.total).toBeNull();
    expect(percentDone(reduceDownload(progress, { event: "Progress", data: { chunkLength: 10 } }))).toBeNull();
  });

  it("no pasa de 100 si el servidor manda más de lo anunciado", () => {
    const progress = { downloaded: 1500, total: 1000 };
    expect(percentDone(progress)).toBe(100);
  });

  it("un tamaño anunciado de 0 no divide por cero", () => {
    expect(percentDone({ downloaded: 0, total: 0 })).toBeNull();
  });
});
