import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkForUpdate,
  isNewerVersion,
  normalizeVersion,
  pickInstaller,
  type InstallerAsset,
} from "./updateCheck";

describe("normalizeVersion", () => {
  it("quita la «v» inicial y los espacios", () => {
    expect(normalizeVersion(" v1.2.3 ")).toBe("1.2.3");
    expect(normalizeVersion("1.2.3")).toBe("1.2.3");
  });
});

describe("isNewerVersion", () => {
  it("compara los segmentos como números y no como texto", () => {
    expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
    expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
    expect(isNewerVersion("2.0", "1.9.9")).toBe(true);
  });

  it("no dice que algo es nuevo si es la misma versión", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("0.1.0", "v0.1.0")).toBe(false);
  });

  it("no toma una versión más vieja por delante", () => {
    expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "10.0.0")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("avisa cuando la release publicada es más nueva", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tag_name: "v9.9.9", html_url: "https://example.com/r" }),
      })),
    );

    const result = await checkForUpdate("0.1.0");
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("se esperaba una versión nueva");
    expect(result.info.version).toBe("9.9.9");
    expect(result.info.url).toBe("https://example.com/r");
  });

  it("no dice nada si la versión instalada ya es la última", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: "v0.1.0" }) })),
    );

    expect(await checkForUpdate("0.1.0")).toEqual({ status: "uptodate" });
    expect(await checkForUpdate("0.2.0")).toEqual({ status: "uptodate" });
  });

  it("recurre a la última etiqueta si el proyecto aún no usa releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // La release no existe (404)…
        .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
        // …pero sí hay etiquetas.
        .mockResolvedValueOnce({ ok: true, json: async () => [{ name: "v0.3.0" }] }),
    );

    const result = await checkForUpdate("0.1.0");
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("se esperaba una versión nueva");
    expect(result.info.version).toBe("0.3.0");
    expect(result.info.url).toContain("/releases/tag/v0.3.0");
  });

  it("devuelve «unavailable» si no hay red, en vez de romper el arranque", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    expect(await checkForUpdate("0.1.0")).toEqual({ status: "unavailable" });
  });

  it("devuelve «unavailable» si GitHub limita las peticiones", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403 })));

    expect(await checkForUpdate("0.1.0")).toEqual({ status: "unavailable" });
  });
});

describe("pickInstaller", () => {
  const assets: InstallerAsset[] = [
    { name: "gus_0.1.4_amd64.deb", url: "https://x/deb" },
    { name: "gus_0.1.4_x64-setup.exe", url: "https://x/exe" },
    { name: "gus_0.1.4_x64_en-US.msi", url: "https://x/msi" },
    { name: "gus_0.1.4_aarch64.dmg", url: "https://x/dmg" },
    { name: "gus_0.1.4_amd64.AppImage", url: "https://x/appimage" },
  ];
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
  const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)";
  const LINUX = "Mozilla/5.0 (X11; Linux x86_64)";

  it("elige el instalador de cada plataforma", () => {
    expect(pickInstaller(assets, WINDOWS)?.url).toBe("https://x/exe");
    expect(pickInstaller(assets, MAC)?.url).toBe("https://x/dmg");
    expect(pickInstaller(assets, LINUX)?.url).toBe("https://x/appimage");
  });

  it("devuelve null si la plataforma no se reconoce o no hay instalador para ella", () => {
    expect(pickInstaller(assets, "Mozilla/5.0 (iPhone)")).toBeNull();
    expect(pickInstaller([assets[0]], WINDOWS)).toBeNull();
  });
});
