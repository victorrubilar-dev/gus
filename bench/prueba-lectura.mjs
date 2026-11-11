/**
 * Modo lectura y vista dividida (interfaz REQ-05) sobre la app completa con
 * backend simulado: los tres modos, el scroll que acompaña entre paneles y la
 * lectura a pantalla completa. Requiere `vite --port 5199`.
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
const largo = "# Larga\n\n" + Array.from({ length: 120 }, (_, i) => `Párrafo ${i + 1} con algo de texto.\n`).join("\n");
await page.evaluate((texto) => window.__smoke.archivos.set("/vault/larga.md", texto), largo);
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Notas", exact: true }).first().click();
await page.getByText("larga.md").first().click();
const area = page.locator('[data-tour="editor"] textarea');
await area.waitFor({ timeout: 10000 });
const panelLectura = page.getByLabel("Vista previa de la nota");

await page.getByRole("tab", { name: "Dividido" }).click();
await page.waitForTimeout(300);
comprobar((await area.isVisible()) && (await panelLectura.isVisible()), "«Dividido» enseña el editor y la lectura a la vez");
const [anchoA, anchoB] = await Promise.all([area.boundingBox(), panelLectura.boundingBox()]);
comprobar(anchoA.x < anchoB.x && Math.abs(anchoA.width - anchoB.width) < 80, "los dos paneles van lado a lado y a medias");

await area.evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(200);
const lecturaAbajo = await panelLectura.evaluate((el) => el.scrollTop / (el.scrollHeight - el.clientHeight));
comprobar(lecturaAbajo > 0.95, "bajar el editor hasta el final baja también la lectura");
await panelLectura.evaluate((el) => { el.scrollTop = 0; });
await page.waitForTimeout(200);
comprobar((await area.evaluate((el) => el.scrollTop)) < 5, "subir la lectura sube también el editor");

await area.click();
await page.keyboard.press("End");
await page.keyboard.type(" Añadido");
await page.waitForTimeout(200);
comprobar((await panelLectura.innerText()).includes("Añadido"), "lo que se escribe aparece en la lectura al momento");

await page.getByRole("tab", { name: "Lectura" }).click();
await page.waitForTimeout(200);
comprobar(!(await area.isVisible()) && (await panelLectura.isVisible()), "«Lectura» deja solo la nota renderizada");

await page.getByRole("button", { name: "Leer a pantalla completa" }).click();
await page.waitForTimeout(200);
const caja = await page.locator('[data-tour="editor"]').boundingBox();
comprobar(caja.x === 0 && caja.width === 1280, "pantalla completa: la nota ocupa toda la ventana");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
comprobar((await page.locator('[data-tour="editor"]').boundingBox()).x > 0, "Esc sale de pantalla completa");

await page.getByRole("tab", { name: "Editar" }).click();
await page.waitForTimeout(200);
comprobar((await area.isVisible()) && !(await panelLectura.isVisible()), "«Editar» vuelve al editor solo");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
