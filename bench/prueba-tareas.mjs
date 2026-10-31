/**
 * Tareas sobre la app completa (backend simulado con `?semilla`): marcar,
 * prioridad, etiquetas, filtro, subtareas, tablero y borrar, comprobando lo que
 * llega a `save_tasks`. Red de seguridad para partir `TaskList`. Requiere
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
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Tareas", exact: true }).first().click();
const espera = () => page.waitForTimeout(450);
await espera();

const tareas = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__smoke.tareas)));
const tarea = async (id) => (await tareas()).find((t) => t.id === id);
const vista = (nombre) => page.getByRole("tab", { name: new RegExp(`^${nombre}`) }).first();

console.log("--- lista ---");
await vista("Lista").click();
await espera();
const T2 = "Escribir las notas de la versión 0.1.6";
const fila = (titulo) => page.locator("li", { has: page.getByRole("button", { name: `Eliminar «${titulo}»` }) }).first();
comprobar(await fila(T2).isVisible(), "la lista muestra las tareas del almacén");

console.log("\n--- marcar como hecha ---");
await fila(T2).locator('input[type="checkbox"]').first().check({ force: true });
await espera();
comprobar((await tarea("t2")).completes === true, "marcar la casilla guarda completes=true");
await fila(T2).locator('input[type="checkbox"]').first().uncheck({ force: true });
await espera();
comprobar((await tarea("t2")).completes === false, "desmarcarla vuelve a false");

console.log("\n--- prioridad ---");
const antes = (await tarea("t4")).priority;
await page.getByRole("button", { name: /^Prioridad de «Ordenar la carpeta de lecturas»/ }).click();
await espera();
const despues = (await tarea("t4")).priority;
comprobar(antes === "baja" && despues === "media", `pulsar la prioridad la sube (${antes} → ${despues})`);

console.log("\n--- etiquetas ---");
await page.getByRole("button", { name: "Etiquetas de «Ordenar la carpeta de lecturas»" }).click();
const campo = page.locator("input:focus");
await campo.fill("orden");
await campo.press("Enter");
await campo.evaluate((el) => el.blur());
await espera();
comprobar((await tarea("t4")).tags.includes("orden"), "añadir una etiqueta la guarda en la tarea");

console.log("\n--- filtro por etiqueta ---");
await page.locator(`button[title^="Filtrar por #libros ·"]`).click();
await espera();
comprobar(!(await fila(T2).isVisible().catch(() => false)), "filtrar por #libros oculta las tareas sin esa etiqueta");
comprobar(await fila("Ordenar la carpeta de lecturas").isVisible(), "y deja la que la tiene");
await page.locator(`button[title^="Filtrar por #libros ·"]`).click();
await espera();
comprobar(await fila(T2).isVisible(), "pulsarla otra vez quita el filtro");

console.log("\n--- subtarea ---");
await page.getByRole("button", { name: "Subtareas y dependencias de «Ordenar la carpeta de lecturas»" }).click();
await page.getByLabel("Nueva subtarea de «Ordenar la carpeta de lecturas»").fill("Paso uno");
await page.getByRole("button", { name: "Añadir", exact: true }).click();
await espera();
const sub = (await tareas()).find((t) => t.title === "Paso uno");
comprobar(sub?.parentId === "t4", "la subtarea se guarda con su parentId");

console.log("\n--- tablero ---");
await vista("Tablero").click();
await espera();
comprobar(await page.getByText("En progreso", { exact: true }).first().isVisible(), "el tablero muestra la columna «En progreso»");
const tarjeta = page.locator("div[draggable='true']", { hasText: "Revisar el contraste" }).first();
const columnaEnProgreso = page.locator("h3", { hasText: "En progreso" }).locator("xpath=../..").locator("ul").first();
await tarjeta.dragTo(columnaEnProgreso);
await espera();
comprobar((await tarea("t1")).doing === true, "arrastrar una tarjeta a «En progreso» la marca doing");
await vista("Lista").click();
await espera();

console.log("\n--- borrar ---");
await fila("Publicar el borrador de la release").getByRole("button", { name: /^Eliminar «/ }).click();
await espera();
comprobar(!(await tareas()).some((t) => t.id === "t6"), "eliminar quita la tarea del almacén");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
