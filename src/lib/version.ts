import pkg from "../../package.json";

/**
 * Versión de la app en tiempo de ejecución: sale de `package.json`, que es la
 * misma fuente que usan `tauri.conf.json` y `Cargo.toml` al empaquetar.
 */
export const APP_VERSION: string = pkg.version;

/** Repositorio GitHub («owner/name») leído del campo `repository.url`. */
export const GITHUB_REPO: string =
  pkg.repository.url.replace(/\.git\/?$/, "").match(/github\.com\/([^/]+\/[^/]+)$/)?.[1] ??
  "victorrubilar-dev/gus";

/** Página de las versiones publicadas, para quien quiera mirarlas a mano. */
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
