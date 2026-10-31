# AGENTS.md 

> **Instrucción para el modelo:** Este archivo proporciona todo el contexto necesario para entender, modificar y contribuir al proyecto **Gus**. Léelo completo antes de realizar cualquier cambio.

---

## ¿Qué es Gus?

**Gus** es una aplicación de escritorio **100% local-first** para tomar notas en Markdown y gestionar tareas personales. Está construida con **Tauri v2** (backend en Rust + frontend en React/TypeScript).

**Principios fundamentales:**
- **Privacidad absoluta:** Sin nube, sin cuentas, sin telemetría.
- **Las notas son archivos `.md`** en una carpeta elegida por el usuario ("vault").
- **Las tareas** se guardan en un JSON oculto (`.gus-tasks.json`) dentro de cada vault.
- **La búsqueda a texto completo** guarda su índice en `.gus-index/` dentro de cada vault (pestaña Buscar).
- **La papelera** de cada vault vive en `.gus-trash/` dentro del propio vault.
- **La biblioteca de PDF** guarda sus estanterías en `.gus-library.json`, los **hábitos** y su registro en `.gus-habits.json`, y cada **pizarra** en `.gus-boards/<id>.json`, todo dentro del vault. Un watcher (`vigilancia.rs`) avisa de lo que cambie fuera de la app.
- **Idioma principal:** Español (con i18n a inglés integrado).

**Repositorio:** https://github.com/victorrubilar-dev/gus  
**Licencia:** GPL-3.0-or-later  
**Versión:** 0.2.0

---

## Stack Tecnológico

### Frontend (TypeScript / React)
| Tecnología | Uso |
|---|---|
| React 19 | Framework UI |
| TypeScript ~6.0 | Tipado estricto |
| Vite 8 | Build tool / dev server |
| Tailwind CSS 4 | Estilos utility-first |
| Framer Motion 13 | Animaciones (con `LazyMotion`) |
| react-markdown 10 + remark-gfm + remark-math + rehype-katex | Renderizado Markdown con GFM y matemáticas |
| KaTeX | Fórmulas matemáticas (`$...$`, `$$...$$`) |
| Mermaid 12 | Diagramas (lazy-loaded) |
| PrismJS | Resaltado de sintaxis |
| pdfjs-dist 6 | Visor PDF (lazy-loaded) |
| hunspell-wasm | Corrector ortográfico (7 idiomas, WASM) |
| lucide-react | Iconos |
| cmdk | Paleta de comandos |
| clsx + tailwind-merge | Merge de clases condicional |
| modern-screenshot | Captura para exportar PDF |
| @tauri-apps/api | Puente IPC con Tauri |
| @tauri-apps/plugin-updater + plugin-process | Actualización automática: comprobar, descargar con progreso, instalar y reiniciar |

### Backend (Rust)
| Tecnología | Uso |
|---|---|
| Tauri 2 | Framework de app de escritorio |
| serde / serde_json | Serialización |
| image 0.25 | Thumbnails para el selector de imágenes |
| tauri-plugin-dialog | Diálogos nativos de archivos |
| tauri-plugin-clipboard-manager | Acceso al portapapeles |
| tauri-plugin-opener | Abrir enlaces externos y el instalador descargado |
| tauri-plugin-notification | Avisos del sistema (vencimientos y nota del día) |
| tauri-plugin-updater | Actualizador firmado (manifiesto `latest.json` de las releases de GitHub, verificación minisign) |
| tauri-plugin-process | Reiniciar la app tras instalar una actualización |
| notify-debouncer-mini | Watcher del vault: avisa de cambios hechos fuera de la app |
| reqwest (native-tls) | Descarga manual del instalador (solo `.deb`/`.rpm`, que no pueden actualizarse solos), a petición del usuario |

### Testing
| Tecnología | Uso |
|---|---|
| Vitest 5 | Tests unitarios (ver `pnpm test`; incluye los de `scripts/`) |
| playwright-core | Benchmarks / integración |

### Package Manager
**pnpm** (con `pnpm-workspace.yaml` que fuerza `minimumReleaseAge: 10080` minutos / 7 días)

---

## Estructura del Proyecto

```
gus/
├── src/                          # Frontend (React + TypeScript)
│   ├── main.tsx                  # Punto de entrada: aplica tema, monta <App/>
│   ├── App.tsx                   # Componente raíz: gestión de vaults, tabs, routing, drag-drop
│   ├── App.css                   # Estilos globales, tema Tailwind, resaltado, exportación PDF
│   ├── components/               # ~50 archivos: componentes React y hooks del editor
│   │   ├── MarkdownEditor.tsx    # Editor central (textarea + overlay renderizado)
│   │   ├── markdownPreview.tsx   # Vista previa del editor: render de Markdown, wiki-enlaces, KaTeX, Mermaid e imágenes
│   │   ├── markdownEditorTypes.ts # Tipos internos del editor (menús, arrastres, estado de guardado)
│   │   ├── useEditorHistory.ts   # Refs y instantánea del historial de deshacer del editor
│   │   ├── useTableKeyboard.ts   # Teclado de tablas del editor: Tab, flechas, salir del bloque y selección con Mayús
│   │   ├── useTableResize.ts     # Barras y redimensionado de columnas de tabla con el puntero
│   │   ├── FileExplorer.tsx      # Árbol de archivos del vault (crear/renombrar/mover/eliminar)
│   │   ├── CommandPalette.tsx    # Búsqueda/ apertura rápida de notas (cmdk)
│   │   ├── DashboardView.tsx     # Pestaña de inicio
│   │   ├── TaskList.tsx          # Vista de lista de tareas (lista en árbol con subtareas, tablero y vista «Notas»)
│   │   ├── TaskRelations.tsx     # Panel de una tarea: subtareas, de quién cuelga y qué la bloquea
│   │   ├── NoteTasksView.tsx     # Checkboxes de las notas como tareas, agrupados por nota de origen
│   │   ├── CheckboxVisual.tsx    # Casilla visual compartida por las listas de tareas
│   │   ├── KanbanBoard.tsx       # Tablero Kanban para tareas
│   │   ├── LibraryView.tsx       # Biblioteca de PDF en estanterías, con portada (lazy)
│   │   ├── HabitsView.tsx        # Hábitos: anillos de cierre diario y tracker clásico
│   │   ├── BoardsView.tsx        # Lista de pizarras (crear, abrir, borrar a la papelera)
│   │   ├── BoardEditor.tsx       # Lienzo de una pizarra: lápiz, goma, formas, flechas, texto, post-it e imágenes
│   │   ├── BoardImagePicker.tsx  # Selector de imágenes del vault para la pizarra
│   │   ├── CalendarView.tsx      # Calendario con fechas de vencimiento
│   │   ├── SettingsPanel.tsx     # UI de configuración (7 categorías)
│   │   ├── VaultPicker.tsx       # Selección/creación de vault
│   │   ├── WelcomePanel.tsx      # Pantalla de bienvenida
│   │   ├── NewTaskDialog.tsx     # Diálogo de creación de tareas
│   │   ├── PdfViewer.tsx         # Visor PDF.js (lazy)
│   │   ├── PdfExportDialog.tsx   # Exportación PDF con vista previa
│   │   ├── PdfNotesPanel.tsx     # Notas de anotación PDF
│   │   ├── MermaidDiagram.tsx    # Renderizador de diagramas Mermaid (lazy)
│   │   ├── InlinePreview.tsx     # Vista previa inline de imagen/PDF
│   │   ├── EditorMenus.tsx       # Menú slash (/) para insertar bloques
│   │   ├── EditorContextMenu.tsx # Menú contextual clic derecho
│   │   ├── TrashView.tsx         # Gestión de papelera/reciclaje
│   │   ├── SearchView.tsx        # Pestaña Buscar (índice a texto completo)
│   │   ├── GraphView.tsx         # Grafo de enlaces entre notas
│   │   ├── BacklinksPanel.tsx    # Panel de backlinks de la nota abierta
│   │   ├── DailyNoteBar.tsx      # Barra de la nota diaria (qué día se ve)
│   │   ├── useResolvedImage.ts   # Resuelve imágenes del vault a datos `data:`
│   │   ├── Tour.tsx              # Tour de onboarding guiado
│   │   ├── UpdateNotice.tsx      # Aviso de versión nueva: descarga automática con barra de progreso y «Reiniciar y actualizar» (o descarga manual en .deb/.rpm)
│   │   ├── ThemeCard.tsx         # Tarjeta de vista previa de tema
│   │   ├── DatePicker.tsx        # Componente de entrada de fecha
│   │   └── CopyCodeButton.tsx    # Botón copiar para bloques de código
│   ├── lib/                      # ~45 módulos de utilidades, cada uno con su `.test.ts`
│   │   ├── settings.ts           # Tipos de configuración, defaults, normalización
│   │   ├── themes.ts             # 7 temas (gus-oscuro, gus-claro, oled, dracula, nord, solarized x2)
│   │   ├── i18n/                 # Internacionalización (es/en)
│   │   │   ├── core.ts           # Motor de traducción, reglas de plural, detección de idioma
│   │   │   ├── provider.tsx      # React context provider
│   │   │   ├── locales/es.ts     # Catálogo español
│   │   │   └── locales/en.ts     # Catálogo inglés
│   │   ├── shortcuts.ts          # Definiciones de atajos de teclado
│   │   ├── spellCheck.ts         # Corrector ortográfico Hunspell WASM
│   │   ├── taskStore.ts          # Persistencia de tareas (JSON)
│   │   ├── taskPriority.ts       # Niveles de prioridad (Baja/Media/Alta/Urgente)
│   │   ├── pdfExport.ts          # Lógica de generación PDF
│   │   ├── pdfAnnotations.ts     # Manejo de anotaciones PDF
│   │   ├── importFiles.ts        # Lógica de importación de archivos
│   │   ├── imageLinks.ts         # Detección de rutas de imagen
│   │   ├── wikiLink.ts           # Resolución de enlaces [[wiki]]
│   │   ├── fileName.ts           # Utilidades de ruta/nombre de archivo
│   │   ├── editorHistory.ts      # Pila de deshacer/rehacer
│   │   ├── codeBlocks.ts         # Manejo de bloques de código
│   │   ├── highlight.ts          # Resaltado de sintaxis
│   │   ├── clipboard.ts          # Utilidades de portapapeles
│   │   ├── pasteText.ts          # Manejo de pegado
│   │   ├── moveLines.ts          # Mover líneas Alt+Arriba/Abajo
│   │   ├── listNumbering.ts      # Renumeración automática de listas ordenadas
│   │   ├── listContinue.ts       # Continuar listas con Enter
│   │   ├── markdownTasks.ts      # Toggle de checkboxes de tareas
│   │   ├── noteTags.ts           # Parseo de tags en frontmatter
│   │   ├── newTask.ts            # Lógica de creación de tareas
│   │   ├── calendarDate.ts       # Utilidades de fecha de calendario
│   │   ├── externalLink.ts       # Manejo de enlaces externos
│   │   ├── caretPosition.ts      # Utilidades de posición del cursor
│   │   ├── pointerOffset.ts      # Conversión de coordenadas de puntero
│   │   ├── uiZoom.ts             # Factor de zoom de UI
│   │   ├── zoomShortcuts.ts      # Atajos de teclado de zoom
│   │   ├── tableLayout.ts        # Cálculos de layout de tablas
│   │   ├── updateCheck.ts        # Aviso manual: verificación de versión y elección del instalador en GitHub releases (.deb/.rpm)
│   │   ├── selfUpdate.ts         # Actualización automática: comprobación vía plugin y progreso de la descarga
│   │   ├── externalChange.ts     # Qué hacer con la nota abierta cuando cambia fuera de la app (ignorar, recargar o conflicto)
│   │   ├── noteTasks.ts          # Checkboxes de las notas como tareas: leer, marcar su línea, filtrar por origen
│   │   ├── taskTree.ts           # Subtareas y dependencias (árbol, progreso, ciclos); el backend repite las reglas al guardar
│   │   ├── library.ts            # Estanterías de la biblioteca de PDF
│   │   ├── pdfCover.ts           # Portada (página 1) de un PDF con pdf.js, en cola y con caché
│   │   ├── habits.ts             # Hábitos: programación, rachas y cumplimiento
│   │   ├── board.ts              # Pizarra: modelo, geometría, goma, historial y lectura segura del JSON
│   │   ├── linkGraph.ts          # Grafo de enlaces del vault (lo devuelve el backend)
│   │   ├── graphLayout.ts        # Colocación del grafo de enlaces
│   │   ├── searchIndex.ts        # Tipos y utilidades de la búsqueda a texto completo
│   │   ├── dailyNotes.ts         # Notas diarias: una por día, en carpeta propia
│   │   ├── notifications.ts      # Avisos del sistema: vencimientos y nota del día
│   │   └── version.ts            # Versión de la app desde package.json
│   ├── assets/                   # Iconos (gus-icon.png, gus-icon-512.png)
│   └── types/                    # Declaraciones TypeScript
│       └── prism-components.d.ts
├── src-tauri/                    # Backend Rust
│   ├── src/
│   │   ├── main.rs               # Punto de entrada (6 líneas)
│   │   ├── lib.rs                # ~780 líneas: utilidades compartidas, creación de vaults, descarga manual, `can_self_update`, `run()`
│   │   ├── tests.rs              # Tests de la raíz del crate (`cargo test`)
│   │   ├── archivos.rs           # Escritura del vault: crear, leer, renombrar, mover y borrar notas, carpetas y ficheros
│   │   ├── biblioteca.rs         # Estanterías de la biblioteca de PDF: `.gus-library.json`
│   │   ├── busqueda.rs           # Búsqueda a texto completo: índice incremental en `.gus-index/`
│   │   ├── configuracion.rs      # Vaults conocidos, ajustes y `load/save_app_config`
│   │   ├── enlaces.rs            # Grafo de enlaces `[[wiki]]` y backlinks
│   │   ├── habitos.rs            # Hábitos y su registro: `.gus-habits.json`, con validación
│   │   ├── importar.rs           # Importación de ficheros externos al vault
│   │   ├── listados.rs           # Listados del vault: entradas, carpetas, recientes, imágenes y etiquetas
│   │   ├── medios.rs             # Imágenes, miniaturas y PDF (lectura como data URL)
│   │   ├── papelera.rs           # Papelera por vault: manifiesto, TTL, restaurar y migración
│   │   ├── pizarras.rs           # Pizarras: `.gus-boards/<id>.json` (el contenido lo entiende la interfaz)
│   │   ├── tareas.rs             # Tareas: almacén `.gus-tasks.json`, relaciones (subtareas y dependencias) y migración desde `tareas.md`
│   │   └── vigilancia.rs         # Watcher del vault (`notify`): avisa de cambios externos y descarta las escrituras propias
│   ├── Cargo.toml                # Dependencias Rust
│   ├── tauri.conf.json           # Configuración Tauri (incluye la clave pública y el endpoint del actualizador)
│   └── icons/                    # Iconos de la app (todas las plataformas)
├── public/
│   └── dict/                     # Diccionarios Hunspell (7 idiomas)
│       ├── es.aff / es.dic       # Español
│       ├── en-US.aff / en-US.dic # Inglés (US)
│       ├── en-GB.aff / en-GB.dic # Inglés (UK)
│       ├── de.aff / de.dic       # Alemán
│       ├── fr.aff / fr.dic       # Francés
│       ├── it.aff / it.dic       # Italiano
│       └── pt-BR.aff / pt-BR.dic # Portugués brasileño
├── scripts/
│   └── update-manifest.mjs       # Genera `latest.json` (manifiesto del actualizador) en el CI; con su test
├── .github/
│   ├── workflows/release.yml     # CI de releases: tests, build en 3 SO, firma y draft
│   └── release-notes.md          # Cuerpo de la release (se reescribe en cada una)
├── bench/                        # Benchmarks de rendimiento y regresión visual (Playwright)
│   ├── prueba-editor.mjs
│   ├── prueba-menu.mjs
│   ├── prueba-imagenes.mjs
│   ├── prueba-explorador.mjs
│   └── colector.mjs
├── task/                         # Notas de tareas de desarrollo (gitignored)
├── .vscode/
│   └── extensions.json           # Recomienda tauri-vscode, rust-analyzer
├── index.html                    # HTML de entrada Vite
├── vite.config.ts                # Config Vite (puerto 1420, React + Tailwind)
├── tsconfig.json                 # Config TypeScript estricto
├── tsconfig.node.json            # Config TS específico para Node
├── package.json                  # Dependencias y scripts
├── pnpm-workspace.yaml           # Config pnpm workspace
├── pnpm-lock.yaml                # Lockfile
├── README.md                     # Documentación principal (español)
├── PRIVACY.md                    # Política de privacidad
├── AGENTS.md                     # Este archivo
├── LICENSE                       # GPL-3.0-or-later
└── .gitignore
```

---

## Cómo Construir, Testear y Ejecutar

### Prerrequisitos
- Node.js
- pnpm
- Rust toolchain
- Tauri CLI

### Comandos

```bash
# Instalar dependencias
pnpm install

# Desarrollo (Vite en :1420 + ventana Tauri)
pnpm tauri dev

# Build de producción (TypeScript check + Vite build)
pnpm build

# Build de app de escritorio (todas las plataformas)
pnpm tauri build

# Tests
pnpm test              # Todos los tests Vitest (195 tests)
pnpm test:watch        # Modo watch

# Type checking
npx tsc --noEmit

# Benchmarks
pnpm bench             # Benchmark del editor
pnpm bench:menu        # Benchmark del menú
pnpm bench:images      # Benchmark del selector de imágenes
pnpm bench:explorer    # Benchmark del explorador de archivos
pnpm traza             # Collector trace

# Calidad
npx -y react-doctor@latest --json   # Reporte de calidad React
```

---

## Flujo de Trabajo: Ramas y Releases

### Ramas

| Rama | Para qué sirve |
|---|---|
| `develop` | **Rama de trabajo.** Aquí vive el día a día: cada commit de funcionalidad, arreglo o refactor va a `develop`. |
| `main` | **Rama de publicación.** Solo avanza cuando se prepara una release; es lo que empaqueta la CI y lo que instala quien descarga la app. |

**Regla principal:** se trabaja **siempre en `develop`**. Nunca se commitea en `main` fuera del paso de release descrito más abajo. Como consecuencia, `main` es siempre la suma de lo ya publicado más la release que se esté preparando, y `develop` puede ir por delante con trabajo en curso.

> El actualizador (`src/lib/selfUpdate.ts`, y `src/lib/updateCheck.ts` para `.deb`/`.rpm`) lee las releases de GitHub, así que **todo lo que llegue a `main` y se publique es código que recibirán, instalado, las personas que ya tienen Gus**. Por eso `main` solo se toca con algo que ya ha pasado por `develop` y está verificado.

### Commits en `develop`

- **Un requisito o cambio = un commit**, con estilo convencional y en español: `feat(scope): descripción`, `fix(scope): descripción`, `chore(scope): descripción`, `docs: descripción`.
- **Nunca `git add -A`**: se listan explícitamente los ficheros del cambio (`git add ruta1 ruta2 ...`). Ficheros que no suelen entrar en un commit de funcionalidad: `.gitignore` (si el usuario lo tiene modificado), `task/` (está en `.gitignore`) y `src-tauri/Cargo.lock` salvo que el cambio de versión sea justo lo que se commitea.
- **Verificación antes de cerrar cada commit**: `npx tsc --noEmit`, `pnpm test` y `pnpm build` en verde.
- Si el cambio toca Rust (`src-tauri/src/lib.rs`) y el entorno no tiene toolchain, **no se da por compilado**: se avisa al usuario para que ejecute `cargo test` dentro de `src-tauri`.
- Subida a origin al terminar la unidad de trabajo: `git push origin develop`. Los pushes a `main` solo en release.

### Actualizaciones automáticas: firma y claves

Las versiones se instalan solas en AppImage, Windows y macOS (los `.deb`/`.rpm` siguen con descarga manual). Para que eso sea seguro, cada instalador del actualizador va **firmado** (minisign) y la app solo instala lo que verifica con la clave pública incrustada en `tauri.conf.json` (`plugins.updater.pubkey`).

- **Clave privada:** `~/.tauri/gus.key` (sin contraseña) en la máquina del mantenedor. **No va al repositorio.** Debe estar además como secret `TAURI_SIGNING_PRIVATE_KEY` de GitHub Actions (y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si algún día se le pone contraseña). Sin el secret, el job `test` de `release.yml` falla de entrada con un mensaje claro.
- **Si se pierde o se cambia la clave**, las instalaciones ya hechas no podrán verificar las actualizaciones nuevas y habrá que reinstalar a mano. Guarda una copia segura.
- **Build local** (`pnpm tauri build`): `createUpdaterArtifacts` exige la clave en el entorno: `TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/gus.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" pnpm tauri build`. Sin ella la build falla al firmar.
- **Versiones de plugins:** el crate `tauri-plugin-updater` y el paquete npm `@tauri-apps/plugin-updater` deben coincidir en versión mayor.menor (`tauri build` lo comprueba y falla si no).
- **Windows + SignPath:** SignPath modifica el `.exe` tras compilarlo, así que el CI vuelve a firmar ese instalador para el actualizador en el job `release`.
- **Manifiesto:** `scripts/update-manifest.mjs` crea `latest.json` en el job `release` a partir de los `.sig`; falla si falta una plataforma obligatoria (Linux x86_64, Windows x86_64, macOS Apple Silicon) para no desactivar una en silencio.

### Release: de `develop` a `main`

Se hace **solo cuando hay algo que publicar** (una versión nueva: `v0.1.3`, `v0.1.4`, …). El guion, en este orden:

1. **Verificar `develop` en verde**: `npx tsc --noEmit && pnpm test && pnpm build`.
2. **Pasar todo a `main`**:
   ```bash
   git checkout main
   git pull origin main
   git merge --ff-only develop     # o `git merge develop` si main avanzó por su cuenta
   ```
3. **Subir la versión en todos estos ficheros a la vez** (tienen que coincidir):
   | Fichero | Campo |
   |---|---|
   | `package.json` | `"version"` (es la fuente de `APP_VERSION`) |
   | `src-tauri/tauri.conf.json` | `"version"` (la que ven los bundles) |
   | `src-tauri/Cargo.toml` | `version` |
   | `src-tauri/Cargo.lock` | `version` del paquete `gus` |
   | `AGENTS.md` | línea **Versión** |
4. **Reescribir `.github/release-notes.md`** con lo nuevo de esta versión. El workflow lo usa tal cual (`--notes-file`) para el cuerpo de la release: si no se toca, la release sale con las notas de la versión anterior.
5. **Commit de release y etiqueta** (tag **ligero**, como `v0.1.0`, `v0.1.1` y `v0.1.2`):
   ```bash
   git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml \
           src-tauri/Cargo.lock .github/release-notes.md AGENTS.md
   git commit -m "chore(release): v0.1.3"
   git tag v0.1.3
   git push origin main v0.1.3
   ```
6. **La CI hace el resto**: el push del tag dispara `.github/workflows/release.yml`, que compila en Linux/Windows/macOS, sube los instaladores (`.deb`, `.rpm`, `.AppImage`, `.exe`, `.msi`, `.dmg`) y deja un **draft release** con las notas nuevas. Hay que publicarlo a mano en GitHub **como release normal, sin marcarlo como *pre-release***: el actualizador lee `releases/latest/download/latest.json` y GitHub ignora las pre-releases en esa dirección (y en `releases/latest` de la API), así que una pre-release no se ofrecería a nadie.
7. **Volver a `develop` y ponerla al día** con lo publicado:
   ```bash
   git checkout develop
   git merge main                  # o `git rebase main`
   git push origin develop
   ```

La primera versión con actualizador (la 0.3.0) no puede instalarse sola en quien tenga una anterior, porque esas no traen el plugin: esas personas la actualizan una vez con el aviso de siempre (descarga manual). A partir de ahí, cada versión se instala sola.

La siguiente función nueva vuelve a empezar en `develop`.

---

## Configuración

### Configuración Tauri (`src-tauri/tauri.conf.json`)
- **App identifier:** `com.gus.desktop`
- **Dev URL:** `http://localhost:1420`
- **Frontend dist:** `../dist`
- **CSP:** activa en `tauri.conf.json`: `script-src 'self' 'wasm-unsafe-eval'` (Hunspell), `connect-src` con `data:`, `blob:` e IPC de Tauri (pdf.js carga el PDF con `fetch`), y `style-src 'unsafe-inline'` por los estilos de React. Verificada con `pnpm bench:app` en Chromium; falta probarla en `pnpm tauri dev` antes de cada release.
- **Bundle targets:** todas las plataformas

### Archivo de configuración de la app (creado en runtime, depende del SO)
- **Windows:** `%APPDATA%/gus/config.json`
- **macOS:** `~/Library/Application Support/gus/config.json`
- **Linux:** `$XDG_CONFIG_HOME/gus/config.json` o `~/.config/gus/config.json`

### Ubicación del vault
`~/Documents/gus-vaults` (default, configurable por el usuario)

### Variables de entorno usadas
- `HOME` / `USERPROFILE` -- resolución de directorio home
- `XDG_CONFIG_HOME` -- override de directorio de config en Linux
- `APPDATA` -- directorio de config en Windows

**No se requiere archivo `.env` ni configuración basada en entorno.** Todas las configuraciones se guardan en el archivo JSON de config.

---

## Convenciones de Código

### Patrones Frontend
- **Componentes funcionales con hooks** — sin componentes de clase
- **Custom hooks** para lógica reutilizable (ej: `useResolvedImage`)
- **Lazy loading** vía `React.lazy` + `Suspense` para componentes pesados (PdfViewer, MermaidDiagram)
- **Framer Motion** con `LazyMotion` + `domMax` para animaciones tree-shakeables
- **Botones** — clases `gus-btn` + `gus-btn-primary|secondary|icon|ghost`, altura única de 28 px. Excepciones: la barra lateral (su altura viene de la etiqueta), los filtros (`aria-pressed`) y los interruptores (`role="switch"`). `pnpm bench:botones` (con `vite --port 5199`) falla si algún botón mide menos de 28 px.
- **CSS custom properties** para tematización (7 temas vía variables `--color-gus-*`)
- **Tailwind CSS 4** con directiva `@theme` para design tokens
- **i18n vía React context** — `I18nProvider` envuelve la app, hook `useT()` para traducciones
- **Tauri IPC** vía `invoke("command_name", { args })` — toda la comunicación con el backend pasa por comandos tipados
- **localStorage** para preferencias de UI (tema, ancho de sidebar, estado de tour, updates descartados)
- **Patrón Ref** para valores mutables que necesitan ser accedidos en callbacks estables (ej: `dragDropRef`)
- **useEffectEvent** (React 19) para handlers de eventos estables sin re-registrar listeners

### Patrones Backend
- **Comandos Tauri** — todas las funciones anotadas con `#[tauri::command]`
- **Serde** para serialización JSON con `#[serde(rename_all = "camelCase")]` para compatibilidad con JS
- **Manejo de errores** vía `Result<T, String>` — los errores son strings enviados al frontend
- **Expansión de directorio home** — rutas `~` y `~/` resueltas vía `expand_home()`
- **Validación de tipo de archivo** — allowlist estricto (`.md`, `.pdf`, solo imágenes)
- **Sistema de papelera** — papelera por vault en `<vault>/.gus-trash` con TTL de 30 días y manifiesto JSON. `move_to_trash` solo acepta elementos dentro del vault indicado
- **Generación de rutas únicas** — `unique_path()` añade `-2`, `-3`, etc. para evitar sobrescrituras
- **Codificación/decodificación Base64** — implementación personalizada para transferencia de imagen/PDF al frontend

### Patrones de Testing
- **Vitest** con archivos `.test.ts` co-located
- **Testing de funciones puras** — los tests se enfocan en módulos de utilidades (settings, shortcuts, tables, i18n, etc.)
- **Sin tests de componentes** — los 15 archivos de test son para utilidades lib

### Estilo de Código
- **TypeScript estricto** (`strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`)
- **Comentarios en español** — comentarios de código y documentación en español
- **Nombres descriptivos** — nombres de funciones/variables verbosos pero claros
- **Comentarios estilo JSDoc** para APIs públicas

---

## Insights Arquitectónicos Clave

1. **El backend Rust es una capa de sistema de archivos delgada** — maneja todas las operaciones de archivos del vault (CRUD, importación, papelera, thumbnails, lectura PDF) y nada más. Toda la lógica de negocio vive en TypeScript.

2. **El editor es personalizado** — `MarkdownEditor.tsx` usa un `<textarea>` transparente con un overlay renderizado para resaltado de sintaxis, en lugar de una librería como CodeMirror o Monaco. Esto da control total sobre la experiencia de edición.

3. **La tematización es exhaustiva** — 7 temas integrados (incluyendo Dracula, Nord, Solarized) con CSS custom properties, esquemas claro/oscuro y 4 opciones de color de acento.

4. **La internacionalización es de primera clase** — Español e inglés con soporte de reglas de plural, detección de idioma desde `navigator.language` y cadenas de fallback.

5. **El sistema de papelera es personalizado** — no es la papelera del SO, sino una carpeta `.gus-trash` dentro de cada vault con manifiesto JSON, TTL de 30 días y capacidad de restauración. Las versiones anteriores usaban una papelera global en `~/gus-vault/.gus-trash`; al arrancar, `migrate_legacy_trash` pasa a cada vault lo que era suyo.

6. **Las actualizaciones nunca bloquean ni se instalan sin permiso** — al iniciar, la app mira GitHub sin frenar el arranque. Donde puede actualizarse sola (`can_self_update`: AppImage, Windows, macOS), descarga la versión firmada en segundo plano con barra de progreso, pero **no la instala hasta que el usuario pulsa «Reiniciar y actualizar»**. En `.deb`/`.rpm` queda el aviso manual: la descarga solo ocurre si el usuario pulsa «Descargar» y respeta las versiones descartadas.

---

## Modelo de amenaza

Gus es una app local: el usuario elige sus vaults y el backend confía en las rutas que le llegan. Los comandos Tauri aceptan rutas absolutas (y `~`) sin limitar el directorio, porque el vault puede estar en cualquier carpeta del usuario. Eso es diseño, no un descuido.

**Protecciones que existen:**
- **Notas:** leer, crear y escribir notas exige extensión `.md` (`ensure_md`). Renombrar, mover y borrar solo admite tipos que el explorador muestra: notas, imágenes y PDF (`ensure_entry`).
- **Papelera:** `move_to_trash` solo acepta elementos que cuelguen del vault indicado (`ensure_in_vault`). La papelera de cada vault no puede tirarse dentro de sí misma.
- **Actualizaciones:** el actualizador solo instala lo que verifica con la clave pública incrustada (`plugins.updater.pubkey`); un archivo con otra firma se rechaza. Su endpoint está fijado en `tauri.conf.json`. La descarga manual (`download_update`) solo baja de `github.com/victorrubilar-dev/gus/releases/download/` y solo ficheros con extensión de instalador.
- **Render:** el contenido de las notas se escapa; Prism escapa el código resaltado.

**Lo que no se protege:**
- **Una nota que consiguiera ejecutar script** tendría acceso a todos los comandos IPC. La CSP de `tauri.conf.json` reduce ese riesgo, pero `script-src` permite `'wasm-unsafe-eval'`, no `unsafe-eval`, y el resto del modelo sigue confiando en la webview.
- **El backend no conoce la lista de vaults.** Por eso `move_to_trash` comprueba «dentro del vault indicado» y no «dentro de un vault registrado».
- **Lectura de rutas arbitrarias:** `read_vault_image`, `read_vault_pdf` y `read_vault_dir` no limitan el directorio.

---

## Notas Adicionales

- **Extensiones VS Code recomendadas:** `tauri-apps.tauri-vscode`, `rust-analyzer.rust-analyzer`
- **El archivo `task/` está en `.gitignore`** — es para notas personales de desarrollo
- **Las únicas requests de red** son a GitHub y solo sirven para actualizar: el manifiesto `latest.json` de las releases (plugin updater) o la API de releases (`.deb`/`.rpm`), la descarga automática y firmada de la versión nueva donde la app puede actualizarse sola, y, solo si el usuario lo pide, la descarga manual del instalador (`download_update` en `lib.rs`). Cualquier red nueva exige cambiar antes `PRIVACY.md` y este archivo.
- **Las notas nunca salen del equipo del usuario** — no hay sincronización, no hay backup en la nube
