/**
 * Prueba del editor de tablas con un ratón de verdad (Chromium headless).
 *
 * Reproduce lo que hace la persona: arrastrar sobre varias celdas, hacer clic
 * derecho encima y usar las acciones de la tabla (agregar fila y deshacer),
 * cambiar la anchura de una columna por su borde y comprobar que el cursor
 * avisa de que ese borde se puede arrastrar: todo lo que solo se puede
 * comprobar con eventos de puntero reales.
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/index.html";

const browser = await chromium.launch({
  executablePath: "/home/korossuh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });

const fallos = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

page.on("console", (m) => {
  if (m.type() === "error") console.log("  [error del navegador]", m.text().slice(0, 200));
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector("textarea", { timeout: 10000 });

// Las celdas del overlay son [data-cell]; se localizan por fila y columna.
const celda = (linea, col) =>
  page.locator(`[data-cell][data-line="${linea}"][data-col="${col}"]`).first();

const area = page.locator("textarea");
await area.click({ position: { x: 5, y: 5 } });

// --- 1) Arrastrar de la celda (2,0) a la (3,1) ---
const a = await celda(2, 0).boundingBox();
const b = await celda(3, 1).boundingBox();
ok(Boolean(a && b), "las celdas se localizan en el overlay");

const c = await celda(3, 1).boundingBox();
await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
await page.mouse.down();

// --- 2) El recuadro tiene que verse YA, sin soltar el ratón ---
// Se comprueba en dos momentos: a media arrastre (una fila) y ya en la fila
// de abajo. Con una sola celda marcada el recuadro no se dibuja, porque entonces
// lo marcado es texto, no celdas.
// El recuadro de celdas marcadas se pinta como un único <div> con este
// atributo (no clase por clase): es lo que hay que mirar.
const pintado = () => page.locator("[data-table-selection]").count();

await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 8 });
const pintadoDurante = await pintado();
ok(pintadoDurante === 1, `el recuadro se ve MIENTRAS se arrastra (recuadros: ${pintadoDurante})`);

const pintadoFinal = await pintado();
await page.mouse.up();

ok(pintadoFinal === 1, `al soltar el recuadro sigue ahí (recuadros: ${pintadoFinal})`);

// --- 3) Clic derecho encima de la selección ---
await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: "right" });
await page.waitForSelector('[role="menu"]', { timeout: 4000 }).catch(() => {});

const hayMenu = await page.locator('[role="menu"]').count();
ok(hayMenu > 0, "se abre el menú contextual");

const sigueMarcado = await pintado();
ok(sigueMarcado === 1, `el recuadro NO se borra al hacer clic derecho (recuadros: ${sigueMarcado})`);

const textoMenu = await page.locator('[role="menu"]').first().innerText().catch(() => "");
ok(/Agregar fila/.test(textoMenu), "el menú ofrece la sección de tabla («Agregar fila»)");

// --- 4) Agregar fila desde el menú ---
const boton = page.locator('[role="menuitem"]', { hasText: "Agregar fila" }).first();
const activo = await boton.isEnabled().catch(() => false);
ok(activo, "«Agregar fila» está habilitado");

await boton.click();
await page.waitForTimeout(300);

const valor = await area.inputValue();
console.log("\n--- nota tras agregar fila ---\n" + valor + "\n");

const lineasTabla = (texto) => texto.split("\n").filter((l) => l.trim().startsWith("|")).length;
const trozos = valor.split("\n");
ok(
  lineasTabla(valor) === 6 && !trozos[4].includes("Eva") && Boolean(trozos[5]?.includes("Eva")),
  `la fila nueva entra debajo de la clicada (líneas de tabla: ${lineasTabla(valor)})`,
);

// --- 5) Deshacer ---
await area.focus();
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await page.waitForTimeout(200);
const trasDeshacer = await area.inputValue();
ok(
  lineasTabla(trasDeshacer) === 5,
  `deshacer deshace el «agregar fila» (líneas de tabla: ${lineasTabla(trasDeshacer)})`,
);

/* ---------------- más casos, con la nota restaurada ---------------- */

async function reiniciar() {
  await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(
      ta,
      "| Nombre | Apellido | Puntos |\n| --- | --- | --- |\n| Ana | Ruiz | 10 |\n| Luis | Paz | 20 |\n| Eva | Sol | 30 |\n\nTexto de después.",
    );
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);
}

const recuadros = () => page.locator("[data-table-selection]").count();
const nota = () => page.locator("textarea").inputValue();

console.log("\n--- Mayús y flechas ---");
await reiniciar();
await area.click({ position: { x: 5, y: 5 } });
const inicio = await celda(2, 0).boundingBox();
await page.mouse.click(inicio.x + inicio.width / 2, inicio.y + inicio.height / 2);
await page.keyboard.down("Shift");
await page.keyboard.press("ArrowDown");
await page.keyboard.up("Shift");
ok((await recuadros()) === 1, "Mayús+↓ marca celdas (rectángulo pintado)");

console.log("\n--- clic derecho tras arrastrar ---");
await reiniciar();
const p1 = await celda(2, 0).boundingBox();
const p2 = await celda(3, 1).boundingBox();
await page.mouse.move(p1.x + p1.width / 2, p1.y + p1.height / 2);
await page.mouse.down();
await page.mouse.move(p2.x + p2.width / 2, p2.y + p2.height / 2, { steps: 8 });
await page.mouse.up();
ok((await recuadros()) === 1, "rectángulo marcado tras el arrastre");
await page.mouse.click(p1.x + p1.width / 2, p1.y + p1.height / 2, { button: "right" });
await page.waitForSelector('[role="menu"]', { timeout: 4000 }).catch(() => {});
const texto2 = await page.locator('[role="menu"]').first().innerText().catch(() => "");
ok(
  /Agregar fila/.test(texto2),
  "el menú sigue ofreciendo las acciones de tabla aunque se pulse dentro",
);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

console.log("\n--- clic derecho en celda sin marcar ---");
await reiniciar();
await area.click({ position: { x: 5, y: 5 } });
const suelta = await celda(2, 1).boundingBox();
await page.mouse.click(suelta.x + suelta.width / 2, suelta.y + suelta.height / 2, {
  button: "right",
});
await page.waitForSelector('[role="menu"]', { timeout: 4000 }).catch(() => {});
const texto3 = await page.locator('[role="menu"]').first().innerText().catch(() => "");
ok(/tabla/i.test(texto3), "con una sola celda aparece la sección de tabla");

console.log("\n--- cursor de redimensionado ---");
await page.keyboard.press("Escape");
await reiniciar();

// El overlay es de punteros inertes, así que el puntero cae siempre en el
// textarea: el cursor de redimensionado lo pone el campo, guiado por el borde
// que hay justo debajo.
const cursorEn = (x, y) =>
  page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el ? getComputedStyle(el).cursor : "?";
    },
    [x, y],
  );

const asa = await page.locator('[data-resize-col="0"]').first().boundingBox();
ok(Boolean(asa), "el overlay dibuja el asa del borde entre columnas");

if (asa) {
  const bx = asa.x + asa.width / 2; // el centro del asa es el borde mismo
  const by = asa.y + 8;

  await page.mouse.move(bx, by);
  await page.waitForTimeout(250);
  ok(
    (await cursorEn(bx, by)) === "col-resize",
    "sobre el borde entre columnas el cursor es el de redimensionar",
  );

  const c0 = await celda0Ancho();
  await page.mouse.move(c0.x, c0.y);
  await page.waitForTimeout(250);
  ok(
    (await cursorEn(c0.x, c0.y)) !== "col-resize",
    "en el centro de la celda el cursor NO es de redimensionar",
  );

  // Se arrastra hacia la izquierda: la tabla auto ya llena la fila, así que
  // ensanchar no cabe (lo recorta el tope), pero encoger sí.
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx - 70, by + 30, { steps: 6 });
  ok(
    (await cursorEn(bx - 70, by + 30)) === "col-resize",
    "MIENTRAS se arrastra el cursor sigue en el de redimensionar",
  );
  await page.mouse.up();
  await page.waitForTimeout(300);

  const tras = await celda0Ancho();
  ok(
    tras.ancho < c0.ancho - 40,
    `el arrastre del borde estrecha la columna (${Math.round(c0.ancho)} → ${Math.round(tras.ancho)} px)`,
  );
}

/** Centro y anchura de la primera celda de la primera columna. */
async function celda0Ancho() {
  const box = await page.locator('[data-cell][data-col="0"]').first().boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, ancho: box.width };
}

await browser.close();

console.log(`\n${fallos.length === 0 ? "TODO EN VERDE" : `FALLOS: ${fallos.length}`}`);
process.exit(fallos.length === 0 ? 0 : 1);
