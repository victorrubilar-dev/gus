# Rework — Gus

Auditoría del proyecto completo (código, docs, CI y `task/`). Base: `main` en `a135734` (`chore(release): v0.1.4`, publicada como pre-release).

**Verificado (último cambio, papelera por vault):**
- `npx tsc --noEmit`: sin errores.
- `pnpm test`: 15 ficheros, 195 tests, todos en verde.
- `cargo test` (`src-tauri`, cargo 1.99.0): 68 tests en verde, 0 warnings.
- Benches Playwright (`pnpm bench`, `bench:menu`, `bench:images`, `bench:explorer`) y `pnpm bench:app` (incluye CSP): todos en verde.
- `pnpm build`: en verde (aviso de tamaño de chunk, no es error).
- `react-doctor` y la app en marcha: no ejecutados.

Formato: `[ ]` pendiente · `[x]` hecho. IDs estables (`R-`, `D-`, `C-`, `T-`, `P-`, `Q-`) para referenciarlos en commits.

---

## R — Riesgos de seguridad y datos (primero)

- [x] **R-01 Papelera global, no por vault.** *Decidido y hecho: papelera por vault (`<vault>/.gus-trash`). La global de versiones anteriores se migra al arrancar (`migrate_legacy_trash`, lo que sea de cada vault se pasa a su papelera y lo demás se queda). Comandos de papelera reciben `vault`.* `src-tauri/src/lib.rs:506` fija `trash_dir()` a `~/gus-vault/.gus-trash`. Todos los vaults comparten esa carpeta y queda fuera de `~/Documents/gus-vaults`. La UI (`src/lib/i18n/locales/es.ts:794,796`) ya dice esa ruta, pero `AGENTS.md:332` la describe como personalizada y `AGENTS.md:359` como "dentro de la base del vault". Decidir: papelera por vault (`<vault>/.gus-trash`, con migración de lo que haya en `~/gus-vault`) o documentar la global. Hoy AGENTS se contradice.
- [x] **R-02 `move_to_trash` no valida la ruta.** *Hecho: `move_to_trash(path, vault)` exige que el elemento cuelgue del vault indicado (`ensure_in_vault`, mirando la carpeta padre canonicalizada). Límite honesto: el backend no conoce la lista de vaults, así que un IPC malicioso puede elegir cualquier vault. Lo que cierra eso de verdad es R-03 (CSP).* `lib.rs:708` solo hace `expand_home`. `trash_entry_if_safe` (`lib.rs:721`) comprueba que no sea la papelera, pero no que esté dentro de un vault ni que sea `.md`/`.pdf`/imagen. Cualquier comando IPC puede mover a la papelera cualquier fichero del usuario. Requisito: exigir que la ruta esté dentro de un vault conocido.
- [x] **R-03 CSP deshabilitada.** `src-tauri/tauri.conf.json:21` tiene `"csp": null`. Con notas de texto arbitrario, una CSP mínima reduce el impacto de un fallo de render. Hay que probar el visor PDF (worker de pdf.js) y Mermaid con la CSP activa. *Hecha: CSP activa en `tauri.conf.json`. Probada con `pnpm bench:app` (PDF, Mermaid, corrector WASM, eval) en Chromium. Pendiente: una prueba en `pnpm tauri dev` antes de publicar, porque el arnés finge el IPC.*
- [x] **R-04 Fallos del manifiesto de papelera ignorados.** `lib.rs:648, 701, 871, 893` usan `let _ = save_trash_manifest(...)`. Si la escritura falla, manifiesto y ficheros reales quedan desincronizados y la restauración falla en silencio. Propagar con `?` o, como mínimo, registrar el error. (`lib.rs:474` es `remove_file` y se puede dejar, pero conviene revisar que no oculte nada.)
- [x] **R-05 Modelo de amenaza sin documentar.** Los comandos aceptan rutas absolutas arbitrarias (`read_vault_dir`, `read_vault_pdf`, `write_vault_file`). `ensure_md` limita la extensión, pero no el directorio. Puede ser diseño intencionado (el usuario elige el vault), pero hay que escribirlo en `AGENTS.md` y decidir si `ensure_inside` debe aplicarse a todas las rutas del vault. *Modelo de amenaza escrito en `AGENTS.md`. La decisión de fondo (rutas absolutas sin límite) se mantiene: es diseño, y el riesgo real es R-03.*
- [x] **R-06 Traza de depuración en producción.** `src/components/MarkdownEditor.tsx:322-345`: función `traza` que hace `fetch` a `http://127.0.0.1:5198/log`. Está apagada por defecto (localStorage `gus-tables-log` o `VITE_TRAZA_TABLAS`), pero es código de depuración en la build de usuario. Su comentario habla de `/tmp/gus-tables.log` y de `--traza-tablas`, que ya no existen. Quitarla o moverla a un módulo solo de desarrollo.

## D — Documentación desactualizada

- [x] **D-01 Enlace roto en README.** `README.md:39` apunta a `github.com/korossuh/gus/releases`. El repo es `victorrubilar-dev/gus` (lo confirman `package.json`, `PRIVACY.md` y `src/lib/version.ts`).
- [x] **D-02 Recuento de tests.** `AGENTS.md:58,205` y `README.md:57` dicen 114 tests. Hay 189 en 14 ficheros.
- [x] **D-03 Tamaño de `lib.rs`.** `AGENTS.md:143` dice ~1700 líneas. Son 5.193.
- [x] **D-04 Componentes.** `AGENTS.md:74` dice "24 componentes". Hay 28 `.tsx` en `src/components/`. El árbol de `AGENTS.md` no incluye `GraphView.tsx`, `BacklinksPanel.tsx`, `SearchView.tsx` ni `DailyNoteBar.tsx`. *Hecho en `AGENTS.md` (árbol, stack y papelera).*
- [x] **D-05 `lib/` incompleto.** El árbol de `AGENTS.md` no menciona `linkGraph`, `graphLayout`, `searchIndex`, `dailyNotes` ni `notifications`. *Hecho en `AGENTS.md` (árbol, stack y papelera).*
- [x] **D-06 Índice de búsqueda y tareas.** `AGENTS.md` no menciona `.gus-index/` (`lib.rs:2205`) ni la pestaña Buscar. *Hecho en `AGENTS.md` (árbol, stack y papelera).*
- [x] **D-07 Stack.** `AGENTS.md:45-53` no incluye `tauri-plugin-notification` (en `Cargo.toml` y `package.json`). *Hecho en `AGENTS.md` (árbol, stack y papelera).*
- [x] **D-08 Tests de componentes.** `AGENTS.md:339` dice "los 8 archivos de test". Son 14.
- [x] **D-09 `task/mejoras-claude.md` tiene afirmaciones incorrectas.** *Retirado: movido a `task/archivo/` (sus puntos ya están en `rework.md`).* Corregir o retirar antes de usarlo como base:
  - Dice que hay 1 `#[test]` en Rust. Hay 65 (`lib.rs`, bloques en las líneas ~3026 y ~5015).
  - Dice 13 `console.*` en `src`. Hay 0.
  - Dice 3 `as any`/`@ts-ignore`/`eslint-disable`. Hay 0 `as any`/`@ts-ignore` y 16 `eslint-disable`.
  - Dice que `i18n.test.ts` no comprueba paridad de claves. Sí la comprueba (`src/lib/i18n/i18n.test.ts:20,27`).
- [x] **D-10 `task/fix-fedora.md`.** La ruta de la captura es `task/.screenshots/FIX-01.png`, pero la carpeta real es `task/screenshots/`. *Hecho en `AGENTS.md` (árbol, stack y papelera).*
- [x] **D-11 README "Desarrollo".** Usa `npx vite build` y `npx vitest run`, mientras `AGENTS.md` usa `pnpm build`/`pnpm test`. Unificar.
- [x] **D-12 Versión de `AGENTS.md`.** Tras esta auditoría, `AGENTS.md` debe reflejar la realidad. Hacerlo en un commit `docs:` aparte. *Hecho en `AGENTS.md` (árbol, stack y papelera).*

## C — CI y release

- [x] **C-01 Dos workflows con el mismo disparador.** Borrado `build.yml`; queda solo `release.yml`. *Hecho: el borrado cubre C-01, C-02 y C-03. Sin probar en GitHub todavía.*
- [x] **C-02 Versiones distintas de pnpm.** `release.yml` usa pnpm 10 (la versión local, lockfile v9). Único workflow, así que no hay desalineación.
- [x] **C-03 Plataformas distintas.** Resuelto al borrar `build.yml`. `release.yml` (deb, rpm, AppImage, nsis, msi, dmg) es la única definición.
- [x] **C-04 La CI no ejecuta tests.** Nuevo job `test` en `release.yml` (`tsc --noEmit`, `pnpm test`, `cargo test`); `build` tiene `needs: test`. *Los comandos se han ejecutado en local; el job en GitHub no.*
- [x] **C-05 Versión en 5 ficheros a mano.** `src/lib/version.test.ts` compara `package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock` y `AGENTS.md`. Además, `release.yml` falla si el tag no coincide con `package.json`. *Verificado en local (4 tests); el chequeo del tag en GitHub no se ha probado.*
- [ ] **C-06 Windows sin firmar. En pausa (externo).** SignPath no ha aceptado la solicitud por falta de usuarios, así que no se puede de momento. El job `sign-windows` solo actúa si existen los secrets de SignPath, y no están configurados. El README (`README.md:41-49`) describe SmartScreen como algo permanente. Cuando se active la firma, actualizar el README. Falta: cuenta de SignPath y los cuatro secrets.
- [x] **C-07 Actualización desde la app (`task/mejoras.md`). Descarga asistida.** Decidido: el botón «Descargar y abrir el instalador» baja el instalador de la plataforma a Descargas (`download_update` en `lib.rs`, solo URLs de `releases/download/`) y lo abre. Política actualizada antes en `PRIVACY.md`, `AGENTS.md` y `CLAUDE.md`. Sin release con instalador (solo etiqueta), queda el enlace a la release. *Verificado: tests de `installer_name` (Rust) y `pickInstaller` (Vitest). No probado de punta a punta: falta una release real con instaladores y un equipo con la app.* Pendiente de C-06: los instaladores de Windows sin firmar siguen mostrando SmartScreen.

## T — Tests

- [x] **T-01 Rust sin ejecutar en esta auditoría.** `cargo test` en `src-tauri`: 65 passed, 0 failed (cargo 1.99.0), tras los cambios de R-04 y Q-01.
- [x] **T-02 Tests de la papelera.** Hecho en `vault_trash_tests` (`lib.rs`): ruta fuera del vault, raíz del vault y `..` rechazados; migración por vault con un elemento sin vault conocido. *Prueba `ensure_in_vault` directamente, no el comando `move_to_trash` entero.*
- [x] **T-03 Smoke test end-to-end.** `playwright-core` ya está en `bench/`. Un test que cree vault → nota → tarea cubriría la regresión más cara. *Hecho en `bench/prueba-app.mjs` (`pnpm bench:app`): app completa con backend simulado. Crea nota, autoguarda y comprueba el contrato IPC de la tarea. No cubre el backend real.*
- [x] **T-04 Sin ESLint, pero con directivas de ESLint.** Hay 16 `eslint-disable` que citan reglas de `react-hooks` y `react-doctor`. No existe configuración de ESLint ni el plugin en `package.json`. Esas directivas no hacen nada. Decidir: añadir ESLint con `eslint-plugin-react-hooks` o borrar las directivas. *Quitadas las 16 directivas. Sin ESLint no hay nada que las use.*

## Q — Código, tamaño y restos inútiles

- [x] **Q-01 `greet` de la plantilla.** `src-tauri/src/lib.rs:5-7` y su registro en `generate_handler!` (`lib.rs:2978`). No hay ninguna llamada desde `src/`. Borrar el comando y su registro. *Hecho sin compilar: `cargo` no está instalado.*
- [x] **Q-02 Assets sin uso.** `src/assets/react.svg`, `public/tauri.svg` y `public/vite.svg` no tienen referencias en el código. Borrar.
- [ ] **Q-03 `MarkdownEditor.tsx` (5.384 líneas).** Separar en hooks o módulos: historial de deshacer (ya existe `lib/editorHistory.ts`, comprobar que se usa), overlay de resaltado, listas (Enter y renumerado), pegado y menú contextual. Un commit por extracción.
- [x] **Q-04 `lib.rs` (5.193 líneas → ~740).** *Hecho en siete módulos (`archivos`, `busqueda`, `configuracion`, `enlaces`, `importar`, `listados`, `medios`, `papelera`, `tareas`) más `tests.rs`. Los nombres de los comandos no cambiaron. 68 tests en verde.*
- [ ] **Q-05 `App.tsx` (1.969) y `FileExplorer.tsx` (1.878).** Extraer gestión de vaults y drag & drop de `App.tsx`; operaciones de árbol de `FileExplorer.tsx`.
- [x] **Q-06 Duplicado de miniaturas.** *No hay duplicado que quitar: la galería y la biblioteca PDF (P-05) todavía no existen, y cuando existan deben usar `read_vault_image_thumb`.* `read_vault_image_thumb` (`lib.rs:1003`) es la base para REQ-02 de `interfaz.md` (galería) y para la biblioteca de PDF de `features.md`. Reutilizarla, no escribir otra.
- [ ] **Q-07 Índice de búsqueda dentro del vault.** `.gus-index/` (`lib.rs:2205`) escribe dentro del vault, que puede estar en Nextcloud o Syncthing. Eso sube un índice binario/JSON grande a la sincronización. Decidir si va en la app o se excluye en la documentación.

## P — Requisitos (`task/`)

`task/` mezcla requisitos, bugs y revisiones en cinco ficheros. Propuesta: un único backlog (este `rework.md`) con los IDs de arriba, y los ficheros de `task/` como notas de origen.

- [x] **P-01 Estado desactualizado.** *REQ-12 marcado (recordatorios y antelación; falta el aviso de la nota del día). `interfaz.md` REQ-06: marcados ajuste de ancho y texto en los botones; falta el botón de expandir/retraer.* `task/features.md` REQ-12 (notificaciones) sigue sin marcar, pero ya está en `0.1.3` (commit `80c888f`). REQ-05 a REQ-08 están marcados como hechos, y el commit `53ad5a8` de búsqueda los confirma.
- [ ] **P-02 Conflicto de principios. En pausa (decidido: no avanzar de momento).** `task/features.md` REQ-01 (Google Calendar y Drive) choca con "sin nube, sin cuentas, sin telemetría" de `AGENTS.md` y `PRIVACY.md`. Decidir antes de diseñar nada: cambiar el principio de forma explícita o descartar la integración.
- [ ] **P-03 Solapamiento.** REQ-10 (carpeta compartida) y REQ-13 (watcher de archivos externos) necesitan el mismo watcher de `notify`. Implementarlos juntos.
- [ ] **P-04 Solapamiento en tareas.** REQ-09 (checkboxes en notas sincronizados con `.gus-tasks.json`) y REQ-11 (subtareas y dependencias) tocan el mismo modelo de tarea. Definir el modelo una sola vez.
- [ ] **P-05 Galería y biblioteca PDF.** `interfaz.md` REQ-02 y `features.md` REQ-02 pintan miniaturas de imágenes y portadas de PDF. Ver Q-06.
- [ ] **P-06 Actualizar desde la app (`task/mejoras.md`).** Ver C-06 y C-07.
- [ ] **P-07 Requisitos grandes sin desglosar.** Pizarra (`features.md` REQ-03), hábitos (REQ-04), modo presentación (`interfaz.md` REQ-01) y temas personalizados (`interfaz.md` REQ-03) son proyectos de varias semanas. Cada uno necesita un alcance mínimo antes de programarse.
- [ ] **P-08 `task/fix-fedora.md`: FIX-01 aparece como hecho.** El primer bug (escalado de interfaz) está marcado `[X]`, pero la captura que lo ilustra no se ha revisado y la ruta está rota (D-10). Confirmar en la app si el escalado sigue fallando en Fedora.

## Orden sugerido

1. **R-02 y R-01**: decidir el modelo de la papelera y limitar `move_to_trash` al vault. Son los únicos riesgos de pérdida de datos.
2. **R-03** (CSP) con prueba manual de PDF y Mermaid.
3. **R-04** (errores del manifiesto) y **T-01** (ejecutar `cargo test`).
4. **C-01, C-02, C-03, C-04**: CI.
5. **D-01 a D-12**: documentación, en un commit `docs:` aparte.
6. **Q-01, Q-02, T-04**: limpieza de restos.
7. **Q-03 a Q-05**: refactors grandes, uno por commit.
8. **P-02** antes de cualquier trabajo en REQ-01.

## Lo que no se ha revisado

- `bench/` (salvo su lista de scripts) y el contenido de `public/dict/`.
- Comportamiento real de la app: no se ha arrancado.
- Compilación y tests de Rust (ver arriba).
- Los 28 componentes, uno por uno. La revisión fue por puntos de riesgo, no línea a línea.
