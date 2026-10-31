/**
 * Gestión de vaults sobre la app completa (backend simulado): salir al
 * selector, volver a abrir uno, crear uno nuevo y comprobar la configuración
 * que se guarda (lista de vaults y último abierto). Red de seguridad para
 * partir la gestión de vaults de `App`. Requiere `vite --port 5199`.
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
const barra = page.locator('[data-tour="sidebar"]');
const ultimaConfig = () => page.evaluate(() => window.__smoke.configGuardada.at(-1));
const espera = () => page.waitForTimeout(500);

await barra.getByRole("button", { name: "Notas", exact: true }).first().click();
await page.getByText("bienvenida.md").first().waitFor({ timeout: 10000 });

console.log("--- salir al selector y reabrir ---");
await barra.getByRole("button", { name: "Salir del vault" }).click();
await espera();
comprobar(await page.getByRole("button", { name: "Abrir el vault Demo" }).isVisible(), "el selector lista el vault «Demo»");
await page.getByRole("button", { name: "Abrir el vault Demo" }).click();
await page.getByText("Resumen", { exact: true }).first().waitFor({ timeout: 10000 });
comprobar(await barra.isVisible(), "abrir «Demo» devuelve a la app");

console.log("\n--- crear un vault nuevo ---");
await barra.getByRole("button", { name: "Salir del vault" }).click();
await espera();
await page.getByRole("button", { name: "Nuevo vault" }).first().click();
await page.getByPlaceholder("Mi diario").fill("Segundo");
await page.getByRole("button", { name: "Crear vault", exact: true }).click();
await espera();
const config = await ultimaConfig();
const vaults = config?.vaults ?? [];
comprobar(vaults.length === 2, "la configuración guarda dos vaults");
comprobar(vaults.some((v) => v.name === "Segundo" && v.path.endsWith("/Segundo")), "el nuevo vault se llama «Segundo»");
comprobar(config?.lastVault?.endsWith("/Segundo") === true, "«Segundo» queda como último vault abierto");
comprobar(await barra.isVisible(), "tras crearlo se entra en el vault");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
