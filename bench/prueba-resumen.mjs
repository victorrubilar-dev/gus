/**
 * Resumen («Hoy») sobre la app completa con `?semilla`: tareas vencidas y de
 * hoy que se marcan desde aquí, hábitos del día (incluida la meta semanal), la
 * nota del día y «sigue donde lo dejaste». Requiere `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "es-ES" })).newPage();
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
const barra = page.locator('[data-tour="sidebar"]');
await barra.getByRole("button", { name: "Resumen", exact: true }).first().click();
await page.getByText("Para hoy", { exact: true }).waitFor({ timeout: 10000 });
const espera = () => page.waitForTimeout(500);
const tareas = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__smoke.tareas)));

console.log("--- cabecera ---");
comprobar(await page.getByRole("heading", { name: /Buenos días|Buenas tardes|Buenas noches/ }).isVisible(), "saluda según la hora");

console.log("\n--- tareas de hoy ---");
comprobar(await page.getByText(/^Vencidas · 1$/i).isVisible(), "agrupa las vencidas (1)");
comprobar(await page.getByText(/^Hoy · 1$/i).isVisible(), "agrupa las de hoy (1)");
await page.getByRole("checkbox", { name: /Escribir las notas de la versión 0.1.6/ }).click();
await espera();
comprobar((await tareas()).find((t) => t.id === "t2")?.completes === true, "marcar una tarea desde el resumen la guarda (save_tasks)");

console.log("\n--- hábitos de hoy ---");
comprobar(await page.getByText("0/3").isVisible(), "el hábito semanal enseña su avance (0/3)");
await page.getByRole("checkbox", { name: /Salir a correr/ }).check({ force: true });
await page.waitForFunction(
  () => window.__smoke.llamadas.some((c) => c.cmd === "save_habits" && (c.args.store?.log?.h2 ?? []).length === 1),
  null,
  { timeout: 8000 },
);
comprobar(true, "marcar un hábito desde el resumen lo guarda (save_habits)");
comprobar(await page.getByText("1/3").isVisible(), "y suma uno a la semana (1/3)");

console.log("\n--- nota del día ---");
comprobar(await page.getByRole("heading", { name: "Nota del día" }).isVisible(), "hay una tarjeta de la nota del día");

console.log("\n--- sigue donde lo dejaste ---");
await page.getByRole("button", { name: /^proyecto-gus/ }).click();
await page.locator('textarea[data-drop-editor="nota"]').waitFor({ timeout: 10000 });
comprobar(true, "pulsar una nota reciente la abre en el editor");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
