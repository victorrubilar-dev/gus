// Prueba de la inserción de imágenes en el editor, con Tauri simulado.
//
//   npx vite --port 5199 --strictPort
//   node bench/prueba-imagenes.mjs
//
// Cubre las tres vías: el menú «/» → imagen del vault (con buscador y
// miniaturas), el menú «/» → imagen del equipo (diálogo simulado) y el
// arrastre de archivos sobre el editor, además de la vista de lectura.
import { chromium } from "playwright-core";

const EXECUTABLE = "/home/korossuh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const URL = "http://localhost:5199/bench/index.html";

// PNG de 1×1 px con un píxel rojo: vale como miniatura y como imagen real.
const IMG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let fallos = 0;
let total = 0;
function chequeo(nombre, ok, detalle = "") {
  total += 1;
  if (ok) console.log(`  ok   ${nombre}`);
  else {
    fallos += 1;
    console.log(`  FALLO ${nombre}${detalle ? ` — ${detalle}` : ""}`);
  }
}

const navegador = await chromium.launch({ executablePath: EXECUTABLE });
const contexto = await navegador.newContext();
const page = await contexto.newPage();
page.on("pageerror", (err) => console.log(`  [error de página] ${err.message}\n${err.stack ?? ""}`));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`  [consola] ${msg.text()}`);
});

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => cb,
    metadata: { currentWindow: { label: "gus" }, currentWebview: { label: "gus" } },
    invoke: (cmd, args) => window.__MANEJADOR(cmd, args),
  };
  window.__TAURI_ASSETS__ = { convertFileSrc: (p) => `asset:///${p}` };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
});

// El stub completo: se inyecta desde Node porque necesita los datos del vault.
await page.addInitScript(
  ([img1]) => {
    const fsPath = (p) => p;
    const vault = new Map([
      [fsPath("/tmp/vault/Aventura.png"), img1],
      [fsPath("/tmp/vault/sub.png"), img1],
    ]);
    const equipo = new Map([[fsPath("/tmp/equipo.png"), img1]]);
    window.__invocaciones = [];
    window.__escrituras = [];

    window.__MANEJADOR = (cmd, args) => {
      window.__invocaciones.push([cmd, args]);
      switch (cmd) {
        case "list_vault_images":
          return Promise.resolve(
            [...vault.keys()].map((p) => ({
              name: p.slice(p.lastIndexOf("/") + 1),
              path: p,
              relative: p.slice(fsPath("/tmp/vault/").length),
              modified_ms: null,
            })),
          );
        case "read_vault_image":
        case "read_vault_image_thumb": {
          // En el banco no hay disco: cualquier PNG bajo el vault «existe».
          const dato =
            vault.get(args.path) ?? (typeof args.path === "string" && args.path.endsWith(".png") ? img1 : null);
          return dato
            ? Promise.resolve(dato)
            : Promise.reject(new Error(`No existe el archivo «${args.path}»`));
        }
        case "import_files_to_vault": {
          const creados = [];
          for (const src of args.sources) {
            const base = src.slice(src.lastIndexOf("/") + 1);
            const dentro = fsPath(`/tmp/vault/${base}`);
            vault.set(dentro, equipo.get(src) ?? img1);
            window.__escrituras.push(dentro);
            creados.push({ source: src, path: dentro, error: null });
          }
          return Promise.resolve(creados);
        }
        case "rename_vault_file":
          return Promise.resolve(args.to);
        case "write_vault_file":
          window.__escrituras.push(args.path);
          return Promise.resolve(args.path);
        case "read_vault_file":
          return Promise.resolve("");
        case "write_vault_file_sync":
          window.__escrituras.push(args.path);
          return Promise.resolve();
        case "list_vault_tags":
          return Promise.resolve([]);
        case "plugin:dialog|open":
          return Promise.resolve([fsPath("/tmp/equipo.png")]);
        case "plugin:opener|open_url":
        case "plugin:opener|open_path":
          return Promise.resolve();
        default:
          return Promise.resolve(null);
      }
    };
  },
  [IMG1],
);

await page.goto(URL);
const montado = await page
  .waitForSelector("textarea", { timeout: 15000 })
  .then(() => true)
  .catch(() => false);
if (!montado) {
  await page.screenshot({ path: "/tmp/opencode/diag-imagenes.png", fullPage: true });
  console.log("  [diagnóstico] el editor no montó; texto en pantalla:");
  console.log(
    (await page.evaluate(() => document.body.innerText).catch(() => "(sin cuerpo)"))
      .split("\n")
      .slice(0, 40)
      .join("\n"),
  );
  await navegador.close();
  process.exit(1);
}
await page.waitForTimeout(400);

const area = async () =>
  page.evaluate(() => {
    const el = document.querySelector("textarea");
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    return el.value;
  });

/** Escribe con el cursor ya colocado (lo coloca `area`). */
const teclear = async (texto) => {
  await area();
  for (const ch of texto) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(12);
  }
  await page.waitForTimeout(120);
};

const textoListbox = async () =>
  page.$eval("[role='listbox']", (el) => el.innerText).catch(() => "");

console.log("· menú «/» y selector de imágenes");
await page.locator("textarea").click();
await teclear("\n/ima");

let listbox = await textoListbox();
chequeo(
  "«/ima» ofrece «Imagen» e «Imagen del equipo»",
  listbox.includes("Imagen") && listbox.includes("Imagen del equipo"),
  listbox.replaceAll("\n", " | "),
);

await page.keyboard.press("Enter");
await page.waitForTimeout(1200);

const etiquetasAbiertas = await page.$$eval("[role='option']", (els) =>
  els.map((el) => el.textContent?.trim() ?? ""),
);
const labelSelector = await page.$eval("[role='listbox']", (el) =>
  el.getAttribute("aria-label") ?? "",
).catch(() => "");
chequeo(
  "el selector se abre con su buscador",
  labelSelector.includes("Imágenes del vault"),
  labelSelector,
);
chequeo(
  "lista las imágenes del vault con miniatura",
  etiquetasAbiertas.length >= 2 && etiquetasAbiertas.some((t) => t.includes("Aventura.png")),
  etiquetasAbiertas.join(" | "),
);

const miniaturas = await page.$$eval("[role='option'] img", (els) =>
  els.filter((el) => el.src.startsWith("data:image/png")).length,
);
chequeo("pinta miniaturas de las imágenes", miniaturas >= 2, `${miniaturas}`);

let valor = await page.$eval("textarea", (el) => el.value);
chequeo(
  "la consulta espera en el documento mientras se elige",
  valor.includes("/ima"),
  valor.slice(-40),
);

await page.keyboard.type("fot");
await page.waitForTimeout(300);
let hayAviso = await page.evaluate(() =>
  [...document.querySelectorAll("p, li, span")].some((el) =>
    (el.textContent ?? "").includes("Ninguna imagen coincide"),
  ),
);
chequeo("«fot» no encuentra ninguna imagen", hayAviso);

await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);

console.log("· inserción de una imagen del vault");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
valor = await page.$eval("textarea", (el) => el.value);
chequeo(
  "inserta el enlace relativo a la nota",
  valor.includes("![Aventura](vault/Aventura.png)"),
  valor.slice(-80),
);
chequeo("no deja restos de la consulta", !valor.includes("/ima") && !valor.includes("ima]"), valor.slice(-80));

console.log("· regresión: la consulta no se queda pegada");
await teclear("\n/cita");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
valor = await page.$eval("textarea", (el) => el.value);
chequeo(
  "al insertar un ítem del «/» desaparece su consulta",
  !valor.includes("/cita") && valor.includes("> "),
  valor.slice(-60),
);

console.log("· imagen del equipo desde el menú «/»");
await page.evaluate(() => {
  const el = document.querySelector("textarea");
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
});
await teclear("\n/equipo");
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
valor = await page.$eval("textarea", (el) => el.value);
chequeo(
  "copia el archivo junto a la nota y lo enlaza",
  valor.includes("![equipo](vault/equipo.png)"),
  valor.slice(-90),
);

const textoAviso = await page.evaluate(() => document.body.innerText);
chequeo(
  "la nota se guarda sin avisos de error",
  !textoAviso.includes("TypeError") && !textoAviso.includes("No se pudo guardar"),
  textoAviso.slice(0, 200).replaceAll("\n", " | "),
);

console.log("· arrastre desde el explorador sobre el editor");
const arriba = await page.evaluate(() => {
  const r = document.querySelector("textarea").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
const dt = await page.evaluateHandle(
  ({ x, y }) => {
    const dt = new DataTransfer();
    dt.setData(
      "application/x-gus-explorer-entry",
      JSON.stringify({ kind: "file", path: "/tmp/vault/foto2.png" }),
    );
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return dt;
  },
  arriba,
);
chequeo(
  "el editor se marca como zona de soltar",
  await page.evaluate(() => {
    const el = document.querySelector("textarea");
    return el.className.includes("ring-gus-accent");
  }),
);

await page.evaluate(
  ({ x, y, dt }) => {
    const target = document.elementFromPoint(x, y);
    target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  },
  { ...arriba, dt },
);
await page.waitForTimeout(600);
valor = await page.$eval("textarea", (el) => el.value);
chequeo(
  "el arrastre enlaza la imagen del explorador",
  valor.includes("![foto2](vault/foto2.png)"),
  valor.slice(-90),
);
chequeo(
  "el anillo de soltar desaparece",
  !(await page.evaluate(() => document.querySelector("textarea").className.includes("ring-gus-accent"))),
);

console.log("· vista de lectura");
const lectura = await page.evaluate(() =>
  [...document.querySelectorAll("button")].some((b) =>
    (b.getAttribute("aria-label") ?? "").toLowerCase().includes("previsualizar"),
  ),
);
chequeo("hay botón de vista de lectura", lectura);
if (lectura) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") ?? "").toLowerCase().includes("previsualizar"),
    );
    btn.click();
  });
  await page.waitForTimeout(1500);
  const vistas = await page.$$eval("img", (els) =>
    els
      .filter((el) => el.alt)
      .map((el) => ({ alt: el.getAttribute("alt"), w: el.naturalWidth, rota: el.src === "" })),
  );
  chequeo(
    "las imágenes se ven en la vista de lectura",
    vistas.length >= 3 && vistas.every((v) => v.w > 0 && !v.rota),
    JSON.stringify(vistas),
  );
  if (vistas.length === 0) {
    console.log(
      "    [detalle] aviso de imagen rota:",
      await page.evaluate(() =>
        [...document.querySelectorAll("span")]
          .map((el) => el.textContent ?? "")
          .filter((txt) => txt.includes("imagen"))
          .join(" | "),
      ),
    );
  }
  await page.screenshot({ path: "/tmp/opencode/imagenes.png" });
}

console.log("· invocaciones a Tauri");
const inv = await page.evaluate(() => window.__invocaciones.map(([c]) => c));
chequeo("listó las imágenes del vault", inv.includes("list_vault_images"));
chequeo("generó miniaturas", inv.includes("read_vault_image_thumb"));
chequeo("leyó la imagen completa", inv.includes("read_vault_image"));
chequeo("copió el archivo del equipo", inv.includes("import_files_to_vault"));
chequeo("abrió el diálogo del sistema", inv.includes("plugin:dialog|open"));
const escrituras = await page.evaluate(() => window.__escrituras);
chequeo("guardó la nota con los enlaces", escrituras.length > 0, JSON.stringify(escrituras));

if (fallos > 0) {
  const detalle = await page.evaluate(() =>
    window.__invocaciones.map(([cmd, args]) => `${cmd} ${JSON.stringify(args)}`),
  );
  console.log("  [detalle de invocaciones]");
  for (const linea of detalle) console.log(`    ${linea.slice(0, 160)}`);
}

console.log(`\n${total - fallos}/${total} comprobaciones correctas`);
await navegador.close();
process.exit(fallos === 0 ? 0 : 1);
