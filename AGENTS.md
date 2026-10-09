# AGENTS.md 

> **Instrucción para el modelo:** Este archivo proporciona todo el contexto necesario para entender, modificar y contribuir al proyecto **Gus**. Léelo completo antes de realizar cualquier cambio.

---

## ¿Qué es Gus?

**Gus** es una aplicación de escritorio **100% local-first** para tomar notas en Markdown y gestionar tareas personales. Está construida con **Tauri v2** (backend en Rust + frontend en React/TypeScript).

**Principios fundamentales:**
- **Privacidad absoluta:** Sin nube, sin cuentas, sin telemetría.
- **Las notas son archivos `.md`** en una carpeta elegida por el usuario ("vault").
- **Las tareas** se guardan en un JSON oculto (`.gus-tasks.json`) dentro de cada vault.
- **Idioma principal:** Español (con i18n a inglés integrado).

**Repositorio:** https://github.com/victorrubilar-dev/gus  
**Licencia:** GPL-3.0-or-later  
**Versión:** 0.1.2

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

### Backend (Rust)
| Tecnología | Uso |
|---|---|
| Tauri 2 | Framework de app de escritorio |
| serde / serde_json | Serialización |
| image 0.25 | Thumbnails para el selector de imágenes |
| tauri-plugin-dialog | Diálogos nativos de archivos |
| tauri-plugin-clipboard-manager | Acceso al portapapeles |
| tauri-plugin-opener | Abrir enlaces externos |

### Testing
| Tecnología | Uso |
|---|---|
| Vitest 5 | Tests unitarios (114 tests) |
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
│   ├── components/               # 24 componentes React
│   │   ├── MarkdownEditor.tsx    # Editor central (textarea + overlay renderizado)
│   │   ├── FileExplorer.tsx      # Árbol de archivos del vault (crear/renombrar/mover/eliminar)
│   │   ├── CommandPalette.tsx    # Búsqueda/ apertura rápida de notas (cmdk)
│   │   ├── DashboardView.tsx     # Pestaña de inicio
│   │   ├── TaskList.tsx          # Vista de lista de tareas
│   │   ├── KanbanBoard.tsx       # Tablero Kanban para tareas
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
│   │   ├── Tour.tsx              # Tour de onboarding guiado
│   │   ├── UpdateNotice.tsx     # Banner de nueva versión disponible
│   │   ├── ThemeCard.tsx         # Tarjeta de vista previa de tema
│   │   ├── DatePicker.tsx        # Componente de entrada de fecha
│   │   └── CopyCodeButton.tsx    # Botón copiar para bloques de código
│   ├── lib/                      # 30+ módulos de utilidades
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
│   │   ├── updateCheck.ts        # Verificación de versión en GitHub releases
│   │   └── version.ts            # Versión de la app desde package.json
│   ├── assets/                   # Iconos (gus-icon.png, react.svg)
│   └── types/                    # Declaraciones TypeScript
│       └── prism-components.d.ts
├── src-tauri/                    # Backend Rust
│   ├── src/
│   │   ├── main.rs               # Punto de entrada (6 líneas)
│   │   └── lib.rs                # ~1700 líneas: todos los comandos Tauri
│   ├── Cargo.toml                # Dependencias Rust
│   ├── tauri.conf.json           # Configuración Tauri
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
├── bench/                        # Benchmarks de rendimiento (Playwright)
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
pnpm test              # Todos los tests Vitest (114 tests)
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

## Configuración

### Configuración Tauri (`src-tauri/tauri.conf.json`)
- **App identifier:** `com.gus.desktop`
- **Dev URL:** `http://localhost:1420`
- **Frontend dist:** `../dist`
- **CSP:** `null` (deshabilitado)
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
- **Sistema de papelera** — papelera personalizada en `~/gus-vault/.gus-trash` con TTL de 30 días y manifiesto JSON
- **Generación de rutas únicas** — `unique_path()` añade `-2`, `-3`, etc. para evitar sobrescrituras
- **Codificación/decodificación Base64** — implementación personalizada para transferencia de imagen/PDF al frontend

### Patrones de Testing
- **Vitest** con archivos `.test.ts` co-located
- **Testing de funciones puras** — los tests se enfocan en módulos de utilidades (settings, shortcuts, tables, i18n, etc.)
- **Sin tests de componentes** — los 8 archivos de test son para utilidades lib

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

5. **El sistema de papelera es personalizado** — no es la papelera del SO, sino una carpeta `.gus-trash` dentro de la base del vault con manifiesto JSON, TTL de 30 días y capacidad de restauración.

6. **La verificación de actualizaciones es no intrusiva** — verifica la API de releases de GitHub al iniciar, nunca bloquea la app y respeta las versiones descartadas.

---

## Notas Adicionales

- **Extensiones VS Code recomendadas:** `tauri-apps.tauri-vscode`, `rust-analyzer.rust-analyzer`
- **El archivo `task/` está en `.gitignore`** — es para notas personales de desarrollo
- **La única request de red** es a la API de GitHub para verificar actualizaciones (no es obligatoria, se puede descartar)
- **Las notas nunca salen del equipo del usuario** — no hay sincronización, no hay backup en la nube
