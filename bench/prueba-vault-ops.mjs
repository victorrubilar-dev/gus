/**
 * Operaciones del explorador sobre la app completa (backend simulado con `?semilla`):
 * crear nota y carpeta, renombrar, mover, navegar por la ruta (entrar, atrás,
 * adelante, subir) y borrar. Es la red de seguridad para partir `FileExplorer`
 * y `App`. Requiere `vite --port 5199`.
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
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Notas", exact: true }).first().click();
await page.getByText("bienvenida.md").first().waitFor({ timeout: 10000 });

const archivos = () => page.evaluate(() => [...window.__smoke.archivos.keys()].sort());
const fila = (ruta) => page.locator(`[data-entry-id="${ruta}"]`);
const espera = () => page.waitForTimeout(400);
const btn = (nombre) => page.getByRole("button", { name: nombre, exact: true }).first();

console.log("--- crear ---");
await btn("Nueva nota").click();
await espera();
comprobar((await archivos()).includes("/vault/nueva-nota.md"), "«Nueva nota» crea nueva-nota.md en el vault");
await btn("Nueva carpeta").click();
await espera();
comprobar(await page.getByText("nueva-carpeta").first().isVisible(), "«Nueva carpeta» aparece en la lista");

console.log("\n--- renombrar ---");
await fila("/vault/lecturas.md").click({ button: "right" });
await page.getByRole("menuitem", { name: "Renombrar" }).click();
const campo = page.getByLabel(/Nuevo nombre para/);
await campo.fill("libros");
await campo.press("Enter");
await espera();
const tras = await archivos();
comprobar(tras.includes("/vault/libros.md") && !tras.includes("/vault/lecturas.md"), "renombrar nota: libros.md existe y lecturas.md no");

console.log("\n--- carpetas: entrar, atrás, adelante, subir ---");
await page.getByText("diario", { exact: true }).first().dblclick().catch(() => {});
await espera();
const dentro = await page.getByText("2026-10-28.md").first().isVisible().catch(() => false);
comprobar(dentro, "entrar en «diario» muestra sus notas");
await btn("Volver a la carpeta anterior").click();
await espera();
comprobar(await page.getByText("bienvenida.md").first().isVisible(), "atrás vuelve a la raíz");
await btn("Avanzar a la carpeta siguiente").click();
await espera();
comprobar(await page.getByText("2026-10-28.md").first().isVisible(), "adelante vuelve a «diario»");
await page.keyboard.press("Alt+ArrowUp");
await espera();
comprobar(await page.getByText("bienvenida.md").first().isVisible(), "Alt+↑ sube a la raíz");

console.log("\n--- mover ---");
await fila("/vault/proyecto-gus.md").click({ button: "right" });
await page.getByRole("menuitem", { name: /^Mover/ }).click();
await page.getByRole("menuitem", { name: /diario/ }).click();
await espera();
comprobar((await archivos()).includes("/vault/diario/proyecto-gus.md"), "mover proyecto-gus.md a diario/");

console.log("\n--- borrar ---");
await fila("/vault/bienvenida.md").click({ button: "right" });
await page.getByRole("menuitem", { name: "Eliminar…" }).click();
await page.getByRole("menuitem", { name: "Mover a la papelera" }).click().catch(async () => {
  await page.getByRole("button", { name: "Mover a la papelera" }).click();
});
await espera();
comprobar(!(await archivos()).includes("/vault/bienvenida.md"), "mover a la papelera quita bienvenida.md");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
