import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/index.html";
const fallos = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

const browser = await chromium.launch({
  executablePath: "/home/korossuh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

const area = page.locator("textarea");

/**
 * Vacía el campo con el setter nativo, que es lo que ve React, y deja el
 * cursor al principio. El clic va con el ratón a un punto que no sea una tabla:
 * el banco tiene una, y pinchar dentro se lo queda la celda.
 */
async function limpiar() {
  await area.evaluate((el) => el.blur());
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const set = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    set.call(ta, "");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(0, 0);
  });
  await page.waitForTimeout(250);
}

/** Celdas de una fila de tabla: sin los «|» de los bordes, que no son celdas. */
const celdas = (linea) =>
  linea
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());

/** Escribe en limpio y abre el menú «/» esperando a que aparezca. */
async function menuCon(texto = "") {
  await limpiar();
  // La barra va primero: «/ta», no «ta/» (sin espacio antes, no es consulta).
  await page.keyboard.type("/" + texto);
  await page.waitForSelector('[role="listbox"]', { timeout: 6000 });
  return page.locator('[role="listbox"]').first();
}

console.log("--- el menú «/» ---");
const menu = await menuCon();
const texto = await menu.innerText();
ok(/Tabla/.test(texto), "«Tabla» sigue en el menú");
ok(!/Tamaño de la tabla/.test(texto), "no hay segunda pantalla de tamaños");

// La pista del pie: «/ta» literal, a la derecha.
const pie = await page.evaluate(() => {
  const m = document.querySelector('[role="listbox"]');
  const p = [...m.querySelectorAll("p")].pop();
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    texto: p.innerText.trim(),
    piezas: [...p.children].map((c) => {
      const b = c.getBoundingClientRect();
      return { txt: c.textContent.trim(), derecha: b.left >= r.left + r.width / 2 };
    }),
  };
});
ok(Boolean(pie), "el menú tiene pista del pie");
ok(pie && pie.texto.includes("/ta"), `la pista dice «/ta» (${JSON.stringify(pie?.texto)})`);
ok(
  Boolean(pie?.piezas.find((p) => p.txt === "/ta" && p.derecha)),
  "«/ta» está en la esquina derecha",
);

console.log("\n--- insertar con «/tabla» ---");
await limpiar();
await page.keyboard.type("/tabla");
await page.waitForSelector('[role="listbox"]', { timeout: 6000 });
await page.locator('[role="option"]', { hasText: "Tabla" }).first().click();
await page.waitForTimeout(400);

const valor = await area.inputValue();
const filas = valor.trim().split("\n");
ok(filas.length === 7, `7 líneas: cabecera + separador + 5 de cuerpo (${filas.length})`);
ok(celdas(filas[0]).length === 3, `3 columnas (${filas[0].trim()})`);
ok(
  celdas(filas[1]).length === 3 && celdas(filas[1]).every((c) => c === "---"),
  `el separador tiene tres guiones (${filas[1].trim()})`,
);
ok(
  filas.slice(2).every((l) => celdas(l).length === 3 && celdas(l).every((c) => c === "")),
  `las 5 filas de cuerpo tienen 3 celdas vacías (${filas[2].trim()})`,
);

console.log("\n--- ya no hay grupo de tamaños ---");
// Tras insertar, el cursor queda dentro de la tabla; limpiar lo saca de ahí.
await menuCon("ta");
const filtrado = await page.locator('[role="listbox"]').first().innerText();
ok(/Tabla/.test(filtrado), `«/ta» encuentra la tabla (${JSON.stringify(filtrado.split("\n")[0])})`);
ok(!/2 × 2|4 × 3|5 × 5/.test(filtrado), "no aparecen los tamaños sueltos");
await page.keyboard.press("Escape");

await browser.close();
console.log(`\n${fallos.length === 0 ? "TODO EN VERDE" : `FALLOS: ${fallos.length}`}`);
process.exit(fallos.length === 0 ? 0 : 1);
