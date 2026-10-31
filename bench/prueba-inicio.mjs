/**
 * Primera vez (`?vacio`: sin vaults): bienvenida, primer vault y recorrido por
 * la app hasta el final. Requiere `vite --port 5199`.
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

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla&vacio", { waitUntil: "networkidle" });

console.log("--- bienvenida ---");
comprobar(await page.getByRole("heading", { name: "Bienvenido a Gus" }).isVisible(), "se da la bienvenida");
comprobar(await page.getByText(/sin cuenta y sin nube/).isVisible(), "dice que todo se queda en el equipo");
await page.getByRole("button", { name: /Empezar/ }).click();

console.log("\n--- primer vault ---");
await page.getByRole("heading", { name: "Crea tu primer vault" }).waitFor({ timeout: 8000 });
comprobar(await page.getByText(/Un vault es una carpeta de tu equipo/).isVisible(), "explica qué es un vault");
comprobar((await page.getByRole("button", { name: "Editar vault" }).count()) === 0, "no ofrece «Editar vault» sin vaults");
comprobar((await page.getByLabel("Nombre del vault").inputValue()) === "Mis notas", "el nombre ya viene puesto («Mis notas»)");
await page.getByRole("button", { name: "Volver" }).click();
comprobar(await page.getByRole("heading", { name: "Bienvenido a Gus" }).isVisible(), "«Volver» regresa a la bienvenida");
await page.getByRole("button", { name: /Empezar/ }).click();
await page.getByRole("button", { name: "Crear vault", exact: true }).click();
await page.waitForFunction(
  () => window.__smoke.configGuardada.some((c) => c?.vaults?.some((v) => v.name === "Mis notas")),
  null,
  { timeout: 8000 },
);
comprobar(true, "crear el vault lo guarda en la configuración");

console.log("\n--- recorrido ---");
await page.getByText("Tu resumen", { exact: true }).waitFor({ timeout: 8000 });
comprobar(await page.getByText("Paso 1 de 10").isVisible(), "el recorrido empieza en el paso 1 de 10");
comprobar(await page.getByText(/tus hábitos, la nota del día/).isVisible(), "el primer paso habla del resumen de hoy");
const vistos = [];
for (let paso = 1; paso <= 10; paso++) {
  vistos.push(await page.locator("h2, h3, [role=dialog] p").first().innerText().catch(() => ""));
  const siguiente = page.getByRole("button", { name: /Siguiente|Terminar/ });
  if (paso === 7) comprobar(await page.getByText("Hábitos", { exact: true }).first().isVisible(), "pasa por Hábitos (paso 7)");
  await siguiente.click();
  await page.waitForTimeout(300);
}
await page.waitForTimeout(500);
comprobar((await page.getByText(/Paso \d+ de 10/).count()) === 0, "al terminar el recorrido se cierra");
comprobar(await page.evaluate(() => localStorage.getItem("gus.tour")) === "done", "queda marcado como visto");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
