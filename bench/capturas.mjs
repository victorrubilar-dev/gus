/**
 * Captura las vistas principales con el vault sembrado (`?semilla`, ver
 * `app-smoke.tsx`). Uso: `node bench/capturas.mjs <carpeta> [tema] [puerto]`.
 * Requiere `vite --port 5199`. Sirve para comparar antes y después de un cambio visual.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [, , carpeta = "capturas", tema = "gus-oscuro", puerto = "5199"] = process.argv;
mkdirSync(carpeta, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" });
const page = await contexto.newPage();
// Fecha fija: la semilla y el calendario dependen de «hoy» y la línea base no debe caducar cada día.
await page.clock.setFixedTime(new Date(2026, 9, 30, 12, 0, 0));
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto(`http://localhost:${puerto}/bench/app-smoke.html?semilla&tema=${tema}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Notas", exact: true }).first().waitFor({ timeout: 15000 });

const barra = (n) => page.locator('[data-tour="sidebar"]').getByRole("button", { name: n, exact: true }).first();
const foto = async (nombre) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${carpeta}/${nombre}.png` });
};

await barra("Notas").click();
await foto("1-notas-lista");
await page.getByText("bienvenida.md").first().click();
await foto("2-notas-editor");
await barra("Resumen").click();
await foto("3-resumen");
await barra("Tareas").click();
await foto("4-tareas-tablero");
await page.getByText("Lista", { exact: true }).first().click();
await foto("5-tareas-lista");
await page.getByRole("button", { name: "Nueva tarea" }).first().click();
await page.getByPlaceholder("¿Qué hay que hacer?").waitFor({ timeout: 5000 });
await foto("6-tareas-dialogo");
await page.keyboard.press("Escape");
await barra("Calendario").click();
await foto("7-calendario");
await barra("Grafo").click();
await foto("8-grafo");
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Configuración" }).first().click();
await foto("9-configuracion");

await browser.close();
console.log(`Capturas en ${carpeta}`);
