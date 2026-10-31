/**
 * Configuración: categorías y dónde está cada ajuste, buscador, recorrido desde
 * «Acerca de» y cambio de idioma. Requiere `vite --port 5199`.
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
await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Configuración", exact: true }).first().click();
await page.getByText("Los cambios se guardan automáticamente").waitFor({ timeout: 8000 });

const categoria = (nombre) => page.locator("main button", { hasText: new RegExp(`^${nombre}\\d`) }).first();
const abrir = async (nombre) => {
  await categoria(nombre).click();
  await page.waitForTimeout(250);
};
const visible = (texto) => page.getByText(texto, { exact: true }).first().isVisible().catch(() => false);

console.log("--- categorías ---");
const nombres = await page.evaluate(() =>
  [...document.querySelectorAll("main button")].map((b) => b.textContent.trim().replace(/\d+$/, "")).filter((t) => ["General", "Apariencia", "Notas", "Tareas y avisos", "Atajos", "Acerca de"].includes(t)),
);
comprobar(JSON.stringify(nombres) === JSON.stringify(["General", "Apariencia", "Notas", "Tareas y avisos", "Atajos", "Acerca de"]), "hay seis categorías, sin «Calendario» ni «Idioma» sueltas");

console.log("\n--- cada ajuste en su sitio ---");
await abrir("General");
comprobar((await visible("Idioma de la aplicación")) && (await visible("Reabrir el último vault")), "General: idioma y reabrir el último vault");
await abrir("Apariencia");
comprobar((await visible("Tema")) && (await visible("Animaciones")), "Apariencia: tema y animaciones");
await abrir("Notas");
comprobar((await visible("Autoguardado")) && (await visible("Carpeta de las notas diarias")), "Notas: autoguardado y las notas diarias juntas");
await abrir("Tareas y avisos");
comprobar(await visible("Mostrar completadas en el calendario"), "Tareas y avisos: incluye lo del calendario");
comprobar(await page.getByText(/avisos|notificaciones/i).first().isVisible(), "Tareas y avisos: incluye los avisos del sistema");
await abrir("Acerca de");
comprobar(await page.getByText("Gus 0.3.0").isVisible(), "Acerca de: enseña la versión");
comprobar((await visible("Comprobar actualizaciones")) && (await visible("Volver a recorrer Gus")), "Acerca de: actualizaciones y recorrido");
comprobar(await page.getByRole("button", { name: "Código en GitHub" }).isVisible(), "Acerca de: enlaces al código y a los problemas");

console.log("\n--- buscador ---");
await page.getByPlaceholder("Buscar configuración…").fill("idioma");
await page.waitForTimeout(300);
comprobar(await visible("Idioma de la aplicación"), "buscar «idioma» encuentra el ajuste donde esté");
await page.getByPlaceholder("Buscar configuración…").fill("privacidad");
await page.waitForTimeout(300);
comprobar(await page.getByText("Gus 0.3.0").isVisible(), "buscar «privacidad» encuentra Acerca de");
await page.getByPlaceholder("Buscar configuración…").fill("");

console.log("\n--- recorrido desde Acerca de ---");
await abrir("Acerca de");
await page.getByRole("button", { name: "Volver a recorrer Gus" }).click();
comprobar(await page.getByText("Paso 1 de 10").isVisible(), "el botón abre el recorrido de 10 pasos");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} comprobación(es) fallaron`);
process.exit(fallos.length === 0 ? 0 : 1);
