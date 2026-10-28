/**
 * Prueba del teclado en las tablas del editor (Chromium headless): Tab entre
 * celdas, ↓ en el borde del bloque para salir de la tabla, e Intro en la
 * última fila para añadir otra. Es la red de seguridad antes de sacar el
 * manejo de tablas de `MarkdownEditor.tsx` a un hook.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/index.html";
const NOTA =
  "| Nombre | Apellido | Puntos |\n| --- | --- | --- |\n| Ana | Ruiz | 10 |\n| Luis | Paz | 20 |\n| Eva | Sol | 30 |\n\nTexto de después.";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const fallos = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea", { timeout: 10000 });

const celda = (linea, col) =>
  page.locator(`[data-cell][data-line="${linea}"][data-col="${col}"]`).first();

/* El overlay de la tabla recibe el puntero por coordenadas, como en el ratón real. */
async function clicCelda(linea, col) {
  const caja = await celda(linea, col).boundingBox();
  await page.mouse.click(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.waitForTimeout(100);
}

async function reiniciar() {
  await page.evaluate((nota) => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, nota);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, NOTA);
  await page.waitForTimeout(200);
}

const nota = () => page.locator("textarea").inputValue();
const cursor = () =>
  page.evaluate(() => {
    const ta = document.querySelector("textarea");
    return { start: ta.selectionStart, end: ta.selectionEnd, value: ta.value };
  });
const lineasTabla = (texto) => texto.split("\n").filter((l) => l.trim().startsWith("|")).length;

// --- 1) Tab pasa a la celda siguiente ---
await reiniciar();
await clicCelda(2, 0);
await page.keyboard.press("Tab");
{
  const { start, end, value } = await cursor();
  const ruiz = value.indexOf("Ruiz");
  const seleccion = value.slice(start, end).trim();
  ok(
    seleccion === "Ruiz" || (start >= ruiz - 1 && start <= ruiz + 4),
    `Tab lleva el cursor a la celda «Ruiz» (selección «${seleccion}»)`,
  );
}

// --- 2) ↓ desde la última fila sale de la tabla ---
await reiniciar();
await clicCelda(4, 2);
await page.keyboard.press("ArrowDown");
{
  const { start, value } = await cursor();
  const lineaCursor = value.slice(0, start).split("\n").length - 1;
  const ultimaFila = value.split("\n").findIndex((l) => l.includes("Eva"));
  ok(
    lineaCursor > ultimaFila,
    `↓ en el borde de la tabla saca el cursor debajo del bloque (línea ${lineaCursor}, la última fila es ${ultimaFila})`,
  );
}

// --- 3) Intro en la última fila añade una fila ---
await reiniciar();
const antes = lineasTabla(await nota());
await clicCelda(4, 0);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
{
  const despues = lineasTabla(await nota());
  ok(despues === antes + 1, `Intro en la última fila añade una fila (líneas de tabla ${antes} → ${despues})`);
}

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} fallo(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
