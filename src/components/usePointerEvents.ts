import type { Dispatch, MouseEvent, RefObject, SetStateAction } from "react";
import type { SourceLine } from "./InlinePreview";
import { imageMarkdown, parseImageLine } from "../lib/imageLinks";
import type { OrderedBlockRef, PasteRange } from "../lib/listNumbering";
import { copyText } from "../lib/clipboard";
import type { CodeBlockInfo } from "../lib/codeBlocks";
import { charWidthPx, offsetAtPointer } from "../lib/pointerOffset";
import { toLocalCoord, uiZoomFactor } from "../lib/uiZoom";
import { cellIndexAtPointer, isTableTaskCell, splitTableCells, tableCellRange, toggleTableTask, wordRangeAt, type TableCellRect, type TableEdit, type TableLine } from "../lib/tableLayout";
import type { TableBarHover, TableResizeHover } from "./InlinePreview";
import type { useTableKeyboard } from "./useTableKeyboard";
import type { useTableResize } from "./useTableResize";
import { insideRect } from "../lib/editorMeasure";
import type { BlockDrift, ImageResizeDrag } from "./markdownEditorTypes";


/** Zona de clic de la casilla de tarea (unos cinco caracteres con el relleno). */
const TASK_CHECKBOX_PX = 36;

interface PointerEventsDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  forceHistoryRef: RefObject<boolean>;
  cellDragRef: RefObject<{ anchor: number; line: number; col: number } | null>;
  tableAnchorRef: RefObject<{ line: number; col: number } | null>;
  imageResizeRef: RefObject<ImageResizeDrag | null>;
  textDragRef: RefObject<{ move: (event: globalThis.MouseEvent) => void; up: () => void } | null>;
  rightClickSelRef: RefObject<[number, number] | null>;
  resizeDragRef: RefObject<{ block: number; col: number; startX: number; widths: number[] } | null>;
  copyTimerRef: RefObject<number | null>;
  copyChipsRef: RefObject<HTMLElement[]>;
  tableCellsRef: RefObject<HTMLElement[]>;
  blockDriftRef: RefObject<Map<number, BlockDrift>>;
  markedRectRef: RefObject<TableCellRect | null>;
  sourceInfo: SourceLine[];
  codeBlockMap: Map<number, CodeBlockInfo>;
  rowPitch: number;
  inlineActive: boolean;
  setHoverImageResize: Dispatch<SetStateAction<number | null>>;
  setImageResize: Dispatch<SetStateAction<{ line: number; width: number } | null>>;
  setCopyDone: Dispatch<SetStateAction<number | null>>;
  setCopyHover: Dispatch<SetStateAction<number | null>>;
  setHoverResize: Dispatch<SetStateAction<TableResizeHover | null>>;
  setHoverBar: Dispatch<SetStateAction<TableBarHover | null>>;
  setTableRect: Dispatch<SetStateAction<TableCellRect | null>>;
  driftAtPointer: (clientY: number) => number;
  handleCaretMove: () => void;
  editBody: (nextBody: string, paste?: PasteRange, previous?: OrderedBlockRef | null) => { body: string; caret: number };
  currentLines: () => TableLine[];
  autoFitColumn: (blockStart: number, col: number) => void;
  applyTableEdit: (edit: TableEdit | null) => void;
  addTableRowAt: (line: number) => void;
  addTableColumnAt: (blockStart: number, col: number) => void;
  resizeHandleAt: ReturnType<typeof useTableResize>["resizeHandleAt"];
  tableBarAtPoint: ReturnType<typeof useTableResize>["tableBarAtPoint"];
  startColumnResize: ReturnType<typeof useTableResize>["startColumnResize"];
  measureTableColumns: ReturnType<typeof useTableResize>["measureTableColumns"];
  addBadgeAt: ReturnType<typeof useTableResize>["addBadgeAt"];
  selectionAnchorCell: ReturnType<typeof useTableKeyboard>["selectionAnchorCell"];
  selectCellBlock: ReturnType<typeof useTableKeyboard>["selectCellBlock"];
}

/** Ratón sobre el overlay del editor: clics, selección, arrastres, redimensionado y bloques de código. */
export function usePointerEvents(deps: PointerEventsDeps) {
  const {
    textareaRef, overlayRef, pendingCaretRef, forceHistoryRef, cellDragRef, tableAnchorRef, imageResizeRef,
    textDragRef, rightClickSelRef, resizeDragRef, copyTimerRef, copyChipsRef, tableCellsRef, blockDriftRef,
    markedRectRef, sourceInfo, codeBlockMap, rowPitch, inlineActive, setHoverImageResize, setImageResize,
    setCopyDone, setCopyHover, setHoverResize, setHoverBar, setTableRect, driftAtPointer, handleCaretMove,
    editBody, currentLines, autoFitColumn, applyTableEdit, addTableRowAt, addTableColumnAt, resizeHandleAt,
    tableBarAtPoint, startColumnResize, measureTableColumns, addBadgeAt, selectionAnchorCell, selectCellBlock,
  } = deps;

  /** ¿El punto (x, y) cae dentro del rectángulo del elemento? */
  /** Botón «copiar» bajo el punto (x, y): devuelve la línea de su bloque. */
  function copyChipAt(clientX: number, clientY: number): number | null {
    for (const chip of copyChipsRef.current) {
      if (insideRect(chip, clientX, clientY)) return Number(chip.dataset.copyLine);
    }
    return null;
  }

  /**
   * Arrastre de la esquina de una imagen de bloque: se cambia su anchura
   * manteniendo la escala (la altura la fija siempre el propio ratio de la
   * imagen). El puntero lleva la diagonal: tirar hacia abajo y a la derecha
   * ensancha y subir/izquierda estrecha, en proporción.
   *
   * Mientras se arrastra se pinta con el ancho vivo (estado `imageResize`), así
   * que la línea y el sobrante de abajo se mueven al momento; al soltar, el
   * ancho se guarda en la nota como `![alt|300](ruta)`.
   */
  function startImageResize(line: number, clientX: number, clientY: number) {
    const overlay = overlayRef.current;
    const handle = overlay?.querySelector<HTMLElement>(`[data-image-resize="${line}"]`);
    const img = handle?.parentElement?.querySelector("img");
    const lineEl = handle?.closest<HTMLElement>("[data-drift-line]");
    if (!handle || !img || !lineEl || !img.complete || img.naturalWidth === 0) return;

    // Con zoom de interfaz, los rects y el puntero vienen en px de pantalla
    // (afectados por el zoom) pero el ancho se guarda y se pinta en px de
    // layout: sin esta conversión la imagen no seguiría al cursor y al soltar
    // daría un salto. Todo el arrastre se hace en px de layout.
    const zoom = uiZoomFactor();
    const minW = 40;
    // La imagen no puede ensancharse más que el hueco que la contiene (su
    // `max-w-full` haría de tope visual y rompería la proporción del asa).
    const maxW = Math.max(minW, Math.round(lineEl.getBoundingClientRect().width / zoom));
    const startW = Math.round(img.getBoundingClientRect().width / zoom);
    const drag: ImageResizeDrag = {
      line,
      startX: clientX,
      startY: clientY,
      startW,
      width: startW,
      minW,
      maxW,
      move: () => {},
      up: () => endImageResize(true),
    };
    drag.move = (event) => {
      if (event.buttons === 0) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      // El delta del puntero es de pantalla: se pasa a layout para que la
      // imagen siga al cursor 1:1 con cualquier zoom.
      const delta = toLocalCoord((dx + dy) / 2);
      const width = Math.round(Math.min(drag.maxW, Math.max(drag.minW, drag.startW + delta)));
      if (width === drag.width) return;
      drag.width = width;
      // El cursor de redimensionar y el asa se mantienen aunque el puntero se
      // salga de la imagen: son los del arrastre, no los del contorno.
      setHoverImageResize(line);
      setImageResize({ line, width });
    };

    imageResizeRef.current = drag;
    window.addEventListener("mousemove", drag.move);
    window.addEventListener("mouseup", drag.up);
    setHoverImageResize(line);
  }

  /** Suelta el arrastre de imagen; con `aplicar` guarda el ancho en la nota. */
  function endImageResize(aplicar: boolean) {
    const drag = imageResizeRef.current;
    if (!drag) return;
    window.removeEventListener("mousemove", drag.move);
    window.removeEventListener("mouseup", drag.up);
    imageResizeRef.current = null;
    if (aplicar) aplicarAnchoImagen(drag);
    setImageResize(null);
  }

  /** Escribe el ancho con el que se ha soltado la imagen: `![alt|300](ruta)`. */
  function aplicarAnchoImagen(drag: { line: number; width: number; startW: number }) {
    const area = textareaRef.current;
    if (!area) return;
    const lineas = area.value.split("\n");
    if (drag.line >= lineas.length) return;
    const partes = parseImageLine(lineas[drag.line]);
    if (!partes) return;
    // Un clic sobre el asa sin arrastrar no toca la nota.
    if (drag.width === drag.startW) return;
    const nueva = imageMarkdown(partes.alt, partes.destination, drag.width);
    if (nueva === lineas[drag.line]) return;

    // El cursor/selección se reajusta al cambio de longitud de la línea.
    let start = 0;
    for (let i = 0; i < drag.line; i += 1) start += lineas[i].length + 1;
    const end = start + lineas[drag.line].length;
    const delta = nueva.length - lineas[drag.line].length;
    const adjust = (offset: number) =>
      offset > start && offset < end
        ? Math.min(offset, start + nueva.length)
        : offset >= end
          ? offset + delta
          : offset;
    pendingCaretRef.current = [adjust(area.selectionStart), adjust(area.selectionEnd)];
    // Cada redimensionado es un paso de deshacer propio (no se agrupa con
    // lo escrito justo antes).
    forceHistoryRef.current = true;
    const next = [...lineas];
    next[drag.line] = nueva;
    editBody(next.join("\n"));
  }

  /**
   * Doble clic: sobre el borde de una columna la ajusta al contenido (como el
   * doble clic de Excel); dentro de una celda, marca la palabra.
   */
  function handleOverlayDoubleClick(event: MouseEvent<HTMLTextAreaElement>) {
    const resize = resizeHandleAt(event.clientX, event.clientY);
    if (resize) {
      event.preventDefault();
      cellDragRef.current = null;
      autoFitColumn(resize.block, resize.col);
      return;
    }
    handleOverlayCellDoubleClick(event);
  }

  /**
   * Asa de redimensionado de imagen bajo el punto, o la línea a la que
   * pertenece (null si no se pisa ninguna). Solo cuenta si la imagen ya está
   * cargada: sin sus píxeles no hay escala que mantener.
   *
   * No se usa una lista guardada (como con las celdas): el asa aparece cuando
   * cada imagen termina de cargar, y eso no pasa por `sourceInfo`. Se busca en
   * vivo, que con las pocas imágenes de una nota es barato.
   */
  function imageResizeHandleAt(clientX: number, clientY: number): number | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const handle = Array.from(overlay.querySelectorAll<HTMLElement>("[data-image-resize]")).find(
      (element) => insideRect(element, clientX, clientY),
    );
    if (!handle) return null;
    const img = handle.parentElement?.querySelector("img");
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    const line = Number(handle.dataset.imageResize);
    return Number.isInteger(line) ? line : null;
  }

  /** Copia el contenido de un bloque de código y enseña el ✔ un segundo. */
  function copyCodeBlock(start: number) {
    const block = codeBlockMap.get(start);
    if (!block) return;
    void copyText(block.text).then((ok) => {
      if (!ok) return;
      setCopyDone(block.start);
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = window.setTimeout(() => setCopyDone(null), 1000);
    });
  }

  /**
   * Clic sobre lo que el overlay dibuja encima del fondo (celdas de tabla y
   * botones «copiar»): el overlay va por debajo del textarea, así que esos
   * elementos se detectan por coordenadas en este evento.
   */
  /** Celda dibujada bajo el punto (x, y), o null si el punto cae fuera de una. */
  function cellAt(clientX: number, clientY: number): HTMLElement | null {
    // La lista se mantiene al día con el overlay; si aun no está (o el overlay
    // no se ha dibujado), se busca en el DOM.
    const cells =
      tableCellsRef.current.length > 0
        ? tableCellsRef.current
        : Array.from(
            overlayRef.current?.querySelectorAll<HTMLElement>("[data-cell]") ?? [],
          );
    return cells.find((element) => insideRect(element, clientX, clientY)) ?? null;
  }

  /**
   * Desplazamiento del texto bajo el punto cuando cae dentro de una celda. La
   * celda se mide en pantalla y su ancho se reparte en caracteres, de modo que el
   * cursor cae donde se ha hecho clic y el arrastre selecciona texto como en
   * cualquier editor (en vez de quedarse con la celda entera).
   */
  function cellOffsetAt(clientX: number, clientY: number): number | null {
    const cell = cellAt(clientX, clientY);
    const area = textareaRef.current;
    if (!cell || !area) return null;

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    if (Number.isNaN(line) || Number.isNaN(col)) return null;
    const range = tableCellRange(sourceInfo, line, col);
    if (!range) return null;

    const span = splitTableCells(sourceInfo[line]?.text ?? "")[col];
    const text = span?.text ?? "";
    const char = charWidthPx(area);
    if (!char) return null;

    // El div interno es el que lleva el texto: su borde izquierdo cae justo en el
    // primer carácter de la celda.
    const inner = (cell.firstElementChild ?? cell) as HTMLElement;
    const box = inner.getBoundingClientRect();
    const perLine = Math.max(1, Math.floor(box.width / char));
    return (
      range.start +
      cellIndexAtPointer(
        text,
        clientX - box.left,
        clientY - box.top,
        char,
        perLine,
        rowPitch,
      )
    );
  }

  /**
   * Ratón en movimiento: resalta el «copiar» del bloque, enseña las barras «+»
   * y el asa de columna, y —si hay un arrastre en marcha— mueve el extremo de la
   * selección que sigue al puntero. El otro extremo (el del clic) queda fijo, así
   * que arrastrar selecciona texto como en cualquier editor. Si el puntero sale
   * de la tabla se sigue con la cuenta geométrica de siempre y la selección
   * continúa hacia el texto de alrededor sin saltos.
   */
  function handleOverlayMouseMove(event: MouseEvent<HTMLTextAreaElement>) {
    const drag = cellDragRef.current;
    if (drag && event.buttons !== 0) {
      const area = textareaRef.current;
      if (!area) return;
      const at =
        cellOffsetAt(event.clientX, event.clientY) ??
        // Fuera de las celdas manda la cuenta geométrica, con el sobrante que
        // los bloques crecidos llevan por encima del punto (no del ancla).
        offsetAtPointer(area, event.clientX, event.clientY, driftAtPointer(event.clientY));
      if (at === null) return;
      if (at === area.selectionStart && area.selectionEnd === drag.anchor) return;
      if (at === area.selectionEnd && area.selectionStart === drag.anchor) return;

      // La celda del clic sigue siendo el ancla: Mayús+flechas y Supr la usan.
      tableAnchorRef.current = { line: drag.line, col: drag.col };
      area.setSelectionRange(Math.min(drag.anchor, at), Math.max(drag.anchor, at));
      // El recuadro se repinta aquí y no solo al soltar: mientras el motor está
      // con el arrastre no siempre llega el «select», y sin esto las celdas se
      // iban marcando de golpe al levantar el ratón, sin poder ver qué se cogía.
      handleCaretMove();
      // Arrastrando texto no se enseñan ni las barras «+» ni el asa de columna:
      // están cuatro píxeles más allá de donde va la selección.
      return;
    }

    // Resalta el botón «copiar» del bloque bajo el cursor.
    const line = copyChipAt(event.clientX, event.clientY);
    setCopyHover((prev) => (prev === line ? prev : line));
    // Las barras «+» de las tablas solo se enseñan con el ratón encima de la
    // barra, no de la tabla.
    const bar = tableBarAtPoint(event.clientX, event.clientY);
    setHoverBar((prev) =>
      prev && bar && prev.block === bar.block && prev.part === bar.part ? prev : bar,
    );
    // El borde de una columna se agarra para cambiar su anchura. Durante el
    // arrastre se sigue a la columna que se está moviendo, que el render puede
    // ir un paso por detrás del puntero: así ni la línea ni el cursor de
    // redimensionado parpadean.
    const dragged = resizeDragRef.current;
    const resize = dragged
      ? { block: dragged.block, col: dragged.col }
      : resizeHandleAt(event.clientX, event.clientY);
    setHoverResize((prev) =>
      prev && resize && prev.block === resize.block && prev.col === resize.col ? prev : resize,
    );

    // La esquina de una imagen se agarra para cambiar su ancho. Durante el
    // arrastre se sigue mostrando el asa de esa imagen (como con la columna),
    // para que el cursor de redimensionado no parpadee si el puntero se sale.
    const draggedImage = imageResizeRef.current;
    const imageLine = draggedImage
      ? draggedImage.line
      : imageResizeHandleAt(event.clientX, event.clientY);
    setHoverImageResize((prev) => (prev === imageLine ? prev : imageLine));
  }

  /**
   * Línea de imagen de bloque cuya altura cubre la coordenada vertical del
   * punto, o `null`. La imagen se pinta con las filas de su imagen real, así
   * que su rect mide mucho más que la fila que el texto reserva para su
   * markdown (y se mide solo el alto: la imagen puede ir centrada y dejar
   * hueco a los lados).
   */
  function imageLineAtPoint(clientY: number): number | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    for (const element of overlay.querySelectorAll<HTMLElement>("[data-drift-line]")) {
      const rect = element.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const line = Number(element.dataset.driftLine);
      return Number.isInteger(line) ? line : null;
    }
    return null;
  }

  /**
   * Offset del texto que toca en un punto del ratón, midiendo el overlay (lo
   * que se ve) en vez del textarea. Devuelve `null` cuando la geometría nativa
   * ya acierta —el punto no depende de ningún bloque crecido— y entonces manda
   * el cursor del motor, como siempre.
   *
   * Dentro de una imagen de bloque el cursor va a su línea (en el texto esa
   * imagen ocupa una sola fila, y sin más el clic seguiría hacia las filas de
   * debajo) y por debajo de un bloque crecido se suma lo que lleva de más.
   */
  function overlayOffsetAt(clientX: number, clientY: number): number | null {
    const area = textareaRef.current;
    if (!area) return null;

    const imagen = imageLineAtPoint(clientY);
    if (imagen !== null && blockDriftRef.current.has(imagen)) {
      const lineas = area.value.split("\n");
      if (imagen >= lineas.length) return null;
      const char = charWidthPx(area);
      const rect = area.getBoundingClientRect();
      const padLeft = Number.parseFloat(getComputedStyle(area).paddingLeft) || 0;
      const col = char
        ? Math.max(
            0,
            Math.floor(
              (toLocalCoord(clientX) - toLocalCoord(rect.left) - padLeft + area.scrollLeft) / char,
            ),
          )
        : 0;
      let inicio = 0;
      for (let i = 0; i < imagen; i += 1) inicio += lineas[i].length + 1;
      return inicio + Math.min(col, lineas[imagen].length);
    }

    const drift = driftAtPointer(clientY);
    if (drift <= 0) return null;
    return offsetAtPointer(area, clientX, clientY, drift);
  }

  /**
   * Tras un clic que había que corregir, el motor no arrastra (se le canceló
   * el suyo): mientras el botón siga bajo, la selección la llevamos nosotros
   * midiendo el overlay. El mismo compás que el arrastre de celdas de tabla.
   */
  function startTextDrag(anchor: number) {
    const area = textareaRef.current;
    if (!area) return;
    endTextDrag();

    const move = (event: globalThis.MouseEvent) => {
      if (event.buttons === 0) return;
      const at =
        overlayOffsetAt(event.clientX, event.clientY) ??
        offsetAtPointer(area, event.clientX, event.clientY);
      if (at === null) return;
      if (at === area.selectionStart && area.selectionEnd === anchor) return;
      if (at === area.selectionEnd && area.selectionStart === anchor) return;
      area.setSelectionRange(Math.min(anchor, at), Math.max(anchor, at));
      handleCaretMove();
    };
    const up = () => endTextDrag();

    textDragRef.current = { move, up };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  /** Suelta el arrastre de `startTextDrag` (también al perder el foco). */
  function endTextDrag() {
    const drag = textDragRef.current;
    if (!drag) return;
    window.removeEventListener("mousemove", drag.move);
    window.removeEventListener("mouseup", drag.up);
    textDragRef.current = null;
  }

  /**
   * Clic en un punto donde el textarea y el overlay no cuadran: el cursor se
   * coloca midiendo el overlay y, si se arrastra, la selección la sigue
   * `startTextDrag`. El clic nativo se cancela solo en ese caso; si el punto
   * no necesita corrección, no se toca nada.
   */
  function colocarCursorTrasClic(event: MouseEvent<HTMLTextAreaElement>) {
    const at = overlayOffsetAt(event.clientX, event.clientY);
    if (at === null) return;
    const area = textareaRef.current;
    if (!area) return;

    event.preventDefault();
    area.focus();

    if (event.shiftKey) {
      // Mayús+clic: la selección crece desde el extremo que no se mueve, como
      // lo haría el motor si acertara el punto (aquí no lo acierta).
      const anchor =
        area.selectionDirection === "backward" ? area.selectionEnd : area.selectionStart;
      area.setSelectionRange(Math.min(anchor, at), Math.max(anchor, at));
      handleCaretMove();
      return;
    }

    area.setSelectionRange(at, at);
    startTextDrag(at);
    handleCaretMove();
  }

  function handleOverlayMouseDown(event: MouseEvent<HTMLTextAreaElement>) {
    // El clic derecho puede colapsar la selección en WebKit: se guarda antes
    // de que el motor la toque, para que el menú sepa qué filas había marcadas.
    if (event.button === 2) {
      const area = textareaRef.current;
      rightClickSelRef.current = area ? [area.selectionStart, area.selectionEnd] : null;
      return;
    }
    if (event.button !== 0) return;
    // Empieza otra selección: lo marcado antes ya no cuenta.
    markedRectRef.current = null;

    // Clic corriente: rompe la ancla de la selección multifila. Con Mayús se
    // conserva, porque el clic es una extensión de esa misma selección.
    if (!event.shiftKey) tableAnchorRef.current = null;
    rightClickSelRef.current = null;
    if (!inlineActive) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const chipLine = copyChipAt(event.clientX, event.clientY);
    if (chipLine !== null && codeBlockMap.has(chipLine)) {
      // Copiar no mueve el cursor ni deshace la selección.
      event.preventDefault();
      copyCodeBlock(chipLine);
      return;
    }

    // Los dos «+» del bloque: el del costado añade columna, el de abajo fila.
    const badge = addBadgeAt(event.clientX, event.clientY);
    if (badge) {
      event.preventDefault();
      textareaRef.current?.focus();
      const col = badge.dataset.addCol;
      const blockStart = badge.dataset.addBlock;
      if (col !== undefined && blockStart !== undefined) {
        addTableColumnAt(Number(blockStart), Number(col));
      } else if (badge.dataset.addRow !== undefined) {
        addTableRowAt(Number(badge.dataset.addRow));
      }
      return;
    }

    // Asa de columna: al arrastrarla se cambia la anchura de esa columna.
    const resize = resizeHandleAt(event.clientX, event.clientY);
    if (resize && !resizeDragRef.current) {
      event.preventDefault();
      textareaRef.current?.focus();
      const widths = measureTableColumns(resize.block);
      if (widths) startColumnResize(resize.block, resize.col, event.clientX, widths);
      return;
    }

    // Asa de la esquina de una imagen: al arrastrarla se cambia su ancho
    // manteniendo la escala.
    const imageLine = imageResizeHandleAt(event.clientX, event.clientY);
    if (imageLine !== null && !imageResizeRef.current) {
      event.preventDefault();
      textareaRef.current?.focus();
      startImageResize(imageLine, event.clientX, event.clientY);
      return;
    }

    const cell = cellAt(event.clientX, event.clientY);
    if (!cell) {
      cellDragRef.current = null;
      // Si un bloque crecido (tabla envuelta, imagen a tamaño real) hace que el
      // overlay no cuadre con el textarea, el cursor nativo caería en otra
      // línea: aquí se coloca midiendo lo que se ve.
      colocarCursorTrasClic(event);
      return;
    }

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    const range = tableCellRange(sourceInfo, line, col);
    const area = textareaRef.current;
    if (!range || !area) return;

    event.preventDefault();
    area.focus();

    // Clic sobre la casilla de una celda de tarea («- [ ]»): la marca o la
    // desmarca. Más a la derecha, el cursor entra en el texto como siempre.
    const cellText = splitTableCells(sourceInfo[line]?.text ?? "")[col]?.text ?? "";
    if (!event.shiftKey && isTableTaskCell(cellText)) {
      const box = cell.getBoundingClientRect();
      if (event.clientX - box.left <= TASK_CHECKBOX_PX) {
        cellDragRef.current = null;
        applyTableEdit(toggleTableTask(currentLines(), line, col));
        return;
      }
    }

    if (event.shiftKey) {
      // Mayús+clic: la selección va desde la celda ancla hasta esta, completas.
      cellDragRef.current = null;
      const anchor = selectionAnchorCell(area);
      if (anchor) selectCellBlock(anchor, { line, col });
      else area.setSelectionRange(range.start, range.end);
      handleCaretMove();
      return;
    }

    // Clic llano: el cursor cae donde se ha pulsado (como en cualquier editor) y
    // la celda pasa a ser el ancla de Mayús+flechas. La selección la llevamos
    // nosotros —el motor pondría el cursor en el crudo, no en la celda— así que
    // el arrastre se resuelve en handleOverlayMouseMove.
    const at = cellOffsetAt(event.clientX, event.clientY) ?? range.start;
    tableAnchorRef.current = { line, col };
    setTableRect(null);
    area.setSelectionRange(at, at);
    cellDragRef.current = { anchor: at, line, col };
    handleCaretMove();
  }

  /** Doble clic en una celda: marca la palabra, como en cualquier editor. */
  function handleOverlayCellDoubleClick(event: MouseEvent<HTMLTextAreaElement>) {
    const cell = cellAt(event.clientX, event.clientY);
    const area = textareaRef.current;
    if (!cell || !area) return;

    const line = Number(cell.dataset.line);
    const col = Number(cell.dataset.col);
    const range = tableCellRange(sourceInfo, line, col);
    if (!range) return;

    const span = splitTableCells(sourceInfo[line]?.text ?? "")[col];
    const inside = cellOffsetAt(event.clientX, event.clientY);
    if (!span || inside === null) return;

    const [from, to] = wordRangeAt(span.text, inside - range.start);
    event.preventDefault();
    tableAnchorRef.current = { line, col };
    area.setSelectionRange(range.start + from, range.start + to);
    cellDragRef.current = null;
    handleCaretMove();
  }

  return {
    endImageResize,
    endTextDrag,
    handleOverlayMouseMove,
    handleOverlayMouseDown,
    handleOverlayDoubleClick,
  };
}
