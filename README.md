<p align="center">
  <img src="src/assets/gus-icon-512.png" alt="Logo de Gus" width="212" />
  <p align="center" style="font-size: 30px;">Gus</p>
</p>



[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB.svg)](https://tauri.app/)
[![Made with](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)

**Gus** es una app de escritorio para **notas y tareas**, 100 % local. Las notas viven
en archivos `.md` de una carpeta tuya; las tareas, en un almacén JSON oculto por vault.
Sin nube y sin cuentas.

Es rápida y liviana porque usa [Tauri v2](https://tauri.app/) (backend en Rust + el
WebView del sistema en lugar de meter un Chromium entero).

---

## ✨ Qué puede hacer

- 📝 **Notas Markdown** — explorador de carpetas (crear, renombrar, mover y borrar; con **Supr** se borra lo resaltado: la primera pulsación abre el confirm y la segunda lo mueve a la papelera), editor con renderizado en línea del markdown (la línea del cursor se muestra en crudo), tablas en vivo al estilo Obsidian sin fuente a la vista (no se pasa al markdown en crudo al teclear: el texto largo se envuelve dentro de su celda y hace crecer la fila; solo si la tabla tiene tantas columnas que no caben en la ventana, se deja ver el markdown en crudo (**clic** en una celda para poner el cursor justo donde se ha pulsado y **arrastrar** para seleccionar texto, también de celda a celda, como en cualquier editor —el **doble clic** marca la palabra y **Ctrl+C** se lleva esas celdas con tabuladores, no con los «|» del crudo—; Tab/Enter recorren las celdas y añaden filas, y **las flechas también**: **←/→** mueven el cursor carácter a carácter dentro de la celda y saltan a la celda contigua al llegar al borde (sin meterse por medio de los «|» del crudo), y **↑/↓** bajan y suben de fila en la misma columna conservando la posición horizontal (dentro de una celda larga solo saltan desde su primer o último renglón, para poder seguir editando el texto); **Mayús+clic** y **Mayús+flechas** marcan celdas completas —**←/→** avanzan de celda en celda y **↑/↓** de fila en fila, sin salir nunca del bloque—, y lo marcado se ve como un **cuadro** que abarca justo esas celdas (sin llevarse por delante filas enteras): con **Supr** se vacía su contenido dejando la tabla entera, **Ctrl+C** / **Ctrl+X** copian o cortan esas celdas (tabulador entre celdas, salto de línea entre filas) y la anchura de cada columna se mide **una vez** y se queda fija (al escribir, la tabla no se ensancha ni se estrecha sola: lo que ya no cabe salta de línea y hace crecer la fila, como en Excel) y se cambia arrastrando el **borde entre columnas**, como en Excel (la tarjeta se encoge con ellas, sin dejar hueco, y nunca se salen del ancho de la fila; un **doble clic** sobre ese borde la ajusta al contenido de la columna): si el texto deja de caber en su columna **salta de línea y la fila crece**, en vez de cortarse con «…» (el alto de más se compensa al hacer scroll y al mover el cursor); con un rectángulo marcado, **«Combinar celdas»** une esas celdas en una sola, que se dibuja ocupando todo el rectángulo y cuyo contenido es la concatenación de todas (el texto vive en la celda de arriba a la izquierda); **Ctrl+A** selecciona solo el texto de la celda (pinchar, en cambio, ya no marca la celda entera: el cursor cae donde pulsas y solo se borra o se sustituye lo que has marcado); **Alt+↑** / **Alt+↓** mueven la fila del cursor una posición dentro de la tabla y con **Mayús** la duplican (mover la línea entera la sacaría del bloque); un **clic sobre la casilla** de una celda de tarea (`- [ ]`) la marca o la desmarca; la tabla se dibuja como una **tarjeta** con esquinas redondeadas y una rejilla fina (la cabecera con su fondo, la celda del cursor con un anillo de acento) en vez de una cuadrícula de recuadros sueltos; al pasar el ratón sobre la tabla aparecen dos barras **+** en los bordes que solo se ven con el ratón encima de ellas: la del costado (toda la altura) añade una columna a la derecha y la de abajo (todo el ancho) añade una fila por el final; **↓ desde la última fila** (o **↑ desde la cabecera**) saca el cursor de la tabla, abriendo una línea nueva si la nota termina o empieza en ella; el bloque es **fijo**: Supr y Backspace no lo rompen —conservan separadores, la fila `|---|` y los saltos de línea que lo unen al texto— y solo se elimina con «Eliminar tabla» del menú), listas numeradas con **renumeración automática** (al quitar o añadir una línea, las que siguen se actualizan y no quedan huecos ni números repetidos; el número inicial se conserva), vista previa a pantalla completa con casillas clicables, deshacer/rehacer (Ctrl+Z / Ctrl+Shift+Z), mover líneas con **Alt+↑** / **Alt+↓** —el cursor y la vista acompañan el movimiento— y autoguardado con debounce de 500 ms. Los `.pdf` del vault abren un **visor integrado** (pdf.js) con zoom y paginación, igual que las imágenes.
- 🏷️ **Etiquetas** — chips en la cabecera del editor; viven en el frontmatter `tags: [a, b]` del `.md` y se autocompletan con las etiquetas ya usadas en el vault.
- 🧰 **Menú `/`** — inserta títulos, listas, tareas, citas, tablas, código, imágenes, separadores, fórmulas y diagramas; ↑↓, Intro y Esc. Al escribir `/tabla` se abre un segundo grupo con los **tamaños** (2×2, 3×3, 4×3, 3×5, 5×5) y la tabla nace con esas medidas, con el cursor en la primera celda de datos. Con el cursor **dentro de una tabla** el menú cambia: en vez de bloques (que allí no caben) ofrece las acciones de esa tabla —agregar fila o columna, eliminar fila, columna o tabla, combinar y descombinar celdas, marcar la casilla de tarea, ordenar A→Z o Z→A por la columna del cursor, alinearla a izquierda, centro o derecha, subirla o bajarla y duplicarla, y copiarla al portapapeles—, todas escribibles a mano («/agregar», «/alinear»…) para no tener que recorrer la lista. Fuera de una tabla, con algo seleccionado aparece **«Tabla desde el texto»**: convierte lo marcado en tabla separando por tabuladores (o por comas o «|», según lo que traiga), con la primera línea como cabecera y escapando los «|» del contenido.
- 🔤 **Corrector ortográfico** — subrayado ondulado en palabras mal escritas y 7 idiomas elegibles (o desactivado) en Ajustes. Al dejar el cursor sobre una palabra errónea se despliega solo, encima de ella, un cuadro con las sugerencias (estilo Google Docs): **Alt+Intro** aplica la corrección sin ratón, **↑/↓** recorre la lista y entonces **Intro** o los números **1-9** la aplican, y **Esc** la descarta (el clic derecho sigue ofreciendo «Agregar al diccionario» e «Ignorar»).
- 🖱️ **Menú del editor** — clic derecho siempre visible con las sugerencias de corrección (y «Agregar al diccionario» / «Ignorar»), cortar/copiar/pegar/pegar sin formato/seleccionar todo, y submenús para insertar bloques (código, tablas, fórmulas, diagramas), texto (títulos, listas, citas) y formato (negrita, cursiva, tachado, código, enlace). Si el clic cae sobre una tabla aparece su propia sección, en este orden: **agregar fila**, **agregar columna**, **eliminar fila**, **eliminar columna**, **eliminar tabla** y **combinar celdas** (con un rectángulo marcado une esas celdas en una sola, como en Excel; sin él, combina las filas enteras seleccionadas, y hacen falta dos o más; fila y columna se desactivan cuando la tabla se quedaría con menos de una fila de cuerpo o una sola columna); después vienen **descombinar celdas**, **ordenar A→Z** y **ordenar Z→A** por la columna en la que se ha hecho clic (numérico si lo es, con orden natural en los nombres: «2» antes que «10») y **copiar celdas** (lo marcado o, sin marca, la celda del cursor).
- 📐 **Fórmulas y diagramas** — `$…$` / `$$…$$` con KaTeX y bloques ` ```mermaid ` con Mermaid, ambos con carga diferida.
- 🖼️ **Visor de imágenes** — png, jpg, gif, webp, svg, bmp, avif, ico, tiff, heic, heif, jxl, qoi y pnm se abren en el panel derecho (según lo que sepa decodificar el navegador).
- ↔️ **Panel ajustable** — divisor arrastrable entre explorador y panel (← →, Home/End; doble clic lo restablece); el ancho se recuerda entre sesiones.
- 🏡 **Pantalla de bienvenida** — mientras no haya nada abierto, el explorador conserva su ancho y el panel derecho ofrece «Nueva nota», la paleta (Ctrl+K), los atajos y las notas editadas recientemente.
- ✅ **Tareas** — almacén `.gus-tasks.json` por vault; creación con panel superpuesto (etiquetas, prioridad, plazo con calendario), prioridad con bandera de color, tablero Kanban arrastrable y vista lista, filtro por `#etiqueta`. También lee las tareas de las notas (`- [ ]` / `- [x]` con `!prioridad` y `📅`) y reescribe solo la checkbox en el `.md`.
- 📅 **Calendario** — mes en cuadrícula con vencidas / hoy / este mes, detalle por día y filtro por etiquetas.
- 🗂️ **Carpetas reales** — barra de ruta con chevrons que se pliega sola cuando no cabe (lo oculto va tras «…», con desplegable para saltar a cualquier nivel), botones «atrás»/«adelante» con historial (**Alt+←** / **Alt+→**; **Alt+↑** sube al padre), creación de carpetas y arrastre de notas, imágenes y carpetas —también soltadas sobre la propia ruta—; renombrar y borrar desde el menú contextual.
- 📥 **Añadir archivos** — botón «Añadir archivos» en el explorador **o arrastrando desde el gestor de archivos del sistema** (la ventana avisa con la carpeta exacta donde entrarán): copia `.md`, `.pdf` e imágenes a la carpeta que estés viendo sin tocar el original; lo que no sea de esos tipos se rechaza explicando el motivo.
- 🖱️ **Menús con clic derecho** — el menú por defecto del webview está desactivado en toda la app (solo aparecen los de Gus): en las filas del explorador (renombrar, mover, exportar, eliminar), en **la lista vacía** (nueva nota, nueva carpeta, añadir archivos del PC, refrescar) y en el editor (formato, cortar/pegar, correcciones ortográficas y operaciones de tabla).
- 🗑️ **Papelera** — al eliminar, el elemento se mueve a `.gus-trash` (manifiesto de origen, retención de 30 días); admite **cualquier tipo de archivo** (`.md`, `.pdf`, `.png`, `.jpg`, `.txt`, `.zip`…, en cualquier formato de imagen) y carpetas, y permite restaurar, eliminar definitivamente o vaciar.
- 🗃️ **Varios vaults** — panel de tarjetas con portadas y modo edición para la lista de vaults.
- 📊 **Panel Resumen** — próximas tareas por prioridad, últimas notas modificadas, contadores y accesos rápidos.
- ⌨️ **Paleta de comandos** — `Ctrl+K` / `Ctrl+P` filtra todas las notas del vault.
- 🎨 **Temas** — siete paletas: **Gus Oscuro** (el de siempre), **Gus Claro**, **OLED** (negro puro), **Dracula**, **Nord** y **Solarized** en oscuro y claro, con vista previa en Ajustes → Apariencia. Cada tema trae su propio color de acento, que puedes cambiar luego con «Del tema» o con un color fijo.
- 🔍 **Escala de la interfaz** — Ctrl + «+» / Ctrl + «−» agrandan o achican toda la interfaz (Ctrl + 0 restablece); también desde Ajustes → Apariencia.
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
│  │  ├─ FileExplorer.tsx   # Explorador: carpetas, notas, imágenes, barra de ruta y menús
│  │  ├─ MarkdownEditor.tsx # Editor: render en línea, vista previa, menús [[ y /
│  │  ├─ InlinePreview.tsx  # Capa en vivo: markdown tras el texto transparente
│  │  ├─ TaskList.tsx       # Tareas: lista + tablero Kanban (prioridad, #tags, filtro)
│  │  ├─ KanbanBoard.tsx    # Tablero: Por hacer / En progreso / Completadas
│  │  ├─ CalendarView.tsx   # Resumen mensual y detalle de vencimientos
│  │  ├─ SettingsPanel.tsx  # Configuración: categorías + buscador
│  │  ├─ TrashView.tsx      # Papelera: lista, restaurar y vaciar .gus-trash
│  │  ├─ NewTaskDialog.tsx  # Formulario superpuesto de nueva tarea
│  │  ├─ EditorContextMenu.tsx # Menú del clic derecho: corrector, edición, insertar/texto/formato
│  │  ├─ WelcomePanel.tsx   # Bienvenida: nueva nota, atajos y notas recientes
│  │  └─ DatePicker.tsx     # Mini calendario integrado para elegir el plazo
│  ├─ utils/
│  │  └─ taskParser.ts      # Extrae - [ ] / - [x] de un .md: prioridad y #tags
│  └─ lib/
│     ├─ caretPosition.ts   # Posición del cursor en el textarea (ancla de menús)
│     ├─ pointerOffset.ts   # Offset del texto bajo el puntero (menú contextual)
│     ├─ pasteText.ts       # Limpia marcas markdown al pegar sin formato
│     ├─ calendarDate.ts    # Fechas: AAAA-MM-DD, meses y rejillas (lunes 1.º)
│     ├─ fileName.ts        # Utilidades de rutas y nombres
│     ├─ importFiles.ts     # Añadir archivos: filtros del diálogo y resumen
│     ├─ listContinue.ts     # Intro en listas: continúa el marcador o lo retira
│     ├─ listNumbering.ts    # Renumera la lista numerada que contiene al cursor
│     ├─ markdownTasks.ts   # Lee y edita líneas - [ ] / - [x] (+ 📅)
│     ├─ noteTags.ts        # Etiquetas: frontmatter oculto y menú desplegable
│     ├─ taskPriority.ts    # Prioridades: tipos, colores, orden y ciclo
│     ├─ settings.ts        # Ajustes globales, categorías y valores por defecto
│     ├─ spellCheck.ts      # Corrector: idiomas, diccionarios y segmentación
│     ├─ taskStore.ts       # Almacén .gus-tasks.json: carga y persistencia
│     ├─ wikiLink.ts        # [[enlaces]]: plugin remark, búsqueda y detectores
│     └─ newTask.ts         # Contrato del evento task-created
├─ public/
│  └─ dict/                 # Diccionarios hunspell (.aff/.dic por idioma, lazy)
├─ src-tauri/               # Backend (Rust)
│  └─ src/lib.rs            # Comandos: leer, escribir, renombrar, borrar, importar, papelera…
├─ index.html
├─ package.json
└─ vite.config.ts
```

---

## 🧪 Verificación

```bash
cd src-tauri && cargo test --lib   # tests de Rust (46)
cd src-tauri && cargo clippy --all-targets
npx tsc --noEmit                   # tipos de TypeScript
pnpm build                         # build completo
```

---

## 📄 Licencia

Distribuido bajo la licencia [GNU General Public License v3.0](LICENSE) — mira el archivo [LICENSE](LICENSE)
para más detalles.
