# Gus 🐾

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB.svg)](https://tauri.app/)
[![Made with](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)

**Gus** es una app de escritorio para **notas y tareas**, 100 % local y en Markdown.
Sin nube, sin cuentas: todo vive en archivos `.md` dentro de una carpeta tuya.

Es rápida y liviana porque usa [Tauri v2](https://tauri.app/) (backend en Rust + el
WebView del sistema en lugar de meter un Chromium entero).

---

## ✨ Qué puede hacer

- 📝 **Notas en Markdown** — explorador de carpetas, crear / renombrar / mover / borrar
  notas, y un editor con autoguardado (medio segundo después de dejar de escribir).
- 🖼️ **Visor de imágenes** — png, jpg, gif, webp, svg… aparecen en el explorador y se
  abren con un clic en pantalla completa.
- ✅ **Tareas dentro de las notas** — las tareas son líneas `- [ ]` / `- [x]` en los
  mismos `.md`: créalas, márcalas como hechas y clasícalas con varias etiquetas
  `#por #tarea`.
- 🗂️ **Carpetas reales** — navega con migaja de pan (breadcrumb), crea carpetas y
  renombra o borra archivos **y** carpetas con menú contextual (clic derecho o botón ⋮
  al pasar el ratón).
- 🏠 **Local-first** — el *vault* por defecto es `~/gus-vault`, una carpeta normal:
  puedes abrirla con Obsidian, sincronizarla con git o rsync, o editarla a mano.

---

## 🛠 Tecnologías

| Capa      | Stack                                          |
| --------- | ---------------------------------------------- |
| Escritorio | [Tauri v2](https://tauri.app/) + [Rust](https://www.rust-lang.org/) |
| UI        | [React 19](https://react.dev/) + TypeScript     |
| Estilos   | [Tailwind CSS v4](https://tailwindcss.com/)     |
| Animaciones | [Framer Motion](https://www.framer.com/motion/) |
| Iconos    | [Lucide](https://lucide.dev/)                   |

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

---

## 📂 Cómo se organizan las tareas

Las tareas usan el formato de listas de Markdown, así que funcionan incluso si
editas el archivo a mano con otra herramienta:

```markdown
## Tareas

- [ ] Comprar pan #casa
- [x] Enviar el informe #trabajo #urgente
```

En la pestaña **Tareas** de la app puedes: añadir tareas nuevas, marcarlas con el
checkbox, y añadir o quitar etiquetas `#varias #por #tarea` desde cada fila.

---

## 🗃 Estructura del proyecto

```
gus/
├─ src/                     # Frontend (React + TypeScript)
│  ├─ App.tsx               # Shell de la app: pestañas Notas / Tareas
│  ├─ App.css               # Tema oscuro (variables Tailwind v4)
│  ├─ components/
│  │  ├─ FileExplorer.tsx   # Explorador: carpetas, notas, imágenes, menús
│  │  ├─ MarkdownEditor.tsx # Editor con autoguardado y renombrado
│  │  └─ TaskList.tsx       # Lista de tareas con etiquetas
│  └─ lib/
│     ├─ fileName.ts        # Utilidades de rutas y nombres
│     └─ markdownTasks.ts   # Lee y edita líneas - [ ] / - [x]
├─ src-tauri/               # Backend (Rust)
│  └─ src/lib.rs            # Comandos: leer, escribir, renombrar, borrar…
├─ index.html
├─ package.json
└─ vite.config.ts
```

---

## 🧪 Verificación

```bash
cd src-tauri && cargo test --lib   # tests de Rust (19)
cd src-tauri && cargo clippy --all-targets
npx tsc --noEmit                   # tipos de TypeScript
pnpm build                         # build completo
```

---

## 📄 Licencia

Distribuido bajo la licencia [MIT](LICENSE) — mira el archivo [LICENSE](LICENSE)
para más detalles.
