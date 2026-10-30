/**
 * Pestañas de notas abiertas (app completa, backend simulado con `?semilla`):
 * abrir varias, cambiar guardando lo pendiente, cerrar la activa y la última.
 * Requiere `vite --port 5199`.
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
const pestanas = () => page.getByRole("tab");
const activa = () => page.locator('[role="tab"][aria-selected="true"]').innerText().catch(() => null);

await page.getByText("bienvenida.md").first().click();
await page.getByText("proyecto-gus.md").first().click();
await page.getByText("lecturas.md").first().click();
await page.waitForTimeout(500);
comprobar((await pestanas().count()) === 3, "abrir tres notas deja tres pestañas");
comprobar((await activa()) === "lecturas", "la última abierta es la activa");

await page.getByRole("tab", { name: "bienvenida" }).click();
await page.waitForTimeout(500);
comprobar((await activa()) === "bienvenida", "pulsar una pestaña cambia de nota");

// Texto sin guardar: al cambiar de pestaña se guarda antes.
const area = page.locator('textarea[data-drop-editor="nota"]');
await area.click();
await page.keyboard.press("Control+End");
await page.keyboard.type("\nlinea pendiente");
await page.getByRole("tab", { name: "lecturas" }).click();
await page.waitForTimeout(800);
const guardado = await page.evaluate(() => window.__smoke.archivos.get("/vault/bienvenida.md"));
comprobar(guardado.includes("linea pendiente"), "cambiar de pestaña guarda lo pendiente");

// Cerrar la activa (lecturas, la última) pasa a la vecina de la izquierda.
await page.getByRole("button", { name: "Cerrar lecturas" }).click();
await page.waitForTimeout(500);
comprobar((await pestanas().count()) === 2 && (await activa()) === "proyecto-gus", "cerrar la activa abre la vecina");

// Cerrar una que no es la activa no cambia la nota.
await page.getByRole("button", { name: "Cerrar bienvenida" }).click();
await page.waitForTimeout(300);
comprobar((await pestanas().count()) === 1 && (await activa()) === "proyecto-gus", "cerrar otra pestaña no cambia la nota");

await page.getByRole("button", { name: "Cerrar proyecto-gus" }).click();
await page.waitForTimeout(500);
comprobar((await pestanas().count()) === 0, "cerrar la última no deja pestañas");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} fallo(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
