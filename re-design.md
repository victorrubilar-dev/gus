# Re-diseño de Gus: plan por fases

Documento vivo. Parte de lo que se midió en la app (capturas y `getComputedStyle` en el arnés de Chromium), no de intuiciones. Cada fase dice qué cambia, dónde, cómo se comprueba y qué riesgo tiene.

## Decisiones ya tomadas

| Tema | Decisión | Estado |
|---|---|---|
| Paleta | Derivada del logo: negro y blanco cálidos, bermellón como acento | Hecho (tema oscuro y claro) |
| Inicio | Notas es la pantalla de inicio; Resumen deja de serlo | Hecho |
| Barra lateral | Secciones con nombre: Resumen, Notas, Tareas, Calendario, Grafo. Abajo: salir, papelera, configuración | Hecho |
| Buscar | Sale de la barra; entra como icono en la fila del recorrido de Notas | Hecho |
| Nota de hoy | Pasa a la fila del recorrido de Notas | Hecho |
| Botones | Tres tipos (primario, secundario, icono) más uno fantasma para navegación. Altura única de 28 px | Hecho en Resumen, Notas, Tareas, Calendario y Grafo |
| Enlaces de acción | "Ver todas" usa el estilo fantasma, con el color de acento | Hecho |

## Estado medido hoy

- **Alturas de controles:** en Resumen, Notas, Tareas, Calendario y Grafo, todos los botones de acción miden 28 px o más (medido con `getBoundingClientRect`, excluyendo la barra lateral). Los chips de etiqueta de Tareas y los elementos de lista del explorador no se han medido por separado; si quedan por debajo de 28 px, son filtros y listas, no botones de acción.
- **Contraste (paleta nueva, fondo oscuro `#141414`, panel `#1c1c1c`):** texto principal `#f1ebe8` 14,4:1 sobre el panel; secundario `#a39c9a` 6,3:1; acento `#f26a4a` 5,6:1; texto del botón primario `#141414` sobre `#f26a4a` 5,8:1 (medido 4,73:1 con el bermellón puro, por eso el acento se aclaró).
- **Tamaños de texto (antes de este plan):** cuerpo 12 px, metadatos 10 px, contadores 11 px. El valor por defecto de macOS es 13 pt y el mínimo 10 pt.
- **Clases en uso:** hay texto con `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-xs` y `text-sm` mezclados según el componente. No hay escala.
- **Native `<select>` en el grafo:** tienen el estilo del sistema, no el de la app.

## Fase 0 · Cerrar el sistema de botones

Objetivo: que no quede ningún control de acción fuera de las cuatro variantes.

- **Diálogos:** `NewTaskDialog` (botón "Crear", de `px-4 py-1.5`), `PdfExportDialog`, `Tour` y `UpdateNotice` todavía tienen clases propias de botón. Pasar a `gus-btn`.
- **Ajustes:** `SettingsPanel` tiene botones de acción y selectores. Revisar cuáles son controles de acción.
- **Kanban:** `KanbanBoard` tiene un botón (revisar si es de añadir tarea) y los encabezados de columna.
- **Chips de etiqueta** (Tareas): son filtros. Medir su altura y, si queda por debajo de 28 px, documentarlo como excepción junto a la barra lateral.
- **Navegación de la barra lateral:** los elementos miden 40 px, por el alto de la etiqueta. Es una excepción intencional: la barra no es un control de acción. Documentarla en `AGENTS.md`.
- **Tema claro:** revisar cada botón en el tema claro antes de cerrar la fase (el primario es `#c83c1e` sobre blanco).

Criterio de salida: un script que mida todos los botones visibles de todas las pantallas y falle si alguno es menor de 28 px y no está en la lista de excepciones.

Riesgo: bajo. Son cambios de clase. Verificar con `pnpm bench:app` y los benchmarks de explorador y editor.

## Fase 1 · Escala tipográfica y contraste

Objetivo: un solo juego de tamaños, con el mínimo de escritorio como suelo.

- **Tokens propuestos:**
  - `--text-body: 13px` (cuerpo y controles)
  - `--text-meta: 11px` (fechas, contadores, tipos de archivo). Es el mínimo, no se baja de aquí.
  - `--text-title: 15px` (títulos de sección)
  - `--text-display: 20px` (estados vacíos)
- **Sustitución:** los `text-[10px]`, `text-[11px]`, `text-[12px]` y `text-xs` pasan a tokens. Empezar por `FileExplorer` (fechas a 10 px) y `DashboardView` (texto a 12 px).
- **Monoespaciada:** solo para nombres de archivo y código. Hoy ya se usa así en el explorador; mantenerlo.
- **Verificación de contraste en los siete temas:** un script que calcule el contraste de texto y acento sobre cada superficie y falle por debajo de 4,5:1 para texto menor de 18 px.

Criterio de salida: ningún `text-[Npx]` en `src/components` salvo los que estén en un comentario. Script de contraste en verde en los siete temas.

Riesgo: medio. Subir el cuerpo de 12 a 13 px cambia el ajuste de muchas líneas. Hacerlo con capturas antes y después de cada vista.

## Fase 2 · Barra lateral y navegación

Objetivo: que la barra se entienda sola y que todo se pueda llegar desde ella o desde `Ctrl K`.

- **Ancho:** hoy el ancho por defecto nuevo es 200 px y la etiqueta aparece desde 160 px. Quien ya tenía un ancho guardado sigue en modo iconos. Decidir si se migra a la etiqueta (una vez, con aviso) o se deja.
- **Modo contraído:** a 64 px solo se ven iconos. Añadir un `title` a cada icono (ya existe en los elementos de la barra) y comprobar que el foco de teclado llega a todos.
- **Herramientas de abajo** (salir, papelera, configuración): están etiquetadas como las secciones. Revisar si "Salir del vault" debe ser una acción de menú y no un elemento de navegación. Recomiendo moverla al menú del vault.
- **Tour:** el texto ya menciona Grafo. Repasar el resto de pasos del tour (`Tour.tsx`) contra la barra nueva.
- **Búsqueda:** hoy se llega con el icono de la fila del recorrido de Notas. Añadir una entrada en `Ctrl K` ("Buscar en el vault") para que no dependa de ese icono.
- **Estado vacío de Notas:** el texto dice "Crea la primera con el botón de arriba", pero el botón principal está en el centro. Cambiar el texto o mover el botón. Es un fallo de copy que corregir en `en.ts` y `es.ts` a la vez.

Criterio de salida: todas las secciones y herramientas se alcanzan con el teclado en orden lógico, y ningún texto de la app nombra un botón que no existe.

Riesgo: medio. Toca el tour y los atajos. Verificar con `pnpm bench:app` y revisar `Tour.tsx`.

## Fase 3 · Notas: la ventana de trabajo

Objetivo: que el editor sea lo que se ve primero y que el resto no compita con él.

- **Medida del texto:** el editor debería tener una medida de lectura fija (unos 680 px) centrada, con el resto de espacio libre. Hoy el texto ocupa todo el ancho disponible.
- **Pestañas de notas abiertas:** hoy solo se ve una nota a la vez. Pestañas (con cierre por pestaña) darían sentido a la barra del editor. Es el cambio más visible de la fase y el que más se parece a lo que buscas en Obsidian; hacerlo sin copiar su estructura.
- **Cabecera del editor:** revisar qué botones quedan. Recomiendo: nombre de la nota, estado de guardado y un solo menú (⋯) para lo demás.
- **Explorador:** el subtítulo "0 carpetas · 1 arc…" se corta. Reducir el texto o mostrarlo en la fila de estado.
- **Barra de estado** (opcional): palabras, caracteres y estado de guardado en una línea inferior discreta. Ya existe el recuento de palabras; falta el sitio.

Criterio de salida: el editor tiene medida fija en las dos anchuras de referencia (1280 y 1600 px) y el explorador no trunca su título en ninguna de ellas.

Riesgo: alto. Es el corazón de la app: el editor tiene más de 4.000 líneas y se apoya en el overlay. Hacer cada cambio tras los benchmarks del editor y del teclado de tablas, y añadir una prueba de regresión visual de la medida.

## Fase 4 · Tareas, Calendario y Grafo

Objetivo: las tres vistas comparten la misma cabecera, la misma barra de herramientas y los mismos estados vacíos.

- **Cabecera común:** título (`--text-title`), descripción corta y barra de acciones a la derecha. Hoy cada vista tiene la suya.
- **Selector Tablero/Lista:** ya usa el estilo de botón, pero no es un componente. Extraerlo a `src/components/SegmentedControl.tsx` y usarlo también en Calendario si hay vistas alternativas.
- **Native selects del grafo:** "Todas las carpetas" y "Todas las etiquetas" son `<select>` del sistema. Sustituir por un popover propio con el mismo estilo que el resto de menús, o dejarlos y documentar la excepción.
- **Estados vacíos:** un solo patrón (icono, título en `--text-display`, una acción primaria). Hoy las tres vistas los escriben a mano.
- **Calendario:** la medida de las celdas de día es mayor de 28 px, bien. Revisar el texto de los días (la fuente es pequeña) cuando entre la fase 1.

Criterio de salida: una cabecera y un estado vacío compartidos, usados por las tres vistas.

Riesgo: bajo-medio. Son cambios de estructura en componentes con poca lógica.

## Fase 5 · Identidad: la firma

Objetivo: que la app se reconozca sin mirar el logo, y que el acento se use poco.

- **Firma propuesta:** la nota en foco (nombre en monoespaciada, con una franja de acento) y el gato solo en el logo, no como decoración.
- **Disciplina del acento:** auditar cada uso de `gus-accent`. Debe quedar en acciones primarias, selección activa y el indicador de la sección actual. Hoy también marca enlaces de Tareas y la fecha de hoy en el calendario; revisar cada caso.
- **Colores semánticos:** rojo, ámbar y verde solo para vencimientos y estado. Revisar que no se usen como decoración (las tarjetas de estadísticas del inicio los usan en los números).
- **Movimiento:** la barra lateral tiene un indicador animado. Definir un presupuesto: transiciones de 150 ms como máximo, y respetar `prefers-reduced-motion`.
- **Iconos:** las herramientas usan Lucide con trazo de 1,75 en todas partes. Comprobar que el mismo trazo se usa en los menús y los diálogos.

Criterio de salida: una tabla de usos del acento revisada, y una prueba de que con movimiento reducido la app sigue siendo usable.

Riesgo: bajo técnicamente, alto en gusto. Mostrar dos opciones al dueño antes de elegir.

## Fase 6 · Calidad y regresión visual

Objetivo: que los cambios de diseño no se puedan romper sin que alguien lo vea.

- **Capturas de regresión:** añadir un benchmark que haga capturas de cada pantalla (Resumen, Notas, Tareas, Calendario, Grafo) en los dos temas y compare con una línea base guardada.
- **Accesibilidad de escritorio:** foco visible en todo control, tamaño de texto del sistema, y reducción de transparencia.
- **Ventana nativa de Tauri:** la barra de menús de macOS y la de Linux no se han revisado. Cada comando de la barra de la app debe estar también en el menú nativo.
- **Textos:** revisar que las dos lenguas tienen las mismas claves (ya lo comprueba `i18n.test.ts`) y que ningún texto nombra un botón que no existe.

Criterio de salida: el benchmark de capturas en verde en los dos temas y una revisión de menús nativos hecha.

Riesgo: bajo. Es trabajo de prueba.

## Orden recomendado

1. Fase 0 (cerrar botones) y Fase 1 (tipos): son mecánicas y dan la base del resto.
2. Fase 2 (barra lateral) y Fase 6 (capturas de regresión), en paralelo.
3. Fase 3 (Notas), la más grande, con la regresión ya lista.
4. Fase 4 (vistas) y Fase 5 (identidad).

## Lo que no se ha verificado

- La ventana nativa de Tauri y su barra de menús.
- El tema claro en cada pantalla (solo se revisó la paleta y la pantalla de inicio).
- Los otros cinco temas.
- La app con la fuente del sistema: el arnés usa una fuente de respaldo, así que las medidas de texto pueden variar un poco.

## Fase 5 · Estado (30 oct 2026)

Decisiones del dueño: acento **estricto** y firma con **franja de acento**.

| Uso del acento | Dónde | Se queda |
|---|---|---|
| Acción primaria | `.gus-btn-primary` | Sí |
| Selección activa | Sección de la barra lateral, pestaña de nota activa, archivo abierto en el explorador (franja), etiqueta filtrada, día seleccionado | Sí |
| Foco | Anillo de `:focus-visible` | Sí |
| Progreso | Barra de «Tu progreso» | Sí |
| Enlaces dentro de las notas | Editor y vista previa | Sí (son enlaces) |
| Etiquetas e insignias | `.gus-chip` (neutro) | No, hecho |
| Iconos de tarjeta y de bienvenida | Resumen, Bienvenida, aviso de actualización | No, hecho |
| «Ver todas» | Resumen, Calendario | No, hecho |

**Movimiento:** transiciones de interfaz a 150 ms como máximo (`duration` de Framer y `duration-150`). Excepción: la entrada de `VaultPicker` (0,25–0,45 s), que ocurre una vez al abrir la app. `prefers-reduced-motion` y el ajuste de animaciones ya estaban cubiertos (`App.css`, `MotionConfig`).

**Iconos:** `LucideProvider` fija 1,75 por defecto en `App.tsx`; los iconos con `strokeWidth` propio (marcas de verificación, 2 a 3) lo conservan.

**Sin hacer:** acento en hover de tarjetas, iconos de barra y explorador, y `TAG_COLORS` de Tareas; revisión de los otros seis temas.

## Fase 6 · Estado (30 oct 2026)

- **Regresión visual:** `pnpm bench:regresion` (9 vistas, temas oscuro y claro, línea base en `bench/linea-base/`; la línea base es de esta máquina).
- **Foco visible:** `pnpm bench:foco` recorre cada vista con Tab y falla si un control enfocado no cambia de aspecto.
- **Tamaño de texto del sistema:** los cuatro tamaños (`--text-*`) están en `rem`. Con el tamaño normal se ve igual (regresión en 0 %); si el sistema o el motor web cambian la fuente base, el texto escala (13 px pasa a 16,25 px con base de 20 px). Los botones crecen con el texto (`min-height: 28px`). Las medidas en `px` de la maqueta (anchos, iconos) no escalan.
- **Reducir transparencia:** con `prefers-reduced-transparency: reduce` se quita el desenfoque y los paneles flotantes pasan a opacos. El velo oscuro de los diálogos se queda. Comprobado en Chromium con la preferencia emulada; WebKitGTK y WKWebView no se han probado.
- **Menú nativo:** mínimo en macOS (`menu.rs`). Sin probar en un Mac.
- **Sin hacer:** los otros cinco temas fuera de la regresión; la revisión en la app real (`pnpm tauri dev`).
