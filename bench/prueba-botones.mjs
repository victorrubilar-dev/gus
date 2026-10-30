/**
 * Mide la altura de los botones visibles en cada pantalla de la app (con backend
 * simulado, ver `app-smoke.tsx`) y falla si alguno mide menos de 28 px. Excluye
 * la barra lateral (su altura viene de la etiqueta, es una excepción), los
 * botones de estado (`aria-pressed`: filtros) y los interruptores
 * (`role="switch"`: controles de formulario, no de acción). Requiere
 * `vite --port 5199` (ver `bench:botones`).
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/app-smoke.html";
const ALTURA_MINIMA = 28;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" });
const page = await contexto.newPage();
const fallos = [];

page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

// Botones visibles fuera de la barra lateral y de los de estado; devuelve los
// que miden menos de la altura mínima.
const medirBajos = () =>
  page.evaluate((minimo) => {
    const visible = (el) => el.getClientRects().length > 0;
    return [...document.querySelectorAll("button")]
      .filter((el) => visible(el))
      .filter((el) => !el.closest('[data-tour="sidebar"]'))
      .filter((el) => !el.hasAttribute("aria-pressed") && el.getAttribute("role") !== "switch")
      .map((el) => ({
        nombre: (el.getAttribute("aria-label") || el.textContent || el.title || "").trim().slice(0, 50),
        altura: Math.round(el.getBoundingClientRect().height * 10) / 10,
        clases: el.className.toString().slice(0, 80),
      }))
      .filter((b) => b.altura < minimo);
  }, ALTURA_MINIMA);

const pantalla = async (nombre, preparar) => {
  await preparar();
  await page.waitForTimeout(400);
  const bajos = await medirBajos();
  if (bajos.length === 0) {
    console.log(`PASA  ${nombre}: todos los botones miden ${ALTURA_MINIMA} px o más`);
    return;
  }
  console.log(`FALLA ${nombre}:`);
  for (const b of bajos) {
    console.log(`        ${b.altura} px  «${b.nombre}»  [${b.clases}]`);
    fallos.push(`${nombre}: «${b.nombre}» mide ${b.altura} px`);
  }
};

await page.goto(URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Notas", exact: true }).first().waitFor({ timeout: 15000 });

const barra = (nombre) =>
  page.locator('[data-tour="sidebar"]').getByRole("button", { name: nombre, exact: true }).first();

await pantalla("Notas", () => barra("Notas").click());
await pantalla("Resumen", () => barra("Resumen").click());
await pantalla("Tareas", () => barra("Tareas").click());
await pantalla("Tareas · diálogo Nueva tarea", async () => {
  await page.getByRole("button", { name: "Nueva tarea" }).first().click();
  await page.getByPlaceholder("¿Qué hay que hacer?").waitFor({ timeout: 5000 });
});
await page.keyboard.press("Escape");
await pantalla("Calendario", () => barra("Calendario").click());
await pantalla("Grafo", () => barra("Grafo").click());
await pantalla("Configuración", () =>
  page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Configuración" }).first().click(),
);

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} botón(es) por debajo de ${ALTURA_MINIMA} px`);
process.exit(fallos.length === 0 ? 0 : 1);
