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


console.log("\n--- menú de cada pizarra ---");
await page.getByRole("button", { name: "Pizarras", exact: true }).last().click().catch(() => {});
await page.getByText("Plan de la semana").first().waitFor({ timeout: 8000 });
const nombres = () => page.evaluate(() => [...window.__smoke.pizarras.values()].map((json) => JSON.parse(json).name).sort());
const menu = async (nombre) => {
  await tarjeta(nombre).hover();
  await page.getByRole("button", { name: `Opciones de «${nombre}»`, exact: true }).click();
};

await menu("Ideas");
await page.getByRole("menuitem", { name: "Duplicar" }).click();
await page.getByText("Pizarra duplicada.").waitFor({ timeout: 5000 });
comprobar((await nombres()).includes("Ideas (copia)"), "duplicar crea «Ideas (copia)» con su contenido");
await menu("Ideas");
await page.getByRole("menuitem", { name: "Duplicar" }).click();
await page.waitForFunction(() => [...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Ideas (copia 2)"), null, { timeout: 5000 });
comprobar(true, "duplicar otra vez numera la copia («copia 2»)");

await menu("Ideas (copia)");
await page.getByRole("menuitem", { name: "Renombrar" }).click();
const campo = page.getByLabel(/Nuevo nombre de «Ideas \(copia\)»/);
await campo.fill("Borrador");
await campo.press("Enter");
await page.waitForFunction(() => [...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Borrador"), null, { timeout: 5000 });
comprobar(true, "renombrar guarda el nombre nuevo");
await menu("Borrador");
await page.getByRole("menuitem", { name: "Renombrar" }).click();
const campo2 = page.getByLabel(/Nuevo nombre de «Borrador»/);
await campo2.fill("No debería quedar");
await campo2.press("Escape");
await page.waitForTimeout(400);
comprobar(!(await nombres()).includes("No debería quedar"), "Esc cancela el renombrado");

const antes = (await exportados()).length;
await menu("Borrador");
await page.getByRole("menuitem", { name: /^SVG/ }).click();
await page.waitForFunction((n) => window.__smoke.exportados.length === n + 1, antes, { timeout: 8000 });
comprobar((await exportados()).at(-1).path.endsWith("Borrador.svg"), "exportar desde el menú guarda con el nombre de la pizarra");

await menu("Borrador");
await page.getByRole("menuitem", { name: "Mover a la papelera" }).click();
await page.getByText("¿Mover a la papelera?").waitFor({ timeout: 3000 });
await page.getByRole("button", { name: "Cancelar" }).click();
comprobar((await nombres()).includes("Borrador"), "cancelar la confirmación no borra nada");
await menu("Borrador");
await page.getByRole("menuitem", { name: "Mover a la papelera" }).click();
await page.getByRole("button", { name: "Mover", exact: true }).click();
await page.waitForFunction(() => ![...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Borrador"), null, { timeout: 5000 });
comprobar(true, "confirmar mueve la pizarra a la papelera");

console.log("\n--- fijar, color, buscar y ordenar ---");
const orden = () => page.locator("ul > li").evaluateAll((items) => items.map((li) => li.querySelector("span.truncate")?.textContent ?? ""));
await menu("Vacía");
await page.getByRole("menuitem", { name: "Fijar arriba" }).click();
await page.waitForFunction(() => [...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Vacía" && JSON.parse(j).pinned === true), null, { timeout: 5000 });
await page.waitForTimeout(400);
comprobar((await orden())[0] === "Vacía", "una pizarra fijada sube arriba aunque sea más vieja");
await menu("Vacía");
comprobar(await page.getByRole("menuitem", { name: "Quitar de las fijadas" }).isVisible(), "el menú ofrece quitarla de las fijadas");
await page.keyboard.press("Escape");

await menu("Ideas");
await page.getByRole("menuitemradio", { name: "Azul" }).click();
await page.waitForFunction(() => [...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Ideas" && JSON.parse(j).color === "#3b82f6"), null, { timeout: 5000 });
await page.waitForTimeout(400);
comprobar((await tarjeta("Ideas").locator("span[aria-hidden=true][style*='background']").count()) >= 1, "el color de etiqueta se ve como una franja en la tarjeta");

const buscador = page.getByLabel("Buscar pizarras");
await buscador.fill("IDEAS");
await page.waitForTimeout(300);
comprobar(JSON.stringify(await orden()) === JSON.stringify(["Ideas", "Ideas (copia 2)"]), "buscar filtra por nombre sin mirar mayúsculas");
await buscador.fill("zzz");
comprobar(await page.getByText("Ninguna pizarra coincide con «zzz».").isVisible(), "sin coincidencias lo dice");
await buscador.fill("");

await page.getByLabel("Ordenar").selectOption("name");
await page.waitForTimeout(300);
const porNombre = await orden();
comprobar(porNombre[0] === "Vacía" && porNombre.slice(1).join("|") === ["Ideas", "Ideas (copia 2)", "Plan de la semana"].join("|"), "ordenar por nombre mantiene las fijadas arriba");
comprobar((await page.evaluate(() => localStorage.getItem("gus.boards-sort"))) === "name", "el orden elegido se recuerda");

await menu("Plan de la semana");
await page.getByRole("menuitem", { name: "Copiar como imagen" }).click();
await page.getByText("Imagen copiada al portapapeles.").waitFor({ timeout: 8000 });
comprobar((await page.evaluate(() => window.__smoke.portapapeles))[0]?.bytes > 500, "copiar como imagen manda un PNG al portapapeles");

await tarjeta("Ideas").first().getByRole("button").first().click();
await page.getByRole("button", { name: "Exportar", exact: true }).waitFor({ timeout: 8000 });
await page.getByRole("button", { name: "Exportar", exact: true }).click();
await page.getByRole("menuitem", { name: "Copiar como imagen" }).click();
await page.getByText("Imagen copiada al portapapeles.").waitFor({ timeout: 8000 });
comprobar((await page.evaluate(() => window.__smoke.portapapeles)).length === 2, "el editor también copia la imagen");
await page.getByRole("textbox", { name: "Nombre de la pizarra" }).fill("Ideas buenas").catch(() => {});
await page.waitForTimeout(1200);
const guardada = await page.evaluate(() => [...window.__smoke.pizarras.values()].map((j) => JSON.parse(j)).find((p) => p.name === "Ideas buenas" || (p.name === "Ideas" && p.color)));
comprobar(guardada?.color === "#3b82f6", "guardar desde el editor no pierde el color de etiqueta");
await page.getByRole("button", { name: "Pizarras", exact: true }).last().click();
await page.getByText("Plan de la semana").first().waitFor({ timeout: 8000 });

console.log("\n--- selección múltiple ---");
await page.getByRole("button", { name: "Seleccionar", exact: true }).click();
await tarjeta("Plan de la semana").getByRole("button").first().click();
await tarjeta("Vacía").getByRole("button").first().click();
await tarjeta("Ideas").first().getByRole("button").first().click();
comprobar(await page.getByText("3 seleccionadas").isVisible(), "marcar tarjetas cuenta las seleccionadas (3)");
const previo = (await exportados()).length;
await page.getByRole("button", { name: "Exportar", exact: true }).click();
await page.getByRole("menuitem", { name: /^PNG/ }).click();
await page.getByText(/Pizarras exportadas: 2/).waitFor({ timeout: 15000 });
const lote = (await exportados()).slice(previo);
comprobar(lote.length === 2 && lote.every((e) => e.format === "png" && e.unique && e.path.startsWith("/tmp/exportadas/")), "exportar varias guarda un archivo por pizarra en la carpeta elegida, sin pisar");
comprobar(await page.getByText(/1 vacías no se exportaron/).isVisible(), "avisa de las vacías que se saltó");

await page.getByRole("button", { name: "Duplicar", exact: true }).click();
await page.getByText("Pizarras duplicadas.").waitFor({ timeout: 8000 });
comprobar((await nombres()).filter((n) => n.includes("(copia")).length >= 3, "duplicar varias crea una copia de cada una");

const antesBorrar = (await nombres()).length;
await page.getByRole("button", { name: /^Mover 3 a la papelera/ }).click();
await page.getByText("¿Mover 3 pizarras a la papelera?").waitFor({ timeout: 3000 });
await page.getByRole("button", { name: "Mover", exact: true }).click();
await page.waitForFunction(() => ![...window.__smoke.pizarras.values()].some((j) => JSON.parse(j).name === "Plan de la semana"), null, { timeout: 5000 });
const quedan = await nombres();
comprobar(!quedan.includes("Plan de la semana") && !quedan.includes("Vacía") && quedan.length === antesBorrar - 3, `eliminar varias solo quita las seleccionadas (quedan: ${quedan.join(" | ")})`);
await page.keyboard.press("Escape");
comprobar((await page.getByRole("toolbar", { name: "Seleccionar" }).count()) === 0, "Esc sale del modo selección");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
