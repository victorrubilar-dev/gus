<p align="center">
  <img src="src/assets/gus-icon-512.png" alt="Logo de Gus" width="212" />
  <p align="center" style="font-size: 30px;">Gus</p>
</p>



[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB.svg)](https://tauri.app/)
[![Made with](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)

**Gus** es una app de escritorio para **notas y tareas**, 100 % local. Las notas viven
en archivos `.md` de una carpeta tuya; las tareas, en un almacén JSON oculto por vault.
Sin nube y sin cuentas.

Es rápida y liviana porque usa [Tauri v2](https://tauri.app/) (backend en Rust + el
WebView del sistema en lugar de meter un Chromium entero).

---

## ✨ Qué puede hacer

- 📝 **Notas Markdown** — explorador de carpetas (crear, renombrar, mover y borrar), editor con renderizado en línea del markdown (la línea del cursor se muestra en crudo), vista «Ver crudo», vista previa a pantalla completa con casillas clicables y autoguardado con debounce de 500 ms.
- 🏷️ **Etiquetas** — chips en la cabecera del editor; viven en el frontmatter `tags: [a, b]` del `.md` y se autocompletan con las etiquetas ya usadas en el vault.
- 🧰 **Menú `/`** — inserta títulos, listas, tareas, citas, tablas, código, imágenes, separadores, fórmulas y diagramas; ↑↓, Intro y Esc.
- 📐 **Fórmulas y diagramas** — `$…$` / `$$…$$` con KaTeX y bloques ` ```mermaid ` con Mermaid, ambos con carga diferida.
- 🖼️ **Visor de imágenes** — png, jpg, gif, webp y svg se abren en el panel derecho.
- ↔️ **Panel ajustable** — divisor arrastrable entre explorador y panel (← →, Home/End; doble clic lo restablece); el ancho se recuerda entre sesiones.
- ✅ **Tareas** — almacén `.gus-tasks.json` por vault; creación con panel superpuesto (etiquetas, prioridad, plazo con calendario), prioridad con bandera de color, tablero Kanban arrastrable y vista lista, filtro por `#etiqueta`. También lee las tareas de las notas (`- [ ]` / `- [x]` con `!prioridad` y `📅`) y reescribe solo la checkbox en el `.md`.
- 📅 **Calendario** — mes en cuadrícula con vencidas / hoy / este mes, detalle por día y filtro por etiquetas.
- 🗂️ **Carpetas reales** — breadcrumb, creación de carpetas y arrastre de notas, imágenes y carpetas; renombrar y borrar desde el menú contextual.
- 🗑️ **Papelera** — al eliminar, el elemento se mueve a `.gus-trash` (manifiesto de origen, retención de 30 días); permite restaurar, eliminar definitivamente o vaciar.
- 🗃️ **Varios vaults** — panel de tarjetas con portadas y modo edición para la lista de vaults.
- 📊 **Panel Resumen** — próximas tareas por prioridad, últimas notas modificadas, contadores y accesos rápidos.
- ⌨️ **Paleta de comandos** — `Ctrl+K` / `Ctrl+P` filtra todas las notas del vault.
- 🏠 **Local-first** — carpetas con archivos `.md` estándar, sincronizables con git o rsync; sin nube ni cuentas.


---

## 🛠 Tecnologías

| Capa      | Stack                                          |
| --------- | ---------------------------------------------- |
| Escritorio | [Tauri v2](https://tauri.app/) + [Rust](https://www.rust-lang.org/) |
| UI        | [React 19](https://react.dev/) + TypeScript     |
| Estilos   | [Tailwind CSS v4](https://tailwindcss.com/)     |
| Animaciones | [Framer Motion](https://www.framer.com/motion/) |
| Iconos    | [Lucide](https://lucide.dev/)                   |
| Markdown  | [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) (carga diferida) |
| Fórmulas  | [remark-math](https://github.com/remarkjs/remark-math) + [rehype-katex](https://github.com/remarkjs/rehype-katex) + [KaTeX](https://katex.org/) |
| Diagramas | [Mermaid](https://mermaid.js.org/) — bloques ` ```mermaid `, descarga al primer uso |
| Paleta de comandos | [cmdk](https://cmdk.paco.me/)                     |
| Corrector | [hunspell-wasm](https://github.com/rotemdan/hunspell-wasm) — Hunspell en WebAssembly, 7 diccionarios (descarga al primer uso) |

---

## 🚀 Puesta en marcha

### 1. Requisitos

- [Node.js](https://nodejs.org/) (≥ 20) y [pnpm](https://pnpm.io/)
- [Rust y cargo](https://www.rust-lang.org/tools/install)
- En Linux, las librerías de desarrollo de WebKitGTK:

<details>
<summary><b>Arch Linux / CachyOS</b></summary>

```bash
sudo pacman -S --needed base-devel curl wget openssl webkit2gtk-4.1 gtk3 cairo gdk-pixbuf2 glib2
```

</details>

<details>
<summary><b>Debian / Ubuntu</b></summary>

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

</details>

<details>
<summary><b>Fedora</b></summary>

```bash
sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
  libappindicator-gtk3-devel librsvg2-devel
```

</details>

> En Windows y macOS solo necesitas las herramientas base: mira los
> [prerrequisitos oficiales de Tauri](https://v2.tauri.app/start/prerequisites/).

### 2. Clonar y arrancar

```bash
git clone git@github.com:victorrubilar-dev/gus.git
cd gus
pnpm install
pnpm tauri dev        # arranca la app (compila Rust + abre la ventana)
```

### 3. Otros comandos útiles

| Comando           | Qué hace                                              |
| ----------------- | ----------------------------------------------------- |
| `pnpm dev`        | Solo el frontend en `http://localhost:1420` (Vite)     |
| `pnpm build`      | Chequeo de tipos + bundle de producción en `dist/`    |
| `pnpm tauri build`| App empaquetada en `src-tauri/target/release/bundle/`  |
| `pnpm tauri icon src/assets/gus-icon.png` | Regenera los iconos del sistema (ventana, dock, bandeja) |

---

## 📂 Cómo se organizan las tareas

Las tareas viven en `.gus-tasks.json`, un archivo oculto en la raíz del vault que no aparece en el explorador y que solo se modifica desde la interfaz (no es Markdown editable a mano). Al abrir la pestaña **Tareas** por primera vez se importa cualquier `tareas.md` antiguo y queda archivado como `.gus-tasks.md.bak`.

La pestaña **Tareas** abre el **Tablero** Kanban (`Por hacer` / `En progreso` / `Completadas`; el estado «en progreso» es el campo `doing` del JSON) y el conmutador del encabezado cambia a la vista **Lista**. **«Nueva tarea»** abre un formulario superpuesto con nombre obligatorio, descripción, etiquetas, prioridad y plazo (casilla **«Limitar fecha»** con mini-calendario). La fecha se guarda como `AAAA-MM-DD`; la prioridad (`baja`, `media`, `alta`, `urgente`) se cambia con un clic en la bandera de la fila; cualquier `#etiqueta` filtra la vista, también en el calendario.

La sección **Notas del vault** reúne las tareas escritas en los `.md`: `src/utils/taskParser.ts` extrae sus líneas `- [ ]` / `- [x]` (fuera de bloques de código) con prioridad (`!urgente` … `!baja`), etiquetas `#tag` y plazo `📅`. Al marcarlas se reescribe solo la checkbox con `setTaskChecked` y el archivo se guarda con `write_vault_file`.


---

## 🗃 Estructura del proyecto

```
gus/
├─ src/                     # Frontend (React + TypeScript)
│  ├─ App.tsx               # Shell: picker + Resumen / Notas / Tareas / Calendario / Config.
│  ├─ App.css               # Tema oscuro (Tailwind v4) + estilos KaTeX/Mermaid/editor
│  ├─ assets/
│  │  ├─ gus-icon.png       # Logo original (1254 px, fuente de los iconos)
│  │  └─ gus-icon-512.png   # Logo para la interfaz y el favicon
│  ├─ components/
│  │  ├─ VaultPicker.tsx    # Panel principal: crear / abrir / quitar vaults
│  │  ├─ DashboardView.tsx  # Resumen: próximas tareas, últimas notas, accesos
│  │  ├─ CommandPalette.tsx # Paleta de comandos (Ctrl+K / Ctrl+P): buscar notas
│  │  ├─ EditorMenus.tsx    # Menús del cursor: autocompletado [[ y bloques /
│  │  ├─ MermaidDiagram.tsx # Dibuja los bloques ```mermaid (carga diferida)
│  │  ├─ FileExplorer.tsx   # Explorador: carpetas, notas, imágenes, menús
│  │  ├─ MarkdownEditor.tsx # Editor: render en línea, vista previa, menús [[ y /
│  │  ├─ InlinePreview.tsx  # Capa en vivo: markdown tras el texto transparente
│  │  ├─ TaskList.tsx       # Tareas: lista + tablero Kanban (prioridad, #tags, filtro)
│  │  ├─ KanbanBoard.tsx    # Tablero: Por hacer / En progreso / Completadas
│  │  ├─ CalendarView.tsx   # Resumen mensual y detalle de vencimientos
│  │  ├─ SettingsPanel.tsx  # Configuración: categorías + buscador
│  │  ├─ TrashView.tsx      # Papelera: lista, restaurar y vaciar .gus-trash
│  │  ├─ NewTaskDialog.tsx  # Formulario superpuesto de nueva tarea
│  │  └─ DatePicker.tsx     # Mini calendario integrado para elegir el plazo
│  ├─ utils/
│  │  └─ taskParser.ts      # Extrae - [ ] / - [x] de un .md: prioridad y #tags
│  └─ lib/
│     ├─ caretPosition.ts   # Posición del cursor en el textarea (ancla de menús)
│     ├─ calendarDate.ts    # Fechas: AAAA-MM-DD, meses y rejillas (lunes 1.º)
│     ├─ fileName.ts        # Utilidades de rutas y nombres
│     ├─ listContinue.ts     # Intro en listas: continúa el marcador o lo retira
│     ├─ markdownTasks.ts   # Lee y edita líneas - [ ] / - [x] (+ 📅)
│     ├─ noteTags.ts        # Etiquetas: frontmatter oculto y menú desplegable
│     ├─ taskPriority.ts    # Prioridades: tipos, colores, orden y ciclo
│     ├─ settings.ts        # Ajustes globales, categorías y valores por defecto
│     ├─ spellCheck.ts      # Corrector: idiomas, diccionarios y segmentación
│     ├─ wikiLink.ts        # [[enlaces]]: plugin remark, búsqueda y detectores
│     └─ newTask.ts         # Contrato del evento task-created
├─ public/
│  └─ dict/                 # Diccionarios hunspell (.aff/.dic por idioma, lazy)
├─ src-tauri/               # Backend (Rust)
│  └─ src/lib.rs            # Comandos: leer, escribir, renombrar, borrar, papelera…
├─ index.html
├─ package.json
└─ vite.config.ts
```

---

## 🧪 Verificación

```bash
cd src-tauri && cargo test --lib   # tests de Rust (39)
cd src-tauri && cargo clippy --all-targets
npx tsc --noEmit                   # tipos de TypeScript
pnpm build                         # build completo
```

---

## 📄 Licencia

Distribuido bajo la licencia [MIT](LICENSE) — mira el archivo [LICENSE](LICENSE)
para más detalles.
