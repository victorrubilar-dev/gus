import { describe, expect, it } from "vitest";
import {
  decodeImageDest,
  encodeImageDest,
  filterVaultImages,
  imageAlt,
  imageCandidates,
  imageDest,
  imageFolderLabel,
  imageMarkdown,
  isImageLine,
  isImagePath,
  parseImageLine,
  relativePath,
  type VaultImage,
} from "./imageLinks";

const VAULT = "/home/ana/vault";

function imagen(relative: string, modified = 0): VaultImage {
  const name = relative.slice(relative.lastIndexOf("/") + 1);
  return { name, path: `${VAULT}/${relative}`, relative, modified_ms: modified };
}

describe("destino del enlace de imagen", () => {
  it("escapa lo que rompería el Markdown y vuelve al original", () => {
    const casos = [
      "playa (norte).png",
      "100% listo.png",
      "nota#1.png",
      "cumpleaños de mamá.png",
      "subida/archivo.png",
    ];

    for (const ruta of casos) {
      const destino = encodeImageDest(ruta);
      expect(destino).not.toMatch(/[\s()#]/);
      expect(decodeImageDest(destino)).toBe(ruta);
    }
  });

  it("deja las barras y los nombres corrientes tal cual", () => {
    expect(encodeImageDest("adjuntos/foto.png")).toBe("adjuntos/foto.png");
    expect(decodeImageDest("adjuntos/foto.png")).toBe("adjuntos/foto.png");
  });

  it("tolera un destino escrito a mano con un escape roto", () => {
    expect(decodeImageDest("%zz")).toBe("%zz");
    expect(decodeImageDest("  playa.png  ")).toBe("playa.png");
  });
});

describe("enlace de imagen", () => {
  it("usa el nombre sin extensión como texto alternativo", () => {
    expect(imageAlt("/vault/playa.jpg")).toBe("playa");
    expect(imageAlt("/vault/archivo.tar.gz")).toBe("archivo.tar");
    expect(imageMarkdown(imageAlt("playa.jpg"), "playa.jpg")).toBe("![playa](playa.jpg)");
  });

  it("quita corchetes y saltos del texto alternativo", () => {
    expect(imageMarkdown("foto [2]\nsegunda línea", "a.png")).toBe(
      "![foto 2 segunda línea](a.png)",
    );
  });
});

describe("rutas relativas", () => {
  it("deja la imagen junto a la nota sin prefijo", () => {
    expect(imageDest(`${VAULT}/viajes/nota.md`, `${VAULT}/viajes/foto.png`)).toBe("foto.png");
    expect(imageDest(`${VAULT}/nota.md`, `${VAULT}/foto.png`)).toBe("foto.png");
  });

  it("sube con ../ cuando la imagen vive en otra carpeta", () => {
    expect(imageDest(`${VAULT}/viajes/nota.md`, `${VAULT}/adjuntos/foto.png`)).toBe(
      "../adjuntos/foto.png",
    );
  });

  it("recorre hacia abajo cuando la nota está en la raíz", () => {
    expect(imageDest(`${VAULT}/nota.md`, `${VAULT}/adjuntos/fotos/foto.png`)).toBe(
      "adjuntos/fotos/foto.png",
    );
  });

  it("normaliza barras Windows y no inventa rutas ajenas al volumen", () => {
    expect(relativePath("C:\\vault\\notas", "C:\\vault\\fotos\\a.png")).toBe(
      "../fotos/a.png",
    );
    expect(relativePath("C:\\vault", "D:\\otro\\a.png")).toBe("D:/otro/a.png");
  });
});

describe("rutas que puede resolver la vista previa", () => {
  it("resuelve primero junto a la nota y después desde la raíz del vault", () => {
    expect(imageCandidates("foto.png", `${VAULT}/viajes/nota.md`, VAULT)).toEqual([
      `${VAULT}/viajes/foto.png`,
      `${VAULT}/foto.png`,
    ]);
  });

  it("descodifica lo que el enlace trae escapado", () => {
    expect(imageCandidates("playa%20(norte).png", `${VAULT}/nota.md`, VAULT)).toEqual([
      `${VAULT}/playa (norte).png`,
    ]);
  });

  it("respeta las rutas absolutas y las que traen esquema", () => {
    expect(imageCandidates("/etc/logo.png", `${VAULT}/nota.md`, VAULT)).toEqual(["/etc/logo.png"]);
    expect(imageCandidates("~/icono.png", `${VAULT}/nota.md`, VAULT)).toEqual(["~/icono.png"]);
    expect(imageCandidates("data:image/png;base64,AAA=", `${VAULT}/nota.md`, VAULT)).toEqual([]);
    expect(imageCandidates("https://x.test/a.png", `${VAULT}/nota.md`, VAULT)).toEqual([]);
    expect(imageCandidates("", `${VAULT}/nota.md`, VAULT)).toEqual([]);
  });
});

describe("selector de imágenes del vault", () => {
  const imagenes = [
    imagen("adjuntos/playa.png", 30),
    imagen("viajes/playa larga.jpg", 20),
    imagen("cumple.png", 10),
  ];

  it("sin consulta devuelve las más recientes", () => {
    expect(filterVaultImages(imagenes, "").map((image) => image.name)).toEqual([
      "playa.png",
      "playa larga.jpg",
      "cumple.png",
    ]);
  });

  it("prefiere el que empieza por lo tecleado y busca también en la carpeta", () => {
    expect(filterVaultImages(imagenes, "playa").map((image) => image.name)).toEqual([
      "playa.png",
      "playa larga.jpg",
    ]);
    expect(filterVaultImages(imagenes, "viajes").map((image) => image.name)).toEqual([
      "playa larga.jpg",
    ]);
    expect(filterVaultImages(imagenes, "cumple").map((image) => image.name)).toEqual(["cumple.png"]);
  });

  it("ignora acentos y mayúsculas", () => {
    expect(filterVaultImages([imagen("CUMPLEÁNOS.png")], "cumpleanos").map((i) => i.name)).toEqual([
      "CUMPLEÁNOS.png",
    ]);
  });

  it("recorta el listado a lo que cabe en el menú", () => {
    const muchas = Array.from({ length: 30 }, (_, index) => imagen(`foto-${index}.png`));
    expect(filterVaultImages(muchas, "")).toHaveLength(12);
    expect(filterVaultImages(muchas, "foto", 3)).toHaveLength(3);
    expect(filterVaultImages(imagenes, "no-existe")).toEqual([]);
  });

  it("sabe qué carpeta muestra cada imagen", () => {
    expect(imageFolderLabel(imagenes[0])).toBe("adjuntos");
    expect(imageFolderLabel(imagenes[2])).toBeNull();
  });
});

describe("clase de archivo", () => {
  it("reconoce imágenes por la extensión, sin importar mayúsculas", () => {
    expect(isImagePath("/vault/FOTO.PNG")).toBe(true);
    expect(isImagePath("/vault/foto.jpeg")).toBe(true);
    expect(isImagePath("/vault/nota.md")).toBe(false);
    expect(isImagePath("/vault/manual.pdf")).toBe(false);
  });
});

describe("línea que es entera una imagen", () => {
  it("lee el texto alternativo y el destino", () => {
    expect(parseImageLine("![Aventura](vault/Aventura.png)")).toEqual({
      alt: "Aventura",
      destination: "vault/Aventura.png",
      ancho: null,
    });
    // El destino viene escapado por imageMarkdown: se deja tal cual (lo
    // descodifica `decodeImageDest` al resolver la imagen).
    expect(parseImageLine(imageMarkdown("cumpleaños", "/vault/cumplea 1.png"))).toEqual({
      alt: "cumpleaños",
      destination: "/vault/cumplea%201.png",
      ancho: null,
    });
    expect(parseImageLine("  ![subida](../fotos/subida.png)  ")).toEqual({
      alt: "subida",
      destination: "../fotos/subida.png",
      ancho: null,
    });
  });

  it("lee el ancho fijado del texto alternativo", () => {
    expect(parseImageLine("![Aventura|300](vault/Aventura.png)")).toEqual({
      alt: "Aventura",
      destination: "vault/Aventura.png",
      ancho: 300,
    });
    // La variante con alto también se entiende (el alto lo manda la escala).
    expect(parseImageLine("![foto|300x200](a.png)")).toEqual({
      alt: "foto",
      destination: "a.png",
      ancho: 300,
    });
    // Una barra que no remata la línea es texto del alt, no un ancho.
    expect(parseImageLine("![dos|tres](a.png)")).toEqual({
      alt: "dos|tres",
      destination: "a.png",
      ancho: null,
    });
    expect(parseImageLine("![|0](a.png)")).toEqual({
      alt: "",
      destination: "a.png",
      ancho: null,
    });
    expect(isImageLine("![foto|300](a.png)")).toBe(true);
  });

  it("escribe y borra el ancho fijado", () => {
    expect(imageMarkdown("Aventura", "vault/Aventura.png", 300)).toBe(
      "![Aventura|300](vault/Aventura.png)",
    );
    expect(imageMarkdown("Aventura", "vault/Aventura.png", 300.6)).toBe(
      "![Aventura|301](vault/Aventura.png)",
    );
    // Sin ancho (o con uno inútil) el enlace queda como siempre.
    expect(imageMarkdown("Aventura", "vault/Aventura.png", null)).toBe(
      "![Aventura](vault/Aventura.png)",
    );
    expect(imageMarkdown("Aventura", "vault/Aventura.png", 0)).toBe(
      "![Aventura](vault/Aventura.png)",
    );
    // El ancho va siempre detrás del alt ya limpio: de ida y vuelta no se acumula.
    const partes = parseImageLine("![Aventura|300](a.png)");
    expect(imageMarkdown(partes?.alt ?? "", "a.png", 412)).toBe("![Aventura|412](a.png)");
  });

  it("no confunde con texto alrededor ni con otras sintaxis", () => {
    expect(parseImageLine("hola ![foto](a.png) adiós")).toBeNull();
    expect(parseImageLine("# Título ![foto](a.png)")).toBeNull();
    expect(parseImageLine("![foto][referencia]")).toBeNull();
    expect(parseImageLine("![foto](ruta con paréntesis (1).png)")).toBeNull();
    expect(parseImageLine("no es imagen")).toBeNull();
    expect(isImageLine("![foto](a.png)")).toBe(true);
    expect(isImageLine("![foto](a.png) y texto")).toBe(false);
  });
});
