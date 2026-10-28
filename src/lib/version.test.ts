import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import tauriConf from "../../src-tauri/tauri.conf.json";
import cargoToml from "../../src-tauri/Cargo.toml?raw";
import cargoLock from "../../src-tauri/Cargo.lock?raw";
import agents from "../../AGENTS.md?raw";

/* La versión se sube a mano en cinco ficheros (AGENTS.md, «Publicar una versión»).
   Este test evita publicar con números distintos. */
describe("versión en todos los ficheros", () => {
  const esperada = pkg.version;

  it("tauri.conf.json (la que ven los bundles)", () => {
    expect(tauriConf.version).toBe(esperada);
  });

  it("Cargo.toml (paquete gus)", () => {
    expect(cargoToml.match(/^version = "([^"]+)"/m)?.[1]).toBe(esperada);
  });

  it("Cargo.lock (paquete gus)", () => {
    expect(cargoLock.match(/name = "gus"\nversion = "([^"]+)"/)?.[1]).toBe(esperada);
  });

  it("AGENTS.md (línea Versión)", () => {
    expect(agents.match(/\*\*Versión:\*\* (\S+)/)?.[1]).toBe(esperada);
  });
});
