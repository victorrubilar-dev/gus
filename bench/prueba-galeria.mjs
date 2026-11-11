/**
 * Galería de imágenes sobre la app completa (backend simulado): rejilla, filtros
 * por carpeta y nombre, visor con anterior/siguiente, mover y papelera.
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
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));

await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.evaluate(() => {
  for (const ruta of ["/vault/captura.png", "/vault/viajes/playa.jpg", "/vault/viajes/monte.webp"]) window.__smoke.archivos.set(ruta, "");
});
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Galería", exact: true }).first().click();
await page.getByText("3 imágenes").waitFor({ timeout: 10000 });
const tarjetas = () => page.locator("main ul > li").count();
comprobar((await tarjetas()) === 3, "la rejilla enseña las tres imágenes del vault");

await page.getByLabel("Carpeta", { exact: true }).selectOption("viajes");
await page.waitForTimeout(200);
comprobar((await tarjetas()) === 2, "filtrar por «viajes» deja dos");
await page.getByLabel("Buscar por nombre o carpeta").fill("playa");
await page.waitForTimeout(200);
comprobar((await tarjetas()) === 1, "buscar «playa» deja una");
await page.getByLabel("Buscar por nombre o carpeta").fill("");
await page.getByLabel("Carpeta", { exact: true }).selectOption("*");
await page.waitForTimeout(200);

await page.getByTitle("captura.png").click();
const visor = page.getByRole("dialog");
comprobar((await visor.getAttribute("aria-label")) === "captura.png", "pulsar una miniatura abre el visor");
await page.keyboard.press("ArrowRight");
comprobar((await visor.getAttribute("aria-label")) !== "captura.png", "→ pasa a la siguiente");
await page.keyboard.press("ArrowLeft");
comprobar((await visor.getAttribute("aria-label")) === "captura.png", "← vuelve a la anterior");

await visor.getByLabel("Mover a la carpeta").selectOption("viajes");
await page.waitForTimeout(500);
const tras = await page.evaluate(() => [...window.__smoke.archivos.keys()]);
comprobar(tras.includes("/vault/viajes/captura.png") && !tras.includes("/vault/captura.png"), "«Mover a» lleva captura.png a viajes/");

const actual = await visor.getAttribute("aria-label");
await visor.getByRole("button", { name: "Mover a la papelera" }).click();
await visor.getByRole("button", { name: "Mover a la papelera" }).click();
await page.waitForTimeout(500);
const restantes = await page.evaluate(() => [...window.__smoke.archivos.keys()].filter((r) => /\.(png|jpg|webp)$/.test(r)));
comprobar(restantes.length === 2 && !restantes.some((r) => r.endsWith(`/${actual}`)), "la papelera quita la imagen tras confirmar");

await page.keyboard.press("Escape");
await page.waitForTimeout(200);
comprobar((await page.getByRole("dialog").count()) === 0, "Esc cierra el visor");
comprobar(await page.getByText("2 imágenes").isVisible(), "la cuenta se pone al día");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
