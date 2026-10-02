// Prueba de la inserción de imágenes en el editor, con Tauri simulado.
//
//   npx vite --port 5199 --strictPort
//   node bench/prueba-imagenes.mjs
//
// Cubre las tres vías: el menú «/» → imagen del vault (con buscador y
// miniaturas), el menú «/» → imagen del equipo (diálogo simulado) y el
// arrastre de archivos sobre el editor, además de la vista de lectura.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const EXECUTABLE = "/home/korossuh/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";
const BANCO_URL = "http://localhost:5199/bench/index.html";

// PNG real de 128×128 (el icono de la app): con dimensiones de verdad se puede
// comprobar que en el modo edición la imagen ocupa su tamaño y no una tira.
const IMG1 = `data:image/png;base64,${readFileSync(
  new URL("../src-tauri/icons/128x128.png", import.meta.url),
).toString("base64")}`;

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

await page.goto(BANCO_URL);
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

const avisoSelector = await page.evaluate(() =>
  [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "").join(" | "),
);
chequeo(
  "avisa «Se insertó 1 imagen» al elegir del selector",
  avisoSelector.includes("Se insertó 1 imagen"),
  avisoSelector,
);

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

const avisoDrop = await page.evaluate(() =>
  [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? "").join(" | "),
);
chequeo(
  "avisa «Se insertó 1 imagen» al soltar del explorador",
  avisoDrop.includes("Se insertó 1 imagen"),
  avisoDrop,
);

console.log("· modo edición: la imagen a tamaño real");
// Cursor al principio con un clic real (un evento «select» sintético no arrastra
// el estado de React): la línea de la imagen deja de ser la del cursor y el
// overlay debe pintar la imagen completa.
const puntoInicial = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  const primera = [...overlay.children].find((el) => el.tagName === "DIV");
  const r = primera.getBoundingClientRect();
  return { x: r.left + 120, y: r.top + 8 };
});
await page.mouse.click(puntoInicial.x, puntoInicial.y);
await page.waitForTimeout(700);

const edicion = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  if (!overlay) return { overlay: false };
  const lineas = [...overlay.children].filter((el) => el.tagName === "DIV");
  const fila = lineas.findIndex((el) => el.matches("[data-drift-line]"));
  if (fila < 0) return { overlay: true, fila: -1 };
  const linea = lineas[fila];
  const img = linea.querySelector("img");
  const rowH = parseFloat(getComputedStyle(overlay).getPropertyValue("--gus-row-h"));
  const alto = linea.getBoundingClientRect().height;
  const sig = lineas[fila + 1]?.getBoundingClientRect() ?? null;
  return {
    overlay: true,
    rowH,
    alto: Math.round(alto),
    multipoDeFila: Math.abs(alto - Math.round(alto / rowH) * rowH) <= 1,
    imgAlto: img ? Math.round(img.getBoundingClientRect().height) : 0,
    imgCargada: img ? img.naturalWidth > 0 && img.src.startsWith("data:image/png") : false,
    hueco: sig ? Math.round(sig.top - linea.getBoundingClientRect().bottom) : null,
  };
});
chequeo(
  "en modo edición la imagen se pinta a tamaño real",
  edicion.overlay && edicion.imgCargada && edicion.imgAlto >= 100,
  JSON.stringify(edicion),
);
chequeo(
  "la línea ocupa sus filas y la de debajo sigue pegada",
  edicion.alto > edicion.rowH * 2 && edicion.multipoDeFila && Math.abs(edicion.hueco ?? 99) <= 1,
  `alto=${edicion.alto} fila=${edicion.rowH} hueco=${edicion.hueco}`,
);
await page.screenshot({ path: "/tmp/opencode/edicion.png" });

// Sobre la imagen: su línea lleva el cursor, el markdown se pinta arriba para
// poder editarlo y la imagen sigue debajo (la línea crece una fila).
const puntoImagen = await page.evaluate(() => {
  const linea = document.querySelector("[data-drift-line]");
  const r = linea.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + (r.height * 3) / 4 };
});
await page.mouse.click(puntoImagen.x, puntoImagen.y);
await page.waitForTimeout(400);
const conCursor = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  const area = document.querySelector("textarea");
  const linea = overlay.querySelector("[data-drift-line]");
  const pintado = [...linea.children].find((h) => h.className.includes("absolute"));
  const lineas = area.value.split("\n");
  const cursorLinea = area.value.slice(0, area.selectionStart).split("\n").length - 1;
  const rowH = parseFloat(getComputedStyle(overlay).getPropertyValue("--gus-row-h"));
  return {
    cursorLinea,
    cursorEnImagen: (lineas[cursorLinea] ?? "").includes("![Aventura]"),
    crudoVisible: pintado ? pintado.innerText.includes("![Aventura]") : false,
    imgs: linea.querySelectorAll("img").length,
    filas: linea.getBoundingClientRect().height / rowH,
  };
});
chequeo(
  "al pulsar la imagen se ve su markdown arriba y la imagen debajo",
  conCursor.cursorEnImagen &&
    conCursor.crudoVisible &&
    conCursor.imgs >= 1 &&
    conCursor.filas >= 7,
  JSON.stringify({ ...conCursor, filas: Math.round(conCursor.filas * 10) / 10 }),
);

console.log("· compensación de la imagen crecida (clic, arrastre y scroll)");
// Clic sobre la línea que viene justo debajo de la imagen: el textarea cree
// que esa línea está N filas más arriba, así que tiene que mandar el drift.
const puntoClic = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  const lineas = [...overlay.children].filter((el) => el.tagName === "DIV");
  const fila = lineas.findIndex((el) => el.matches("[data-drift-line]"));
  const r = lineas[fila + 1].getBoundingClientRect();
  return { x: r.left + 60, y: r.top + r.height / 2 };
});
const lineaEsperada = await page.evaluate(() => {
  const el = document.querySelector("textarea");
  return el.value.split("\n").findIndex((texto) => texto.includes("![Aventura]")) + 1;
});
await page.mouse.click(puntoClic.x, puntoClic.y);
await page.waitForTimeout(300);
const trasClic = await page.evaluate(() => {
  const el = document.querySelector("textarea");
  const antes = el.value.slice(0, el.selectionStart);
  return antes.split("\n").length - 1;
});
chequeo(
  "el clic bajo la imagen cae en su línea, no en una anterior",
  trasClic === lineaEsperada,
  `línea ${trasClic}, se esperaba ${lineaEsperada}`,
);

// El motor no arrastra con la geometría del overlay (se le canceló su clic):
// mientras el botón sigue bajo, la selección la lleva el editor. El punto se
// vuelve a medir: al irse el cursor de la imagen, su línea encoge una fila y
// lo que queda debajo sube.
const puntoArrastre = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  const lineas = [...overlay.children].filter((el) => el.tagName === "DIV");
  const fila = lineas.findIndex((el) => el.matches("[data-drift-line]"));
  const r = lineas[fila + 1].getBoundingClientRect();
  return { x: r.left + 60, y: r.top + r.height / 2 };
});
await page.mouse.move(puntoArrastre.x, puntoArrastre.y);
await page.mouse.down();
await page.mouse.move(puntoArrastre.x, puntoArrastre.y + edicion.rowH, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const trasArrastre = await page.evaluate(() => {
  const el = document.querySelector("textarea");
  const value = el.value;
  const total = value.split("\n").length;
  return {
    inicio: value.slice(0, el.selectionStart).split("\n").length - 1,
    fin: total - value.slice(el.selectionEnd).split("\n").length,
    seleccion: el.selectionEnd - el.selectionStart,
  };
});
chequeo(
  "el arrastre bajo la imagen selecciona hasta la línea de destino",
  trasArrastre.inicio === lineaEsperada &&
    trasArrastre.fin === lineaEsperada + 1 &&
    trasArrastre.seleccion > 0,
  `${JSON.stringify(trasArrastre)}; se esperaba desde la línea ${lineaEsperada}`,
);

// El editor tiene que tener scroll para probarlo: se alarga la nota.
await area();
await page.keyboard.type("\n".repeat(60));
await page.waitForTimeout(400);
await page.evaluate(() => {
  const el = document.querySelector("textarea");
  el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(500);
const alFondo = await page.evaluate(() => {
  const overlay = document.querySelector(".gus-source-overlay");
  const lineas = [...overlay.children].filter((el) => el.tagName === "DIV");
  const ultima = lineas[lineas.length - 1];
  return {
    // Hueco entre el borde inferior del overlay y la última línea: con el
    // scroll compensado es solo su relleno (16 px); si no llegara, es negativo.
    hueco: Math.round(overlay.getBoundingClientRect().bottom - ultima.getBoundingClientRect().bottom),
    scrollArea: document.querySelector("textarea").scrollTop,
    scrollOverlay: overlay.scrollTop,
  };
});
chequeo(
  "al llegar al fondo, el overlay también llega",
  alFondo.hueco >= -1 && alFondo.hueco <= 30 && alFondo.scrollOverlay > 0,
  JSON.stringify(alFondo),
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
