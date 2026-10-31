/**
 * Smoke test de la app completa con backend simulado (ver `app-smoke.tsx`):
 * abrir el vault, crear una nota, escribir y que llegue a disco, y crear una
 * tarea y comprobar que se envía al backend. El backend es falso: la tarea no
 * se guarda de verdad, solo se comprueba el contrato IPC. Requiere
 * `vite --port 5199` (ver `bench:app`).
 */
import { chromium } from "playwright-core";

const URL = "http://localhost:5199/bench/app-smoke.html";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
// La app sigue el idioma del navegador: el smoke test va en español.
const fallos = [];
const contexto = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "es-ES" });
const page = await contexto.newPage();

const ok = (cond, msg) => {
  console.log(`${cond ? "PASA" : "FALLA"}  ${msg}`);
  if (!cond) fallos.push(msg);
};

page.on("pageerror", (e) => console.log("  [excepción]", String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error" && /Content Security Policy|Refused/.test(m.text())) {
    fallos.push(`CSP: ${m.text().slice(0, 200)}`);
    console.log("  [CSP]", m.text().slice(0, 200));
  }
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Notas", exact: true }).first().waitFor({ timeout: 15000 });
ok(true, "la app arranca con el vault abierto");

await page.getByRole("button", { name: "Notas", exact: true }).first().click();
await page.locator('button[aria-label="Nueva nota"]').waitFor({ timeout: 8000 });

await page.locator('button[aria-label="Nueva nota"]').click();
await page.waitForFunction(() => window.__smoke.archivos.has("/vault/nueva-nota.md"), null, {
  timeout: 8000,
});
ok(true, "«Nueva nota» crea nueva-nota.md en el vault");

await page.locator("textarea").first().click();
await page.keyboard.press("Control+End");
await page.keyboard.type("Texto del smoke");
await page.waitForFunction(
  () => [...window.__smoke.archivos.values()].some((c) => c.includes("Texto del smoke")),
  null,
  { timeout: 8000 },
);
ok(true, "lo escrito en el editor llega al disco (autoguardado)");

// Mermaid dibuja un SVG con aria-roledescription; los iconos no lo llevan. Se
// dibuja en la vista previa, no en la edición en línea.
await page.keyboard.press("Control+End");
await page.keyboard.type("\n\n```mermaid\ngraph TD\nA-->B\n```\n\nfin del smoke\n");

// El corrector carga Hunspell en WebAssembly: su .wasm tiene que llegar.
await page.keyboard.type(" zzqxwv ");
await page.waitForFunction(
  () => performance.getEntriesByType("resource").some((r) => r.name.endsWith(".wasm")),
  null,
  { timeout: 15000 },
).then(
  () => ok(true, "el corrector carga su .wasm (Hunspell) bajo la CSP"),
  () => ok(false, "el corrector no llegó a cargar su .wasm"),
);

await page.locator('button[aria-label="Previsualizar la nota"]').click();
await page.locator("svg[aria-roledescription]").first().waitFor({ timeout: 15000 });
ok(true, "el bloque mermaid se dibuja en la vista previa (bajo la CSP)");

await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
await page.getByRole("button", { name: "Nueva tarea" }).click();
await page.getByPlaceholder("¿Qué hay que hacer?").fill("Tarea del smoke");
await page.getByRole("button", { name: "Crear tarea" }).click();
await page.waitForFunction(
  () => window.__smoke.llamadas.some(
    (c) => c.cmd === "publish_new_task" && c.args.task?.title === "Tarea del smoke",
  ),
  null,
  { timeout: 8000 },
);
ok(true, "«Crear tarea» envía el título al backend (publish_new_task)");

// Las violaciones de CSP se recogen arriba desde la consola. Esto solo confirma
// que la política de la página está puesta.
const hayCsp = await page.evaluate(
  () => document.querySelector('meta[http-equiv="Content-Security-Policy"]') !== null,
);
ok(hayCsp, "la página lleva la política de contenido (CSP)");

await page.getByRole("button", { name: "Notas", exact: true }).first().click();
await page.getByText("manual.pdf", { exact: true }).first().click();
await page.locator("canvas").first().waitFor({ timeout: 15000 });
ok(true, "el visor PDF pinta la página (worker de pdf.js bajo la CSP)");

// Subtareas (REQ-11): crear una desde el panel de relaciones de una tarea.
await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
await page.getByRole("tab", { name: "Lista" }).click();
await page.getByRole("button", { name: "Subtareas y dependencias de «Tarea base»" }).click();
await page.getByLabel("Nueva subtarea de «Tarea base»").fill("Paso uno");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => window.__smoke.llamadas.some(
    (c) => c.cmd === "save_tasks" && c.args.tasks?.some((t) => t.title === "Paso uno" && t.parentId === "base"),
  ),
  null,
  { timeout: 8000 },
);
ok(true, "una subtarea se guarda con su parentId (save_tasks)");

// Checkboxes de las notas en la lista de tareas (REQ-09).
await page.getByRole("button", { name: "Tareas", exact: true }).first().click();
await page.getByRole("tab", { name: "Notas" }).click();
await page.getByText("comprar pan").waitFor({ timeout: 8000 });
await page.getByText("comprar pan").click();
await page.waitForFunction(
  () => window.__smoke.archivos.get("/vault/pendientes.md")?.includes("- [x] comprar pan"),
  null,
  { timeout: 8000 },
);
ok(true, "marcar un checkbox en la lista de tareas lo reescribe en su nota");

// Pizarras: crear una, dibujar un rectángulo, poner un post-it con texto y deshacer.

await page.getByRole("button", { name: "Pizarras", exact: true }).first().click();
await page.getByRole("button", { name: "Nueva pizarra" }).click();
const lienzo = page.locator("svg[aria-label='Pizarra sin título']");
await lienzo.waitFor({ timeout: 8000 });
const caja = await lienzo.boundingBox();
await page.getByRole("button", { name: "Rectángulo" }).click();
await page.mouse.move(caja.x + 200, caja.y + 150);
await page.mouse.down();
await page.mouse.move(caja.x + 380, caja.y + 260, { steps: 6 });
await page.mouse.up();
await page.getByRole("button", { name: "Post-it" }).click();
await page.mouse.click(caja.x + 600, caja.y + 300);
await page.getByLabel("Editar texto").fill("Idea del smoke");
await page.keyboard.press("Escape");
await page.waitForFunction(
  (fn) => {
    const lista = [...window.__smoke.pizarras.values()].map((json) => JSON.parse(json).elements ?? []);
    return lista.some((els) => els.length === 2 && els.some((e) => e.type === "rect") && els.some((e) => e.type === "note" && e.text === "Idea del smoke"));
  },
  null,
  { timeout: 8000 },
);
ok(true, "dibujar un rectángulo y un post-it con texto se guarda en la pizarra (save_board)");
await page.getByRole("button", { name: "Deshacer" }).click();
await page.waitForFunction(
  () => [...window.__smoke.pizarras.values()].some((json) => (JSON.parse(json).elements ?? []).length === 1),
  null,
  { timeout: 8000 },
);
ok(true, "deshacer quita el último elemento de la pizarra");

// Con el zoom de interfaz activo, lo dibujado debe quedar bajo el cursor (no desplazado).
for (const zoom of [1.5, 0.8]) {
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z);
    document.documentElement.style.setProperty("--gus-zoom", String(z));
  }, zoom);
  const area = await lienzo.boundingBox();
  const [x1, y1, x2, y2] = [area.x + 120, area.y + 100, area.x + 300, area.y + 200];
  await page.getByRole("button", { name: "Elipse", exact: true }).click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 5 });
  await page.mouse.up();
  const dibujado = await page.evaluate(() => {
    const el = [...document.querySelectorAll("svg[aria-label] ellipse")].pop().getBoundingClientRect();
    return [el.left, el.top, el.right, el.bottom];
  });
  const cerca = [x1, y1, x2, y2].every((v, i) => Math.abs(v - dibujado[i]) < 4);
  ok(cerca, `con zoom de interfaz ${zoom * 100}% la elipse queda bajo el cursor`);
}
await page.evaluate(() => {
  document.documentElement.style.zoom = "1";
  document.documentElement.style.setProperty("--gus-zoom", "1");
});

// Hábitos: crear uno y marcar hoy.
await page.getByRole("button", { name: "Hábitos", exact: true }).first().click();
await page.getByRole("button", { name: "Nuevo hábito" }).click();
await page.getByLabel("Hábito", { exact: true }).fill("Leer 20 minutos");
await page.getByRole("button", { name: "Guardar" }).click();
await page.getByText("Leer 20 minutos").waitFor({ timeout: 8000 });
await page.getByRole("checkbox", { name: /Leer 20 minutos/ }).check({ force: true });
await page.waitForFunction(
  () => window.__smoke.llamadas.some(
    (c) => c.cmd === "save_habits" && Object.values(c.args.store?.log ?? {}).some((days) => days.length === 1),
  ),
  null,
  { timeout: 8000 },
);
ok(true, "crear un hábito y marcar hoy se guarda en el backend (save_habits)");

// Biblioteca de PDF: portada con pdf.js, estantería nueva y asignación.
await page.getByRole("button", { name: "Biblioteca", exact: true }).first().click();
await page.locator('li img[src^="data:image/jpeg"]').first().waitFor({ timeout: 15000 });
ok(true, "la biblioteca pinta la portada del PDF (pdf.js + canvas bajo la CSP)");

await page.getByRole("button", { name: "Nueva estantería" }).click();
await page.getByPlaceholder("Nombre de la estantería").fill("Clases");
await page.keyboard.press("Enter");
await page.getByRole("button", { name: /^Todos/ }).click();
await page.getByLabel("Estantería de manual.pdf").selectOption("Clases");
await page.waitForFunction(
  () => window.__smoke.llamadas.some(
    (c) => c.cmd === "save_library" && c.args.store?.assign?.["manual.pdf"] === "Clases",
  ),
  null,
  { timeout: 8000 },
);
ok(true, "asignar un PDF a una estantería se guarda en el backend (save_library)");

await page.locator("li button", { hasText: "manual" }).first().click();
await page.locator("canvas").first().waitFor({ timeout: 15000 });
ok(true, "abrir una tarjeta de la biblioteca muestra el PDF en el visor");

await browser.close();
console.log(fallos.length === 0 ? "\nTODO EN VERDE" : `\n${fallos.length} fallo(s)`);
process.exit(fallos.length === 0 ? 0 : 1);
