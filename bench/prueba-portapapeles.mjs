/**
 * Portapapeles del editor (app completa, backend simulado con `?semilla`):
 * Ctrl+X sin selección corta la línea entera, Ctrl+V la vuelve a pegar y
 * Ctrl+C sobre un texto marcado lo copia sin tocar la nota. Requiere
 * `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" });
await contexto.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await contexto.newPage();
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.getByText("bienvenida.md").first().click();
const area = page.locator("textarea").first();
const texto = () => area.inputValue();
await area.click();

// El plugin del portapapeles es simulado: se recoge lo que se le escribe y se le devuelve al leer.
await page.evaluate(() => {
  const interno = window.__TAURI_INTERNALS__;
  const original = interno.invoke;
  window.__escrito = [];
  interno.invoke = async (cmd, args) => {
    if (cmd.endsWith("write_text")) {
      window.__escrito.push(args?.text ?? null);
      return null;
    }
    if (cmd.endsWith("read_text")) return window.__escrito.at(-1) ?? "";
    return original(cmd, args);
  };
});

await page.keyboard.press("Control+Home");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown"); // línea «Este vault guarda…»
await page.keyboard.press("Home");
const antes = await texto();
const lineas = antes.split("\n");
const objetivo = lineas.find((l) => l.startsWith("Este vault"));
await page.keyboard.press("Control+x");
await page.waitForTimeout(300);
const tras = await texto();
const escrito = await page.evaluate(() => window.__escrito);
comprobar(!tras.includes("Este vault"), "Ctrl+X sin selección quita la línea entera");
comprobar(escrito.some((t) => t?.includes(objetivo)), "la línea cortada se manda al portapapeles");

// El pegado nativo lee el portapapeles del navegador, que el plugin simulado no toca.
await page.evaluate((t) => navigator.clipboard.writeText(t), objetivo + "\n");
await page.keyboard.press("Control+End");
await page.keyboard.press("Control+v");
await page.waitForTimeout(400);
const pegado = await texto();
comprobar(pegado.includes(objetivo), "Ctrl+V vuelve a pegar la línea cortada");

const longitud = (await texto()).length;
await page.keyboard.press("Control+Home");
await page.keyboard.press("Shift+End");
await page.keyboard.press("Control+c");
await page.waitForTimeout(200);
comprobar((await texto()).length === longitud, "Ctrl+C sobre lo marcado no modifica la nota");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallida(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
