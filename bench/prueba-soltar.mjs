/**
 * Soltar archivos del sistema sobre la app (el evento nativo de Tauri se simula
 * con `__smoke.emitir`): a la carpeta que se ve, a una carpeta concreta de la
 * lista y el aviso con el resultado. Red de seguridad para partir el drop de
 * `App`. Requiere `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" })).newPage();
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Notas", exact: true }).first().click();
await page.getByText("bienvenida.md").first().waitFor({ timeout: 10000 });

const archivos = () => page.evaluate(() => [...window.__smoke.archivos.keys()]);
const soltar = (paths, x, y) =>
  page.evaluate(([p, px, py]) => window.__smoke.emitir("tauri://drag-drop", { type: "drop", paths: p, position: { x: px, y: py } }), [paths, x, y]);
const espera = () => page.waitForTimeout(600);

console.log("--- soltar sobre la lista ---");
const lista = await page.locator('[data-entry-id="/vault/bienvenida.md"]').boundingBox();
await soltar(["/tmp/externa.md"], 5, lista.y + lista.height + 200);
await espera();
comprobar((await archivos()).includes("/vault/externa.md"), "un .md soltado fuera de las filas va a la carpeta visible");
comprobar(await page.getByRole("status").first().isVisible().catch(() => false), "se muestra el aviso del resultado");

console.log("\n--- soltar sobre una carpeta ---");
const carpeta = await page.locator('[data-entry-id="/vault/diario"]').boundingBox();
const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
await soltar(["/tmp/otra.md"], (carpeta.x + carpeta.width / 2) * dpr, (carpeta.y + carpeta.height / 2) * dpr);
await espera();
comprobar((await archivos()).includes("/vault/diario/otra.md"), "un .md soltado sobre «diario» entra en esa carpeta");

console.log("\n--- sin archivos ---");
const antes = (await archivos()).length;
await soltar([], 10, 10);
await espera();
comprobar((await archivos()).length === antes, "soltar una lista vacía no hace nada");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
