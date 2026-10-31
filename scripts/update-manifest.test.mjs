import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildManifest } from "./update-manifest.mjs";

const signatures = {
  "gus_0.3.0_amd64.AppImage": "SIG-LINUX\n",
  "gus_0.3.0_x64-setup.exe": "SIG-WIN",
  "gus_0.3.0_aarch64.app.tar.gz": "SIG-MAC",
};
const base = { version: "v0.3.0", notes: "notas", pubDate: "2026-10-31T00:00:00.000Z", baseUrl: "https://x/dl/v0.3.0", signatures };

describe("manifiesto del actualizador", () => {
  it("asigna cada instalador a su plataforma, con su firma y su URL", () => {
    const manifest = buildManifest(base);
    expect(manifest.version).toBe("0.3.0");
    expect(manifest.platforms["linux-x86_64"]).toEqual({ signature: "SIG-LINUX", url: "https://x/dl/v0.3.0/gus_0.3.0_amd64.AppImage" });
    expect(Object.keys(manifest.platforms).sort()).toEqual(["darwin-aarch64", "linux-x86_64", "windows-x86_64"]);
  });

  it("el MSI y el .deb no se confunden con el instalador del actualizador", () => {
    const manifest = buildManifest({ ...base, signatures: { ...signatures, "gus_0.3.0_x64_en-US.msi": "SIG-MSI", "gus_0.3.0_amd64.deb": "X" } });
    expect(manifest.platforms["windows-x86_64"].signature).toBe("SIG-WIN");
  });

  it("falla si falta una plataforma obligatoria, para no desactivarla en silencio", () => {
    const { "gus_0.3.0_x64-setup.exe": _quitado, ...sinWindows } = signatures;
    expect(() => buildManifest({ ...base, signatures: sinWindows })).toThrow(/windows-x86_64/);
  });

  it("codifica en la URL los nombres con espacios", () => {
    const { "gus_0.3.0_amd64.AppImage": _quitado, ...resto } = signatures;
    const manifest = buildManifest({ ...base, signatures: { ...resto, "gus 0.3.0_amd64.AppImage": "S" } });
    expect(manifest.platforms["linux-x86_64"].url).toBe("https://x/dl/v0.3.0/gus%200.3.0_amd64.AppImage");
  });

  it("el script lee las firmas de la carpeta y escribe latest.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "gus-manifest-"));
    try {
      for (const [name, sig] of Object.entries(signatures)) {
        writeFileSync(join(dir, name), "binario");
        writeFileSync(join(dir, `${name}.sig`), sig);
      }
      writeFileSync(join(dir, "gus_0.3.0_amd64.deb"), "sin firma, se ignora");
      const salida = execFileSync("node", ["scripts/update-manifest.mjs", dir, "v0.3.0", "dueno/repo", join(dir, "no-hay-notas.md")], { encoding: "utf8" });
      expect(salida).toContain("linux-x86_64");
      const manifest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
      expect(manifest.platforms["darwin-aarch64"].url).toBe("https://github.com/dueno/repo/releases/download/v0.3.0/gus_0.3.0_aarch64.app.tar.gz");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
