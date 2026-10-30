/**
 * Foco visible: en cada vista recorre los controles con Tab y comprueba que el
 * elemento enfocado cambia de aspecto (contorno, sombra, borde o fondo) respecto
 * a cuando no tiene el foco. Requiere `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const VISTAS = ["Resumen", "Notas", "Tareas", "Calendario", "Grafo", "Configuración"];
const MAX_TABS = 200;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" })).newPage();
page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));
await page.goto("http://localhost:5199/bench/app-smoke.html?semilla", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Notas", exact: true }).first().waitFor({ timeout: 15000 });

const huella = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    if (el.dataset.focoVisto) return "vuelta";
    el.dataset.focoVisto = "1";
    const s = getComputedStyle(el);
    const estilo = (e) => {
      const c = getComputedStyle(e);
      return [c.outlineStyle === "none" ? "" : `${c.outlineWidth} ${c.outlineColor}`, c.boxShadow, c.borderTopColor, c.backgroundColor, c.color, c.textDecorationLine].join("|");
    };
    const con = estilo(el);
    el.blur();
    const sin = estilo(el);
    el.focus();
    const r = el.getBoundingClientRect();
    const nombre = el.getAttribute("aria-label") || el.getAttribute("title") || (el.textContent || "").trim().slice(0, 30) || el.tagName;
    return { visible: con !== sin, nombre: `${el.tagName.toLowerCase()} «${nombre}»`, oculto: r.width === 0 || r.height === 0, s: s.display };
  });

let fallos = 0;
for (const vista of VISTAS) {
  const boton = page.locator('[data-tour="sidebar"]').getByRole("button", { name: vista, exact: true }).first();
  await boton.click();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll("[data-foco-visto]").forEach((e) => delete e.dataset.focoVisto));
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.mouse.click(1270, 5); // saca el foco de la barra sin activar nada
  const sinFoco = [];
  let total = 0;
  for (let i = 0; i < MAX_TABS; i++) {
    await page.keyboard.press("Tab");
    const h = await huella();
    if (!h) continue;
    if (h === "vuelta") break;
    if (h.oculto) continue;
    total++;
    if (!h.visible) sinFoco.push(h.nombre);
  }
  const ok = sinFoco.length === 0;
  if (!ok) fallos++;
  console.log(`${ok ? "PASA " : "FALLA"}  ${vista}: ${total} controles con foco${ok ? " visible" : `; sin cambio al enfocar: ${[...new Set(sinFoco)].join(", ")}`}`);
}

await browser.close();
console.log(fallos === 0 ? "\nTODO EN VERDE" : `\n${fallos} vista(s) con controles sin foco visible`);
process.exit(fallos === 0 ? 0 : 1);
