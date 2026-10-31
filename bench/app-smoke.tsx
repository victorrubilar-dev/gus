import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App";
import "../src/App.css";

/**
 * Banco de la app completa, sin Tauri: `__TAURI_INTERNALS__` finge el backend
 * con un vault en memoria. Lo que se escribe o se crea queda en `window.__smoke`
 * para que el smoke test (`bench/prueba-app.mjs`) compruebe que llegó al «disco».
 */
interface Entrada {
  name: string;
  path: string;
  is_dir: boolean;
  modified_ms: number | null;
}

const ahora = 1_700_000_000_000;
const PDF_DE_PRUEBA = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAyMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCA+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMjAgMTAwIFRkIChIb2xhIFBERikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA1IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgozMDgKJSVFT0YK";
const archivos = new Map<string, string>([
  ["/vault/bienvenida.md", "# Bienvenida\n"],
  ["/vault/manual.pdf", ""],
]);
/** Sin `?semilla`: una nota con un checkbox para el smoke test de la lista de tareas. */
if (!location.search.includes("semilla")) {
  archivos.set("/vault/pendientes.md", "# Pendientes\n\n- [ ] comprar pan\n");
}
/** `?tema=<clave>` fija el tema de la configuración simulada (ver `bench/capturas.mjs`). */
const tema = new URLSearchParams(location.search).get("tema");
const llamadas: { cmd: string; args: Record<string, unknown> }[] = [];
const tareas: unknown[] = location.search.includes("semilla")
  ? []
  : [{ id: "base", title: "Tarea base", tags: [], completes: false }];
const pizarras = new Map<string, string>();
/** Cada `save_app_config` que recibe el backend, para comprobar vaults y último abierto. */
const configGuardada: unknown[] = [];
const habitos: { habits: unknown[]; log: Record<string, string[]> } = { habits: [], log: {} };
const biblioteca: { shelves: string[]; assign: Record<string, string> } = { shelves: [], assign: {} };

/**
 * Con `?semilla` el vault trae contenido de verdad (notas largas con etiquetas,
 * tablas y código; tareas con fechas, prioridades y etiquetas) para las capturas
 * de `bench/capturas.mjs`. Sin ella el smoke test parte de un vault casi vacío.
 */
if (location.search.includes("semilla")) {
  // Fecha local, como la usa la app: con UTC las capturas cambiaban según la hora del día.
  const dia = (n: number) => {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() + n);
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
  };
  archivos.set(
    "/vault/bienvenida.md",
    "# Bienvenida\n\nEste vault guarda **notas** y *tareas* personales. Ver [[proyecto-gus]] y [[lecturas]].\n\n## Para empezar\n\n- Crear una nota con `Ctrl+N`\n- Buscar con `Ctrl+K`\n- [ ] Revisar el plan semanal #planes\n- [x] Leer el manual\n\n> Una cita larga para ver cómo se parte el texto cuando la línea no cabe en el ancho disponible del editor.\n\n| Vista | Atajo |\n| --- | --- |\n| Notas | Ctrl+1 |\n| Tareas | Ctrl+2 |\n\n```ts\nconst gus = { local: true, nube: false };\n```\n",
  );
  archivos.set("/vault/proyecto-gus.md", "# Proyecto Gus #desarrollo #diseño\n\nNotas del re-diseño. Volver a [[bienvenida]].\n");
  archivos.set("/vault/lecturas.md", "# Lecturas #libros\n\nLista de lecturas pendientes con [[proyecto-gus]].\n");
  archivos.set("/vault/diario/2026-10-28.md", "# Martes\n\nDía tranquilo. #diario\n");
  archivos.set("/vault/diario/2026-10-29.md", "# Jueves\n\nRevisión de tipografías. #diario #diseño\n");
  tareas.push(
    { id: "t1", title: "Revisar el contraste de los siete temas", tags: ["diseño"], completes: false, due: dia(-2), priority: "urgente" },
    { id: "t2", title: "Escribir las notas de la versión 0.1.6", tags: ["desarrollo", "docs"], completes: false, due: dia(0), priority: "alta", description: "Resumen de cambios visibles para el usuario." },
    { id: "t3", title: "Probar la descarga del instalador en Fedora", tags: ["desarrollo"], completes: false, due: dia(3), priority: "media", doing: true },
    { id: "t4", title: "Ordenar la carpeta de lecturas", tags: ["libros"], completes: false, due: dia(9), priority: "baja" },
    { id: "t5", title: "Tarea con un título bastante largo para comprobar que el texto se parte bien dentro de la tarjeta del tablero", tags: ["diseño", "planes", "docs"], completes: false, doing: true },
    { id: "t6", title: "Publicar el borrador de la release", tags: ["desarrollo"], completes: true, due: dia(-5), priority: "media" },
  );
}

/** Carpetas vacías (el mapa de archivos solo conoce carpetas que tienen algo dentro). */
const carpetas = new Set<string>();

/** Cambia el prefijo de ruta de todo lo que cuelga de `de` (renombrar y mover). */
function moverRuta(de: string, a: string) {
  for (const [ruta, texto] of [...archivos]) {
    if (ruta === de || ruta.startsWith(`${de}/`)) {
      archivos.delete(ruta);
      archivos.set(a + ruta.slice(de.length), texto);
    }
  }
  for (const ruta of [...carpetas]) {
    if (ruta === de || ruta.startsWith(`${de}/`)) {
      carpetas.delete(ruta);
      carpetas.add(a + ruta.slice(de.length));
    }
  }
}

/** Entradas directas de `dir`, como las da `list_vault_entries`. */
function entradasDe(dir: string): Entrada[] {
  const prefijo = `${dir.replace(/\/$/, "")}/`;
  const vistas = new Map<string, Entrada>();
  for (const ruta of carpetas) {
    if (!ruta.startsWith(prefijo)) continue;
    const primero = ruta.slice(prefijo.length).split("/")[0];
    vistas.set(prefijo + primero, { name: primero, path: prefijo + primero, is_dir: true, modified_ms: ahora });
  }
  for (const ruta of archivos.keys()) {
    if (!ruta.startsWith(prefijo)) continue;
    const [primero, ...resto] = ruta.slice(prefijo.length).split("/");
    const path = prefijo + primero;
    if (!vistas.has(path)) {
      vistas.set(path, { name: primero, path, is_dir: resto.length > 0, modified_ms: ahora });
    }
  }
  return [...vistas.values()];
}

/** Callbacks que la app registra con `transformCallback` (los usan los canales del plugin). */
const callbacks = new Map<number, (message: unknown) => void>();
let siguienteCallback = 1;
/** Con `?autoupdate` se simula una versión firmada nueva y una descarga que el test libera a mano. */
const autoupdate = location.search.includes("autoupdate");
let terminarDescarga: () => void = () => {};

/** Oyentes de eventos de Tauri: nombre → id del callback (el test los dispara con `emitir`). */
const oyentes = new Map<string, number>();

const respuestas: Record<string, (args: Record<string, unknown>) => unknown> = {
  "plugin:event|listen": (args) => {
    oyentes.set(String(args.event), Number(args.handler));
    return Number(args.handler);
  },
  "plugin:event|unlisten": () => null,
  import_files_to_vault: (args) =>
    (args.sources as string[]).map((source) => {
      const destino = `${String(args.destDir).replace(/\/$/, "")}/${source.split("/").pop()}`;
      archivos.set(destino, "");
      return { source, path: destino, error: null };
    }),
  can_self_update: () => autoupdate,
  "plugin:updater|check": () =>
    autoupdate ? { rid: 1, currentVersion: "0.2.0", version: "9.9.9", date: null, body: "", rawJson: {} } : null,
  "plugin:updater|download": async (args) => {
    // Los mensajes del canal llevan un índice para conservar el orden.
    const enviar = (index: number, message: unknown) =>
      callbacks.get((args.onEvent as { id: number }).id)?.({ index, message });
    enviar(0, { event: "Started", data: { contentLength: 1000 } });
    enviar(1, { event: "Progress", data: { chunkLength: 400 } });
    await new Promise<void>((resolver) => {
      terminarDescarga = resolver;
    });
    enviar(2, { event: "Progress", data: { chunkLength: 600 } });
    enviar(3, { event: "Finished" });
    return 2;
  },
  "plugin:updater|install": () => null,
  "plugin:process|restart": () => null,
  load_app_config: () => ({
    baseDir: "/vaults",
    vaults: [{ name: "Demo", path: "/vault" }],
    lastVault: "/vault",
    settings: { openLastVault: true, ...(tema ? { theme: tema } : {}) },
  }),
  vault_dir_exists: () => true,
  list_vault_entries: (args) => entradasDe(String(args.path)),
  read_vault_file: (args) => archivos.get(String(args.path)) ?? "",
  write_vault_file: (args) => {
    archivos.set(String(args.path), String(args.content));
    return null;
  },
  create_vault_file: (args) => {
    archivos.set(String(args.path), String(args.content));
    return args.path;
  },
  create_vault_dir: (args) => {
    carpetas.add(String(args.path));
    return args.path;
  },
  rename_vault_file: (args) => {
    moverRuta(String(args.from), String(args.to));
    return args.to;
  },
  rename_vault_dir: (args) => {
    moverRuta(String(args.from), String(args.to));
    return args.to;
  },
  move_vault_file: (args) => {
    const destino = `${String(args.toDir)}/${String(args.from).split("/").pop()}`;
    moverRuta(String(args.from), destino);
    return destino;
  },
  move_to_trash: (args) => {
    const ruta = String(args.path);
    for (const clave of [...archivos.keys()]) if (clave === ruta || clave.startsWith(`${ruta}/`)) archivos.delete(clave);
    for (const clave of [...carpetas]) if (clave === ruta || clave.startsWith(`${ruta}/`)) carpetas.delete(clave);
    return null;
  },
  list_vault_dirs: () => {
    const dirs = new Set<string>(carpetas);
    for (const ruta of archivos.keys()) {
      const partes = ruta.replace("/vault/", "").split("/");
      for (let i = 1; i < partes.length; i++) dirs.add(`/vault/${partes.slice(0, i).join("/")}`);
    }
    return [...dirs].map((path) => ({ path, relative: path.replace("/vault/", "") }));
  },
  read_vault_pdf: () => PDF_DE_PRUEBA,
  list_notes_with_checkboxes: () =>
    [...archivos.entries()]
      .filter(([ruta, texto]) => ruta.endsWith(".md") && /^\s*- \[[ xX]\]/m.test(texto))
      .map(([path, text]) => ({
        name: path.split("/").pop() as string,
        path,
        relative: path.replace("/vault/", ""),
        text,
      })),
  list_vault_pdfs: () => [
    { name: "manual.pdf", path: "/vault/manual.pdf", relative: "manual.pdf", modified_ms: ahora },
  ],
  list_boards: () =>
    [...pizarras.entries()].map(([id, json]) => ({ id, name: JSON.parse(json).name, modifiedMs: ahora })),
  load_board: (args) => pizarras.get(String(args.id)) ?? "{}",
  save_board: (args) => {
    pizarras.set(String(args.id), String(args.json));
    return null;
  },
  load_habits: () => habitos,
  save_habits: (args) => {
    Object.assign(habitos, args.store as object);
    return null;
  },
  load_library: () => biblioteca,
  save_library: (args) => {
    Object.assign(biblioteca, args.store as object);
    return null;
  },
  load_tasks: () => tareas,
  save_tasks: (args) => {
    tareas.splice(0, tareas.length, ...(args.tasks as unknown[]));
    return null;
  },
  build_link_graph: () => ({
    generatedMs: ahora,
    nodes: [...archivos.keys()]
      .filter((ruta) => ruta.endsWith(".md"))
      .map((path) => {
        const texto = archivos.get(path) ?? "";
        const links = [...texto.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => ({ target: m[1], count: 1 }));
        const tags = [...texto.matchAll(/#([\p{L}]+)/gu)].map((m) => m[1]);
        const relative = path.replace("/vault/", "");
        return { name: relative.split("/").pop() as string, path, relative, modifiedMs: ahora, tags, links };
      }),
  }),
  read_legacy_tasks: () => "",
  create_vault: (args) => `${String(args.base)}/${String(args.name)}`,
  save_app_config: (args) => {
    configGuardada.push(args.config);
    return null;
  },
};

(window as unknown as { __smoke: unknown }).__smoke = { emitir: (evento: string, payload: unknown) => callbacks.get(oyentes.get(evento) ?? -1)?.({ event: evento, id: 0, payload }), configGuardada, archivos, llamadas, tareas, pizarras, terminarDescarga: () => terminarDescarga() };
(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  // `listen` y los canales registran callbacks con esto; solo las descargas simuladas emiten.
  transformCallback: (callback: (message: unknown) => void) => {
    const id = siguienteCallback++;
    callbacks.set(id, callback);
    return id;
  },
  unregisterCallback: (id: number) => callbacks.delete(id),
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    llamadas.push({ cmd, args: args ?? {} });
    const respuesta = respuestas[cmd];
    if (respuesta) return respuesta(args ?? {});
    if (cmd.startsWith("list_") || cmd.startsWith("build_") || cmd.startsWith("read_legacy")) {
      return [];
    }
    return null;
  },
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
