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

console.log("\n--- versiones anteriores ---");
await area.click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nCambio nuevo");
await page.waitForTimeout(2500);
const enDisco = () => page.evaluate(() => window.__smoke.archivos.get("/vault/larga.md"));
comprobar((await enDisco()).includes("Cambio nuevo"), "el autoguardado escribe el cambio");
await page.getByRole("button", { name: /Más opciones/ }).first().click();
await page.getByRole("menuitem", { name: "Versiones anteriores" }).click();
const dialogo = page.getByRole("dialog", { name: "Versiones anteriores" });
await dialogo.waitFor({ timeout: 3000 });
await page.waitForTimeout(300);
comprobar((await dialogo.getByRole("list").getByRole("button").count()) === 1, "hay una versión: la de antes del primer guardado");
const vista = await dialogo.locator("pre").innerText();
comprobar(vista.includes("Párrafo 120") && !vista.includes("Cambio nuevo"), "la vista previa enseña el texto anterior al cambio");
await dialogo.getByRole("button", { name: "Restaurar" }).click();
await page.waitForTimeout(2500);
comprobar((await dialogo.count()) === 0, "«Restaurar» cierra el diálogo");
comprobar(!(await area.inputValue()).includes("Cambio nuevo") && !(await enDisco()).includes("Cambio nuevo"), "restaurar devuelve el texto anterior al editor y al disco");
const guardadas = await page.evaluate(() => window.__smoke.versiones.get("/vault/larga.md").map((v) => v.texto));
comprobar(guardadas.length === 2 && guardadas[0].includes("Cambio nuevo"), "lo que había antes de restaurar queda como versión nueva");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
