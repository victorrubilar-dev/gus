/**
 * Corrector ortográfico (app completa, backend simulado con `?semilla`): el
 * cuadro de sugerencias sale bajo una palabra errónea, ↑↓ + Intro la corrige,
 * Esc lo cierra sin reabrirlo y Alt+Intro corrige sin cuadro. Requiere
 * `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" })).newPage();
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.getByText("bienvenida.md").first().click();
const area = page.locator("textarea").first();
const popup = page.getByRole("listbox", { name: "Correcciones sugeridas" });
const texto = () => area.inputValue();

await area.click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\n\nholaa");
await popup.waitFor({ timeout: 15000 }).then(
  () => comprobar(true, "una palabra errónea abre el cuadro de sugerencias"),
  () => comprobar(false, "una palabra errónea abre el cuadro de sugerencias"),
);

await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const tras = await texto();
comprobar(/\nhola$/.test(tras), `↓ + Intro aplica la sugerencia (queda «${tras.slice(-8).replace(/\n/g, "\\n")}»)`);

await page.keyboard.type(" holaa");
await popup.waitFor({ timeout: 15000 });
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
comprobar(!(await popup.isVisible()), "Esc cierra el cuadro y no se reabre sobre la misma palabra");

await page.keyboard.press("Alt+Enter");
await page.waitForTimeout(300);
const fin = await texto();
comprobar(/ hola$/.test(fin), `Alt+Intro corrige sin abrir el cuadro (queda «${fin.slice(-10).replace(/\n/g, "\\n")}»)`);

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallida(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
