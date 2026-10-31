#!/usr/bin/env node
/**
 * Construye `latest.json`, el manifiesto que lee el actualizador de Tauri, a
 * partir de los instaladores firmados de una release (cada `X` con su `X.sig`).
 *
 *   node scripts/update-manifest.mjs <carpeta> <tag> <owner/repo> <notas.md>
 *
 * Escribe `<carpeta>/latest.json`. Falla si falta una plataforma: un manifiesto
 * a medias desactivaría en silencio las actualizaciones de ese sistema.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Instalador que usa el actualizador en cada plataforma, reconocido por el nombre del archivo. */
export const PLATFORMS = {
  "linux-x86_64": /_amd64\.AppImage$/i,
  "windows-x86_64": /_x64-setup\.exe$/i,
  "darwin-aarch64": /_aarch64\.app\.tar\.gz$/i,
  "darwin-x86_64": /_x64\.app\.tar\.gz$/i,
};

/** Plataformas que toda release debe traer (la de Mac Intel es opcional). */
export const REQUIRED = ["linux-x86_64", "windows-x86_64", "darwin-aarch64"];

/**
 * @param {{ version: string, notes: string, pubDate: string, baseUrl: string, signatures: Record<string, string> }} input
 *   `signatures`: nombre del instalador → contenido de su `.sig`.
 */
export function buildManifest({ version, notes, pubDate, baseUrl, signatures }) {
  const platforms = {};
  for (const [platform, pattern] of Object.entries(PLATFORMS)) {
    const name = Object.keys(signatures).find((candidate) => pattern.test(candidate));
    if (name) {
      platforms[platform] = {
        signature: signatures[name].trim(),
        url: `${baseUrl}/${encodeURIComponent(name)}`,
      };
    }
  }

  const missing = REQUIRED.filter((platform) => !(platform in platforms));
  if (missing.length > 0) {
    throw new Error(`Faltan instaladores firmados para: ${missing.join(", ")}`);
  }

  return { version: version.replace(/^v/i, ""), notes, pub_date: pubDate, platforms };
}

/** Instaladores de la carpeta que tienen su `.sig` al lado. */
function readSignatures(dir) {
  const signatures = {};
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".sig") || !existsSync(join(dir, `${name}.sig`))) continue;
    signatures[name] = readFileSync(join(dir, `${name}.sig`), "utf8");
  }
  return signatures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, tag, repo, notesFile] = process.argv.slice(2);
  if (!dir || !tag || !repo) {
    console.error("Uso: update-manifest.mjs <carpeta> <tag> <owner/repo> [notas.md]");
    process.exit(2);
  }

  const manifest = buildManifest({
    version: tag,
    notes: notesFile && existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "",
    pubDate: new Date().toISOString(),
    baseUrl: `https://github.com/${repo}/releases/download/${tag}`,
    signatures: readSignatures(dir),
  });
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`latest.json: ${Object.keys(manifest.platforms).join(", ")}`);
}
