import { describe, expect, it } from "vitest";
import { folderPickerPath } from "./androidPath";

const TREE = "content://com.android.externalstorage.documents/tree/";

describe("folderPickerPath", () => {
  it("deja igual una ruta de escritorio", () => {
    expect(folderPickerPath("/home/ana/Notas")).toBe("/home/ana/Notas");
    expect(folderPickerPath("C:\\Notas")).toBe("C:\\Notas");
  });

  it("traduce la memoria interna", () => {
    expect(folderPickerPath(`${TREE}primary%3ADocuments%2FGus`)).toBe("/storage/emulated/0/Documents/Gus");
    expect(folderPickerPath(`${TREE}primary%3A`)).toBe("/storage/emulated/0");
    expect(folderPickerPath(`${TREE}primary%3ANotas%20de%20casa`)).toBe("/storage/emulated/0/Notas de casa");
  });

  it("traduce una tarjeta SD por su id de volumen", () => {
    expect(folderPickerPath(`${TREE}1234-ABCD%3AGus`)).toBe("/storage/1234-ABCD/Gus");
  });

  it("rechaza otros proveedores de documentos", () => {
    expect(() => folderPickerPath("content://com.google.android.apps.docs.storage/tree/abc")).toThrow();
  });
});
