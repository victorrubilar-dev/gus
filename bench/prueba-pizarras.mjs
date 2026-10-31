/**
 * Pizarras sobre la app completa con `?semilla`: miniaturas en la lista y
 * exportar a SVG y a PNG (el diálogo de guardar y el backend están simulados).
 * Requiere `vite --port 5199`.
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
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Pizarras", exact: true }).first().click();
await page.getByText("Plan de la semana").waitFor({ timeout: 8000 });
await page.waitForTimeout(600);
const exportados = () => page.evaluate(() => window.__smoke.exportados.map((e) => ({ ...e })));

console.log("--- miniaturas ---");
const tarjeta = (nombre) => page.locator("li", { hasText: nombre }).first();
comprobar((await tarjeta("Plan de la semana").locator("img").count()) === 1, "una pizarra con contenido enseña su miniatura");
const src = await tarjeta("Plan de la semana").locator("img").getAttribute("src");
const svgMini = decodeURIComponent(src.replace("data:image/svg+xml;charset=utf-8,", ""));
comprobar(svgMini.includes("<rect") && svgMini.includes("<polygon") && svgMini.includes("<path"), "la miniatura dibuja formas, flechas y trazos");
comprobar(!svgMini.includes("var(--"), "sin variables CSS (no se resolverían dentro de una <img>)");
comprobar(!svgMini.includes("<&>") && svgMini.includes("&lt;&amp;&gt;"), "el texto de la pizarra va escapado");
comprobar((await tarjeta("Vacía").locator("img").count()) === 0 && (await tarjeta("Vacía").getByText("Vacía", { exact: true }).count()) >= 1, "una pizarra vacía lo dice en vez de enseñar un cuadro en blanco");

console.log("\n--- exportar ---");
await tarjeta("Plan de la semana").getByRole("button").first().click();
await page.getByRole("button", { name: "Exportar" }).waitFor({ timeout: 8000 });
await page.getByRole("button", { name: "Exportar" }).click();
await page.getByRole("menuitem", { name: /^SVG/ }).click();
await page.waitForFunction(() => window.__smoke.exportados.length === 1, null, { timeout: 8000 });
const svg = (await exportados())[0];
const texto = Buffer.from(svg.data, "base64").toString("utf8");
comprobar(svg.format === "svg" && svg.path.endsWith("Plan de la semana.svg"), "SVG: se guarda con el nombre de la pizarra y formato svg");
comprobar(texto.startsWith("<svg") && texto.includes('fill="#ffffff"'), "SVG: lleva fondo blanco");
comprobar(!texto.includes("var(--") && texto.includes("&lt;&amp;&gt;"), "SVG: colores reales y texto escapado");
comprobar(await page.getByText("Pizarra exportada.").isVisible(), "avisa de que se exportó");

await page.getByRole("button", { name: "Exportar" }).click();
await page.getByRole("menuitem", { name: /^PNG/ }).click();
await page.waitForFunction(() => window.__smoke.exportados.length === 2, null, { timeout: 15000 });
const png = (await exportados())[1];
const cabecera = Buffer.from(png.data, "base64").subarray(0, 8).toString("hex");
comprobar(png.format === "png" && cabecera === "89504e470d0a1a0a", "PNG: es un PNG de verdad (cabecera correcta)");
comprobar(Buffer.from(png.data, "base64").length > 500, "PNG: tiene contenido");

console.log("\n--- pizarra vacía ---");
await page.getByRole("button", { name: "Pizarras", exact: true }).last().click();
await tarjeta("Vacía").getByRole("button").first().click();
await page.getByRole("button", { name: "Exportar" }).click();
await page.getByRole("menuitem", { name: /^SVG/ }).click();
await page.getByText("La pizarra está vacía").waitFor({ timeout: 5000 });
comprobar((await exportados()).length === 2, "una pizarra vacía no exporta nada y lo explica");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
