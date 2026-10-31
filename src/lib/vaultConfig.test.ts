import { describe, expect, it } from "vitest";
import { DEFAULT_BASE_DIR, normalizeConfig } from "./vaultConfig";

describe("normalizeConfig", () => {
  it("sin configuración usa la carpeta base por defecto y ningún vault", () => {
    const config = normalizeConfig(null);
    expect(config.baseDir).toBe(DEFAULT_BASE_DIR);
    expect(config.vaults).toEqual([]);
    expect(config.lastVault).toBeNull();
  });

  it("conserva los vaults y el último abierto, y recorta la carpeta base", () => {
    const config = normalizeConfig({
      baseDir: "  /datos/vaults  ",
      vaults: [{ name: "Diario", path: "/datos/vaults/diario" }],
      lastVault: "/datos/vaults/diario",
    } as never);
    expect(config.baseDir).toBe("/datos/vaults");
    expect(config.vaults).toHaveLength(1);
    expect(config.lastVault).toBe("/datos/vaults/diario");
  });

  it("una carpeta base en blanco cae en la de por defecto", () => {
    expect(normalizeConfig({ baseDir: "   " } as never).baseDir).toBe(DEFAULT_BASE_DIR);
  });
});
