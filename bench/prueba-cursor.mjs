/**
 * Regresión del cursor con imágenes a tamaño real: una nota vacía, una imagen y
 * muchos saltos de línea. El cursor tiene que dibujarse en cada línea (también
 * las vacías) y seguir dentro de la vista mientras se baja. Requiere
 * `vite --port 5199` (ver `bench:cursor`).
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const BANCO_URL = "http://localhost:5199/bench/cursor.html";
const SALTOS = 30;
// El cursor se considera visible si cae dentro del área del textarea con este margen.
const MARGEN = 8;

// PNG real de 128×128 (el icono de la app): con dimensiones de verdad la imagen
// ocupa su tamaño y crea el sobrante que el overlay tiene que compensar.
const IMG1 = `data:image/png;base64,${readFileSync(
  new URL("../src-tauri/icons/128x128.png", import.meta.url),
).toString("base64")}`;

let fallos = 0;
let total = 0;
function chequeo(nombre, ok, detalle = "") {
  total += 1;
  if (ok) console.log(`  ok    ${nombre}`);
  else {
    fallos += 1;
    console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const navegador = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await navegador.newContext({ viewport: { width: 1000, height: 600 } })).newPage();
page.on("pageerror", (err) => console.log(`  [error de página] ${err.message}`));

await page.addInitScript((img1) => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "gus" }, currentWebview: { label: "gus" } },
    invoke: (cmd, args) => window.__MANEJADOR(cmd, args),
  };
  window.__TAURI_ASSETS__ = { convertFileSrc: (p) => `asset:///${p}` };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__MANEJADOR = (cmd) =>
    Promise.resolve(
      cmd.startsWith("read_vault_image")
        ? img1
        : cmd === "list_vault_images" || cmd === "list_vault_tags"
          ? []
          : null,
    );
}, IMG1);

await page.goto(BANCO_URL);
await page.waitForSelector("textarea", { timeout: 15000 });
await page.waitForTimeout(400);

const area = page.locator("textarea").first();
await area.click();
await page.keyboard.type("Inicio");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.keyboard.type("![Aventura](Aventura.png)");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);

// Posición del cursor dibujado por el overlay y de la vista del textarea.
const medir = () =>
  page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const vista = ta.getBoundingClientRect();
    const caret = document.querySelector(".gus-cell-caret")?.getBoundingClientRect() ?? null;
    return {
      dibujado: caret !== null,
      dentro: caret !== null && caret.top >= vista.top && caret.bottom <= vista.bottom,
    };
  });

const primera = await medir();
chequeo("el cursor se dibuja tras la imagen", primera.dibujado);

let perdidos = 0;
let sinDibujar = 0;
for (let i = 1; i <= SALTOS; i++) {
  await page.keyboard.press("Enter");
  await page.waitForTimeout(120);
  const m = await medir();
  if (!m.dibujado) sinDibujar += 1;
  else if (!m.dentro) perdidos += 1;
}
chequeo(
  `en ${SALTOS} saltos de línea el cursor se dibuja siempre`,
  sinDibujar === 0,
  `${sinDibujar} sin dibujar`,
);
chequeo(
  `en ${SALTOS} saltos de línea el cursor no sale de la vista`,
  perdidos === 0,
  `${perdidos} fuera de la vista`,
);

await navegador.close();
console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
process.exit(fallos === 0 ? 0 : 1);
