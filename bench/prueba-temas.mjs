/**
 * Temas personalizados (interfaz REQ-03) sobre la app completa con backend
 * simulado: crear con vista previa en vivo, cancelar, guardar, exportar a JSON,
 * importar y borrar. Requiere `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "es-ES" })).newPage();
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Configuración", exact: true }).first().click();
await page.getByText("Los cambios se guardan automáticamente").waitFor({ timeout: 8000 });
await page.locator("main button", { hasText: /^Apariencia\d/ }).first().click();
await page.waitForTimeout(250);

const fondo = () => page.evaluate(() => document.documentElement.style.getPropertyValue("--color-gus-bg"));
const ultimaConfig = () => page.evaluate(() => window.__smoke.configGuardada.at(-1));
const original = await fondo();

await page.getByRole("button", { name: "Nuevo tema" }).click();
const editor = page.getByRole("form", { name: "Editor de tema" });
await editor.getByLabel("Fondo").fill("#203040");
await page.waitForTimeout(150);
comprobar((await fondo()) === "#203040", "cambiar el fondo pinta la app al momento");
await editor.getByRole("button", { name: "Cancelar" }).click();
await page.waitForTimeout(150);
comprobar((await fondo()) === original, "cancelar vuelve al tema de antes");

await page.getByRole("button", { name: "Nuevo tema" }).click();
await editor.getByLabel("Nombre del tema").fill("Noche azul");
await editor.getByLabel("Fondo").fill("#203040");
await editor.getByLabel("Texto secundario").fill("#2a2a2a");
comprobar(await editor.getByText(/Poco contraste/).isVisible(), "un texto secundario ilegible avisa del contraste");
await editor.getByLabel("Texto secundario").fill("#c0c8d0");
await editor.getByRole("button", { name: "Guardar" }).click();
await page.waitForTimeout(300);
const config = await ultimaConfig();
const guardado = config.settings.customThemes?.[0];
comprobar(guardado?.name === "Noche azul" && guardado.colors.bg === "#203040", "guardar mete el tema en los ajustes");
comprobar(config.settings.theme === `custom-${guardado?.id}`, "y lo deja puesto");
comprobar((await fondo()) === "#203040", "la app sigue con el tema guardado");

await page.getByRole("button", { name: "Exportar el tema Noche azul a JSON" }).click();
await page.waitForTimeout(300);
const exportado = await page.evaluate(() => window.__smoke.exportados.at(-1));
comprobar(exportado?.format === "json" && JSON.parse(exportado.data).name === "Noche azul", "exportar escribe el tema en JSON");

const json = JSON.stringify({ ...JSON.parse(exportado.data), name: "Copia", colors: { ...JSON.parse(exportado.data).colors, bg: "#402030" } });
await page.locator('input[type="file"]').setInputFiles({ name: "copia.json", mimeType: "application/json", buffer: Buffer.from(json) });
await page.waitForTimeout(300);
comprobar((await ultimaConfig()).settings.customThemes.length === 2 && (await fondo()) === "#402030", "importar un JSON añade el tema y lo pone");
await page.locator('input[type="file"]').setInputFiles({ name: "malo.json", mimeType: "application/json", buffer: Buffer.from('{"name": 1}') });
await page.waitForTimeout(200);
comprobar(await page.getByText(/no es un tema de Gus/).isVisible(), "un JSON que no es un tema se explica");

await page.getByRole("button", { name: "Eliminar el tema Copia" }).click();
await page.waitForTimeout(300);
const tras = await ultimaConfig();
comprobar(tras.settings.customThemes.length === 1 && tras.settings.theme === "gus-oscuro", "borrar el tema activo vuelve al de serie de su estilo");

await page.getByRole("button", { name: /Restablecer/ }).first().click();
await page.waitForTimeout(300);
comprobar((await ultimaConfig()).settings.customThemes.length === 1, "restablecer los ajustes no borra tus temas");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
