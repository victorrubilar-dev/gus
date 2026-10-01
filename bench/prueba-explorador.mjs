/**
 * Prueba del confirm de borrado del explorador con un teclado de verdad
 * (Chromium headless): Supr abre la pregunta de la papelera y las flechas e
 * Intro la recorren — elegir «Cancelar» sin borrar, elegir «Mover a la
 * papelera» y pasar a la papelera, y que el pulso de siempre (Supr, Supr)
 * sigue funcionando. Es lo que solo se comprueba pulsando sobre el diálogo.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/explorador.html";

const browser = await chromium.launch({
  executablePath: "/home/korossuh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const fallos = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

page.on("console", (m) => {
  if (m.type() === "error") console.log("  [error del navegador]", m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector('[data-entry-id="/vault/ana.md"]', { timeout: 10000 });

const fila = (id) => page.locator(`[data-entry-id="${id}"]`);
const borrados = () => page.evaluate(() => window.__borrados.length);
const menuAbierto = () => page.locator('[role="menu"]').count();
const confirmVisible = () =>
  page.locator('[role="menu"] button', { hasText: "Mover a la papelera" }).count();
const marcada = () =>
  page.evaluate(() =>
    (document.activeElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

console.log("--- Supr abre el confirm ---");
await fila("/vault/ana.md").locator("button").first().click();
await page.keyboard.press("Delete");
await page.waitForSelector('[role="menu"]', { timeout: 4000 });
ok(
  /Mover a la papelera/.test(await marcada()),
  `Supr abre el confirm con «Mover a la papelera» marcado (foco: ${await marcada()})`,
);

console.log("\n--- las flechas eligen ---");
await page.keyboard.press("ArrowDown");
ok(/Cancelar/.test(await marcada()), "↓ marca «Cancelar»");
await page.keyboard.press("ArrowUp");
ok(/Mover a la papelera/.test(await marcada()), "↑ vuelve a «Mover a la papelera»");
await page.keyboard.press("ArrowDown");
ok(/Cancelar/.test(await marcada()), "↓ alterna de nuevo a «Cancelar»");

console.log("\n--- Intro con «Cancelar» no borra ---");
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
ok((await confirmVisible()) === 0, "Intro con «Cancelar» vuelve a las opciones del menú");
ok((await borrados()) === 0, "…sin enviar nada a la papelera");
ok((await fila("/vault/ana.md").count()) === 1, "la nota sigue en la lista");

console.log("\n--- Supr con «Cancelar» marcado cancela ---");
await page.keyboard.press("Delete");
await page.waitForSelector('[role="menu"]', { timeout: 4000 });
ok(
  /Mover a la papelera/.test(await marcada()),
  "reabrir devuelve el foco a «Mover a la papelera»",
);
await page.keyboard.press("ArrowUp");
ok(/Cancelar/.test(await marcada()), "↑ marca «Cancelar»");
await page.keyboard.press("Delete");
await page.waitForTimeout(200);
ok((await confirmVisible()) === 0, "Supr con «Cancelar» marcado cancela en vez de borrar");
ok((await borrados()) === 0, "…y la nota no se mueve (0 borrados)");

console.log("\n--- Esc cierra el menú ---");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok((await menuAbierto()) === 0, "Esc cierra el menú entero");

console.log("\n--- Intro con «Mover a la papelera» borra ---");
await page.keyboard.press("Delete");
await page.waitForSelector('[role="menu"]', { timeout: 4000 });
ok(
  /Mover a la papelera/.test(await marcada()),
  "Supr con el menú cerrado reabre con «Mover a la papelera» marcado",
);
await page.keyboard.press("Enter");
// La nota se va al instante; la fila tarda en caerse (animación de salida).
await page.waitForTimeout(1000);
ok((await borrados()) === 1, "Intro con «Mover a la papelera» lo envía a la papelera");
ok((await fila("/vault/ana.md").count()) === 0, "la nota desaparece de la lista");

console.log("\n--- regresión: Supr, Supr sigue borrando ---");
await fila("/vault/luis.md").locator("button").first().click();
await page.keyboard.press("Delete");
await page.waitForSelector('[role="menu"]', { timeout: 4000 });
await page.keyboard.press("Delete");
await page.waitForTimeout(1000);
ok((await borrados()) === 2, "la segunda Supr sigue confirmando el borrado");
ok((await fila("/vault/luis.md").count()) === 0, "y luis se va de la lista");

await browser.close();

console.log(`\n${fallos.length === 0 ? "TODO EN VERDE" : `FALLOS: ${fallos.length}`}`);
process.exit(fallos.length === 0 ? 0 : 1);
