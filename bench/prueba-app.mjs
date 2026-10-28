/**
 * Smoke test de la app completa con backend simulado (ver `app-smoke.tsx`):
 * abrir el vault, crear una nota, escribir y que llegue a disco, y crear una
 * tarea y comprobar que se envía al backend. El backend es falso: la tarea no
 * se guarda de verdad, solo se comprueba el contrato IPC. Requiere
 * `vite --port 5199` (ver `bench:app`).
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/app-smoke.html";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
// La app sigue el idioma del navegador: el smoke test va en español.
const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" });
const page = await contexto.newPage();

const fallos = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Notas", exact: true }).first().waitFor({ timeout: 15000 });
ok(true, "la app arranca con el vault abierto");

await page.getByRole("button", { name: "Notas", exact: true }).first().click();
await page.locator('button[aria-label="Nueva nota"]').waitFor({ timeout: 8000 });

await page.locator('button[aria-label="Nueva nota"]').click();
await page.waitForFunction(() => window.__smoke.archivos.has("/vault/nueva-nota.md"), null, {
  timeout: 8000,
});
ok(true, "«Nueva nota» crea nueva-nota.md en el vault");

await page.locator("textarea").first().click();
await page.keyboard.press("Control+End");
await page.keyboard.type("Texto del smoke");
await page.waitForFunction(
  () => [...window.__smoke.archivos.values()].some((c) => c.includes("Texto del smoke")),
  null,
  { timeout: 8000 },
);
ok(true, "lo escrito en el editor llega al disco (autoguardado)");

await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
await page.getByRole("button", { name: "Nueva tarea" }).click();
await page.getByPlaceholder("¿Qué hay que hacer?").fill("Tarea del smoke");
await page.getByRole("button", { name: "Crear tarea" }).click();
await page.waitForFunction(
  () => window.__smoke.llamadas.some(
    (c) => c.cmd === "publish_new_task" && c.args.task?.title === "Tarea del smoke",
  ),
  null,
  { timeout: 8000 },
);
ok(true, "«Crear tarea» envía el título al backend (publish_new_task)");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} fallo(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
