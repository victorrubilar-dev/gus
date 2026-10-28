# CLAUDE.md

Resumen operativo para trabajar en **Gus**. El detalle completo está en `AGENTS.md`; los pendientes y fallos conocidos, en `rework.md`.

## Qué es

App de escritorio **local-first** para notas Markdown y tareas personales. Tauri v2 (Rust) + React 19 + TypeScript. Idioma principal: español (con inglés).

- Sin nube, sin cuentas, sin telemetría. Las únicas peticiones de red van a GitHub: la comprobación de versión (`src/lib/updateCheck.ts`) y la descarga del instalador que el usuario pide (`download_update` en `lib.rs`).
- Las notas son `.md` dentro de un vault elegido por el usuario. Las tareas van en `.gus-tasks.json` dentro del vault.
- Si algo añade red, cuentas o datos fuera del equipo, hay que cambiar antes `PRIVACY.md` y `AGENTS.md`.

## Comandos

```bash
pnpm install
pnpm tauri dev            # Vite en :1420 + ventana Tauri
pnpm build                # tsc + vite build
pnpm test                 # Vitest: 195 tests en 15 ficheros
npx tsc --noEmit
cd src-tauri && cargo test   # Rust: 66 tests (en lib.rs)
```

Benchmarks: `pnpm bench`, `pnpm bench:menu`, `pnpm bench:images`, `pnpm bench:explorer`, `pnpm traza` (Playwright, en `bench/`).

## Arquitectura

- **Backend** `src-tauri/src/lib.rs` (~5.200 líneas, todos los comandos). Es una capa fina de sistema de archivos: CRUD del vault, importación, papelera, miniaturas, lectura de PDF, índice de búsqueda. La lógica de negocio vive en TypeScript.
- **Frontend** `src/`:
  - `App.tsx`: raíz (vaults, pestañas, drag & drop).
  - `components/MarkdownEditor.tsx`: editor propio (un `<textarea>` transparente sobre un overlay renderizado). No usa CodeMirror ni Monaco.
  - `lib/`: utilidades puras, con test `.test.ts` junto al fichero.
  - `lib/i18n/`: catálogos `locales/es.ts` y `locales/en.ts`. `i18n.test.ts` comprueba que las claves coincidan.
- **IPC**: `invoke("comando", { args })`. Los errores son `Result<T, String>`. Los structs usan `#[serde(rename_all = "camelCase")]`.
- **Vault**: notas `.md`, tareas `.gus-tasks.json`, índice de búsqueda `.gus-index/`.
- **Papelera**: `<vault>/.gus-trash` con manifiesto JSON y TTL de 30 días. `move_to_trash` rechaza lo que esté fuera del vault. La global de versiones anteriores se migra al arrancar (`migrate_legacy_trash`).
- **Temas**: 7 temas vía variables CSS `--color-gus-*`.
- **Carga diferida**: `PdfViewer` y `MermaidDiagram` se cargan con `React.lazy`.

## Convenciones

- Componentes funcionales con hooks. Animaciones con `LazyMotion` + `domMax` (Framer Motion).
- TypeScript estricto: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- Comentarios y textos de UI en español.
- Nunca `innerHTML` con contenido del usuario sin escapar. Prism ya escapa el código resaltado.
- Tests: solo para utilidades de `lib/`. No hay tests de componentes.

## Git y releases

- **Trabajo en `develop`**. `main` solo avanza en una release, porque el verificador de actualizaciones lee las releases de GitHub.
- Commits convencionales en español (`feat(scope):`, `fix(scope):`, `chore(scope):`, `docs:`).
- Nunca `git add -A`. Se listan los ficheros del cambio.
- Antes de cerrar un commit: `npx tsc --noEmit`, `pnpm test` y `pnpm build` en verde.
- Release (resumen; el guion completo está en `AGENTS.md`): merge a `main`, subir la versión en `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` y `AGENTS.md`, reescribir `.github/release-notes.md`, tag ligero `vX.Y.Z`, publicar el draft de GitHub como pre-release y volver a poner `develop` al día.
- `task/` está en `.gitignore`. Contiene requisitos y notas de desarrollo: no se commitea.

## Cosas que conviene saber antes de tocar nada

- `AGENTS.md` tiene cifras desactualizadas (líneas de `lib.rs`, número de tests, lista de componentes). No las uses como referencia exacta.
- La CI es un único workflow, `.github/workflows/release.yml`, que se dispara con cada tag `v*`: primero tests (`tsc`, `pnpm test`, `cargo test`) y comprobación de que el tag coincide con `package.json`; luego compila, firma (si hay secrets) y deja el draft. Ver `rework.md`.
- El CSP está deshabilitado (`src-tauri/tauri.conf.json`), y `move_to_trash` acepta cualquier ruta. Tratar esas zonas con cuidado.
