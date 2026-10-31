# CLAUDE.md

Resumen operativo para trabajar en **Gus**. El detalle completo está en `AGENTS.md`; los pendientes y fallos conocidos, en `rework.md`.

## Qué es

App de escritorio **local-first** para notas Markdown y tareas personales. Tauri v2 (Rust) + React 19 + TypeScript. Idioma principal: español (con inglés).

- Sin nube, sin cuentas, sin telemetría. Las únicas peticiones de red van a GitHub y solo sirven para actualizar: el manifiesto `latest.json` de las releases (plugin updater, `src/lib/selfUpdate.ts`) o la API de releases en `.deb`/`.rpm` (`src/lib/updateCheck.ts`), la descarga automática **firmada** de la versión nueva (AppImage, Windows, macOS; no se instala hasta que el usuario pulsa «Reiniciar y actualizar») y la descarga manual del instalador que el usuario pide (`download_update` en `lib.rs`).
- Las notas son `.md` dentro de un vault elegido por el usuario. Las tareas van en `.gus-tasks.json` dentro del vault.
- Si algo añade red, cuentas o datos fuera del equipo, hay que cambiar antes `PRIVACY.md` y `AGENTS.md`.

## Comandos

```bash
pnpm install
pnpm tauri dev            # Vite en :1420 + ventana Tauri
pnpm build                # tsc + vite build
pnpm test                 # Vitest: 316 tests en 33 ficheros
npx tsc --noEmit
cd src-tauri && cargo test   # Rust: 79 tests
```

Benchmarks (Playwright, en `bench/`; casi todos necesitan `npx vite --port 5199` en marcha): `pnpm bench`, `bench:menu`, `bench:images`, `bench:explorer`, `bench:app`, `bench:botones`, `bench:medida`, `bench:pestanas`, `bench:foco`, `bench:corrector`, `bench:portapapeles`, `bench:tablas`, `bench:cursor`, `bench:operaciones` (explorador: crear, renombrar, mover, arrastrar, borrar, ruta), `bench:vaults`, `bench:soltar`, `bench:tareas` (drop nativo de Tauri simulado) y `bench:regresion` (capturas contra `bench/linea-base/`, de esta máquina; `--actualizar` tras un cambio visual aceptado). `pnpm traza` aparte.

## Arquitectura

- **Backend** `src-tauri/src/`: `lib.rs` (~780 líneas: utilidades, `run()` y los comandos de actualización) más un módulo por área (`archivos`, `listados`, `papelera`, `busqueda`, `tareas`, `biblioteca`, `habitos`, `pizarras`, `vigilancia`…). Es una capa fina de sistema de archivos: CRUD del vault, importación, papelera, miniaturas, lectura de PDF, índice de búsqueda, almacenes JSON y un watcher de cambios externos. La lógica de negocio vive en TypeScript.
- **Frontend** `src/`:
  - `App.tsx`: raíz (~820 líneas). Solo compone: el estado vive en hooks de `components/` (`useVaults`, `useOpenEntries`, `useFileDrop`, `useAppUpdates`, `useGlobalShortcuts`…) y la barra lateral en `Sidebar`.
  - `components/FileExplorer.tsx` (~1.000 líneas): estado y operaciones; la interfaz vive en `Explorer*` (cabecera, ruta, filas, menú) y la ruta/historial en `lib/explorerTrail.ts` (puro, con tests).
  - `components/MarkdownEditor.tsx`: editor propio (un `<textarea>` transparente sobre un overlay renderizado). No usa CodeMirror ni Monaco.
    Partido en `EditorPreview`, `EditorHeader`, `NoteTagBar` y los hooks `useEditorImages`, `useEditorSpell`, `useEditorClipboard`, `useEditorHistory`, `useTableKeyboard`, `useTableResize`, `useTableActions`, `usePointerEvents`, `useEditorKeyboard`, `useEditorContextMenu`, `useCaretTracking`, `useNotePersistence`, `useBlockDrift` y `useFrozenTableWidths` (~1.450 líneas el editor). Cada hook recibe sus dependencias en un objeto tipado; lo que queda en el editor es el estado y el núcleo de edición (`editContent`, `editBody`, `replaceRange`, `handleCaretMove`). No cortar sin `bench`, `bench:tablas` y `bench:cursor` en verde.
  - `lib/`: utilidades puras, con test `.test.ts` junto al fichero.
  - `lib/i18n/`: catálogos `locales/es.ts` y `locales/en.ts`. `i18n.test.ts` comprueba que las claves coincidan.
- **IPC**: `invoke("comando", { args })`. Los errores son `Result<T, String>`. Los structs usan `#[serde(rename_all = "camelCase")]`.
- **Vault**: notas `.md`, tareas `.gus-tasks.json`, índice de búsqueda `.gus-index/`, estanterías de PDF `.gus-library.json`, hábitos `.gus-habits.json` y pizarras `.gus-boards/<id>.json`. El watcher (`vigilancia.rs`) ignora lo oculto salvo `.gus-tasks.json` y descarta las escrituras propias (`note_own_write`): todo comando nuevo que escriba en el vault debe llamarla.
- **Papelera**: `<vault>/.gus-trash` con manifiesto JSON y TTL de 30 días. `move_to_trash` rechaza lo que esté fuera del vault. La global de versiones anteriores se migra al arrancar (`migrate_legacy_trash`).
- **Temas**: 7 temas vía variables CSS `--color-gus-*`.
- **Carga diferida**: `PdfViewer`, `MermaidDiagram` y `LibraryView` se cargan con `React.lazy`.
- **Zoom de interfaz**: la app escala con `zoom` CSS en `<html>`, así que las coordenadas de eventos (px de pantalla) no coinciden con las locales de un SVG o un menú. Para eso, `toLocalCoord` o, como en la pizarra, medir la razón rect/ancho de layout.

## Convenciones

- Componentes funcionales con hooks. Animaciones con `LazyMotion` + `domMax` (Framer Motion).
- TypeScript estricto: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.
- Comentarios y textos de UI en español.
- Nunca `innerHTML` con contenido del usuario sin escapar. Prism ya escapa el código resaltado.
- Tests: solo para utilidades de `lib/`. No hay tests de componentes.

## Git y releases

- **Trabajo en `develop`**. `main` solo avanza en una release, porque el actualizador lee las releases de GitHub.
- Commits convencionales en español (`feat(scope):`, `fix(scope):`, `chore(scope):`, `docs:`).
- Nunca `git add -A`. Se listan los ficheros del cambio.
- Antes de cerrar un commit: `npx tsc --noEmit`, `pnpm test` y `pnpm build` en verde.
- Release (resumen; el guion completo está en `AGENTS.md`): merge a `main`, subir la versión en `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` y `AGENTS.md`, reescribir `.github/release-notes.md`, tag ligero `vX.Y.Z`, publicar el draft de GitHub **como release normal, no pre-release** (el actualizador lee `releases/latest/download/latest.json` y GitHub ignora ahí las pre-releases) y volver a poner `develop` al día.
- `task/` está en `.gitignore`. Contiene requisitos y notas de desarrollo: no se commitea.

## Cosas que conviene saber antes de tocar nada

- `AGENTS.md` tiene cifras desactualizadas (líneas de `lib.rs`, número de tests, lista de componentes). No las uses como referencia exacta.
- La CI es un único workflow, `.github/workflows/release.yml`, que se dispara con cada tag `v*`: primero tests (`tsc`, `pnpm test`, `cargo test`) y comprobación de que el tag coincide con `package.json`; luego compila y firma los instaladores para el actualizador (exige el secret `TAURI_SIGNING_PRIVATE_KEY`; la clave vive en `~/.tauri/gus.key`, nunca en el repo), firma Windows con SignPath si hay secrets, genera `latest.json` (`scripts/update-manifest.mjs`) y deja el draft. Un build local con `pnpm tauri build` también necesita esa clave en el entorno. El crate `tauri-plugin-updater` y su paquete npm deben coincidir en mayor.menor. Ver `AGENTS.md` y `rework.md`.
- La CSP está activa en `src-tauri/tauri.conf.json`. Si se toca, probar PDF (pdf.js), Mermaid y el corrector con `pnpm bench:app`. `move_to_trash` solo acepta rutas dentro del vault indicado. Tratar esas zonas con cuidado.
