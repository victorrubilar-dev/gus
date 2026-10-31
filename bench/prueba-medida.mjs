/**
 * Regresión de la medida del editor: a 1280 y 1600 px el texto mide 680 px y
 * está centrado, y el overlay y el textarea comparten el mismo margen (si
 * difirieran, el cursor y el texto dibujado se desalinearían). Además el
 * título del explorador no se trunca, y la cabecera del editor sigue la medida. Requiere `vite --port 5199`.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/app-smoke.html?semilla";
const MEDIDA = 680;
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const fallos = [];
const comprobar = (ok, texto) => {
  console.log(`${ok ? "PASA " : "FALLA"} ${texto}`);
  if (!ok) fallos.push(texto);
};

for (const ancho of [1280, 1600]) {
  const page = await (await browser.newContext({ viewport: { width: ancho, height: 800 }, locale: "es-ES" })).newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  // La app arranca en el Resumen: se pasa a Notas.
  await page.locator('[data-tour="sidebar"]').getByRole("button", { name: "Notas", exact: true }).first().click();
  await page.getByText("bienvenida.md").first().click();
  const area = page.locator('textarea[data-drop-editor="nota"]');
  await area.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => {
    const a = document.querySelector('textarea[data-drop-editor="nota"]');
    const o = document.querySelector(".gus-source-overlay");
    const ea = getComputedStyle(a);
    const eo = getComputedStyle(o);
    const ra = a.getBoundingClientRect();
    const sb = a.offsetWidth - a.clientWidth;
    return {
      izq: parseFloat(ea.paddingLeft),
      der: parseFloat(ea.paddingRight),
      ancho: a.clientWidth,
      izqOverlay: parseFloat(eo.paddingLeft),
      sb,
      panel: ra.width,
    };
  });
  const contenido = m.ancho - m.izq - m.der;
  comprobar(Math.abs(contenido - MEDIDA) <= 1, `${ancho} px: el texto mide ${Math.round(contenido)} px (medida ${MEDIDA})`);
  comprobar(Math.abs(m.izq - m.izqOverlay) <= 0.5, `${ancho} px: overlay y textarea tienen el mismo margen izquierdo (${m.izq} / ${m.izqOverlay})`);
  comprobar(Math.abs(m.izq - (m.der + m.sb)) <= 1, `${ancho} px: el texto está centrado (${Math.round(m.izq)} px a la izquierda, ${Math.round(m.der + m.sb)} a la derecha)`);
  const truncado = await page.evaluate(() => {
    const titulo = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent?.trim().toUpperCase() === "NOTAS");
    return titulo ? titulo.scrollWidth > titulo.clientWidth : true;
  });
  comprobar(!truncado, `${ancho} px: el título del explorador no se trunca`);
  const cabecera = await page.evaluate(() => {
    const h = document.querySelector('[data-tour="editor"] header');
    const a = document.querySelector('textarea[data-drop-editor="nota"]');
    return { cab: parseFloat(getComputedStyle(h).paddingLeft), area: parseFloat(getComputedStyle(a).paddingLeft) };
  });
  comprobar(Math.abs(cabecera.cab - cabecera.area) <= 0.5, `${ancho} px: la cabecera del editor sigue la misma medida que el texto (${cabecera.cab} / ${cabecera.area})`);
  await page.screenshot({ path: `${process.argv[2] ?? "."}/medida-${ancho}.png` });
}

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} fallo(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
