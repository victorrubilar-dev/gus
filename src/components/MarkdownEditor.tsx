import {
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";
import { AnimatePresence } from "framer-motion";
import type { Components, UrlTransform } from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { Check, Code, Eye, Pencil, X } from "lucide-react";
import { pathWithTitle, safeFileName } from "../lib/fileName";
import { listEnterEdit } from "../lib/listContinue";
import {
  addPersonalWord,
  getPersonalWords,
  ignoreWord,
  isPersonalWord,
  loadSpellEngine,
  removePersonalWord,
  spellSegments,
  spellWordAt,
  type SpellEngine,
  type SpellFn,
  type SpellLang,
} from "../lib/spellCheck";
import { offsetAtPointer } from "../lib/pointerOffset";
import { parseTagInput } from "../lib/markdownTasks";
import {
  frontmatterLineOffset,
  parseNoteTags,
  replaceBody,
  setNoteTags,
  stripFrontmatter,
  tagOptions,
  type VaultTag,
} from "../lib/noteTags";
import { caretAnchor, lineAtCaret, type CaretAnchor } from "../lib/caretPosition";
import {
  decodeWikiUrl,
  detectSlashQuery,
  detectWikiQuery,
  findWikiNote,
  remarkWikiLinks,
  wikiInsertText,
  wikiMatches,
  type WikiNote,
} from "../lib/wikiLink";
import { filterSlashItems, SlashMenu, WikiLinkMenu, type SlashItem } from "./EditorMenus";
import InlinePreview, { classifySource } from "./InlinePreview";
import MermaidDiagram from "./MermaidDiagram";
import SpellMenu from "./SpellMenu";

/** Nota ya persistida: la ruta puede cambiar si el título renombró el archivo. */
export interface EditorDraft {
  path: string;
  title: string;
  content: string;
}

/** Acceso imperativo al editor (para volcar cambios a demanda del padre). */
export interface MarkdownEditorHandle {
  /** Vuelca ahora mismo lo pendiente. Resuelve `false` si el guardado falló. */
  flush: () => Promise<boolean>;
}

export interface MarkdownEditorProps {
  /** Ruta actual del archivo .md de la nota seleccionada. */
  path: string;
  /** Título de la nota (nombre del archivo sin .md). */
  title: string;
  /** Contenido markdown de la nota seleccionada. */
  content: string;
  /** Vault abierto: alimenta el autocompletado de `[[enlaces]]`. */
  vaultPath?: string | null;
  /** Abre (o crea) la nota a la que apunta un `[[enlace]]` de la vista previa. */
  onOpenWikiLink?: (target: string) => void;
  /** Autoguardado: se invoca con la nota ya guardada en disco. */
  autoSave?: (draft: EditorDraft) => void;
  /** Retardo del autoguardado en ms (500 por defecto). */
  debounceMs?: number;
  /** Tamaño de letra del área de texto en píxeles (viene de los ajustes). */
  fontSize?: number;
  /** Idioma del corrector ortográfico (viene de los ajustes; `off` = sin resaltado). */
  spellLang?: SpellLang;
  /** Palabras del diccionario personal (vienen de los ajustes). */
  spellWords?: string[];
  /** Persiste el diccionario personal tras agregar o quitar una palabra. */
  onSpellWordsChange?: (words: string[]) => void;
  /**
   * Activa el autoguardado con retardo. Si está en `false` solo guardan
   * Ctrl/Cmd+S y el volcado al salir de la nota (el guardado nunca se pierde).
   */
  autoSaveEnabled?: boolean;
  className?: string;
  /** Permite al padre forzar un volcado (`flush()`) antes de una acción sobre el archivo. */
  ref?: Ref<MarkdownEditorHandle>;
}

const DEFAULT_DEBOUNCE = 500;

/** Preferencia de la vista en vivo en localStorage («0» = solo código crudo). */
const INLINE_PREVIEW_KEY = "gus-editor-inline";

/** Líneas máximas decoradas: más allá, el editor vuelve al código crudo. */
const MAX_DECORATED_LINES = 10000;

type SaveState = "idle" | "dirty" | "saved" | "error";

/** Modo de vista del editor: escribir (textarea) o previsualizar (markdown). */
type ViewMode = "edit" | "preview";

/** Menú flotante del editor: autocompletado `[[notas]]` o menú `/` (bloques). */
interface EditorMenu {
  /** Disparador del menú. */
  kind: "wiki" | "slash";
  /** Índice del texto donde empieza el disparador (`[[` o `/`). */
  start: number;
  /** Texto escrito justo después del disparador (lo que se filtra). */
  query: string;
  /** Elemento resaltado con las flechas. */
  index: number;
  /** Posición del cursor, para anclar el menú encima. */
  anchor: CaretAnchor;
}

/** Menú contextual del corrector, anclado a una palabra concreta. */
interface SpellMenuState {
  /** Falta (con sugerencias) o palabra propia del usuario (para quitarla). */
  mode: "misspelled" | "personal";
  /** La palabra que se muestra en el menú. */
  word: string;
  /** Rango de la palabra dentro del cuerpo, para sustituirla. */
  start: number;
  end: number;
  /** Sugerencias propuestas al abrir (las guarda, el texto puede cambiar). */
  suggestions: string[];
  /** Coordenadas del clic en el sistema de la ventana. */
  x: number;
  y: number;
}

/**
 * El renderizador markdown solo se descarga la primera vez que se abre la
 * vista previa: mantiene el arranque ligero. Con `remark-gfm` (tablas y
 * tachado), `remark-math` + `rehype-katex` (fórmulas `$…$`) y
 * `remarkWikiLinks` (`[[enlaces]]` entre notas).
 */
const MarkdownBody = lazy(async () => {
  const [
    { default: ReactMarkdown, defaultUrlTransform },
    { default: remarkGfm },
    { default: remarkMath },
    { default: rehypeKatex },
  ] = await Promise.all([
    import("react-markdown"),
    import("remark-gfm"),
    import("remark-math"),
    import("rehype-katex"),
  ]);
  // Tipos y fuentes de KaTeX: viajan en el mismo trozo diferido.
  await import("katex/dist/katex.min.css");

  /** `wiki:destino` sobrevive al saneado de URLs; el resto, la norma. */
  const urlTransform: UrlTransform = (value) =>
    value.startsWith("wiki:") ? value : defaultUrlTransform(value);

  function Preview({ components, children }: { components: Components; children: string }) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkWikiLinks]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={urlTransform}
        components={components}
      >
        {children}
      </ReactMarkdown>
    );
  }

  return { default: Preview };
});

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function MarkdownEditor({
  path,
  title: initialTitle,
  content: initialContent,
  vaultPath,
  onOpenWikiLink,
  autoSave,
  debounceMs = DEFAULT_DEBOUNCE,
  fontSize,
  spellLang,
  spellWords = [],
  onSpellWordsChange,
  autoSaveEnabled = true,
  className,
  ref,
}: MarkdownEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Escritura o vista previa; el botón de la cabecera alterna entre ambas. */
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  /**
   * Vista en vivo estilo Obsidian: el markdown se renderiza dentro del propio
   * área y solo la línea del cursor se ve como código fuente. Se guarda en
   * localStorage («0» = crudo); sin almacenamiento (SSR) arranca en vivo.
   */
  const [inline, setInline] = useState<boolean>(() => {
    try {
      return typeof localStorage === "undefined" || localStorage.getItem(INLINE_PREVIEW_KEY) !== "0";
    } catch {
      return true; // almacenamiento inaccesible: se comporta como por defecto
    }
  });
  /** Línea (0-based) del cursor: esa se pinta en crudo en la capa de atrás. */
  const [caretLine, setCaretLine] = useState(0);
  /** El IME está componiendo: el navegador pinta el texto, sin capa detrás. */
  const [composing, setComposing] = useState(false);
  /** Ancho del scrollbar del área (mueve la columna de texto del overlay). */
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  /** Motor del corrector del idioma elegido (`null` = off o aún en carga). */
  const [engine, setEngine] = useState<SpellEngine | null>(null);
  /**
   * Sube al agregar o ignorar una palabra: cambia la identidad de `spell`,
   * que es lo que hace que las líneas memorizadas se repinten solas.
   */
  const [spellRevision, setSpellRevision] = useState(0);
  /** Menú del corrector abierto sobre una palabra concreta. */
  const [spellMenu, setSpellMenu] = useState<SpellMenuState | null>(null);

  /**
   * Carga perezosa del diccionario del idioma de los ajustes: mientras no
   * llega (o si falla la descarga) no hay resaltado. Al cambiar de idioma el
   * motor anterior se libera (en memoria solo vive uno). El diccionario
   * personal y las ignoradas se consultan aparte, así que no hace falta
   * recargar nada al tocarlas.
   */
  useEffect(() => {
    if (!spellLang || spellLang === "off") {
      setEngine(null);
      return;
    }
    let alive = true;
    setEngine(null);
    void loadSpellEngine(spellLang).then((loaded) => {
      if (alive) setEngine(loaded);
    });
    return () => {
      alive = false;
    };
  }, [spellLang]);

  /**
   * Segmentación estable para la capa en vivo: cambia al cargar otro
   * diccionario o al tocar el personal (`spellWords` llega nuevo de ajustes
   * y `spellRevision` sube desde el menú), así que el repintado es justo el
   * que hace falta.
   */
  const spell = useMemo<SpellFn | null>(
    () => (engine ? (text: string) => spellSegments(text, engine.correct) : null),
    [engine, spellWords, spellRevision],
  );

  /** Menú flotante sobre el cursor: `[[` (notas) o `/` (bloques). */
  const [menu, setMenu] = useState<EditorMenu | null>(null);

  /** Ancla del recordatorio «/» cuando la línea del cursor está limpia. */
  const [lineHint, setLineHint] = useState<CaretAnchor | null>(null);
  /** Notas del vault: alimentan `[[` y el estilo de los enlaces en la previa. */
  const [wikiNotes, setWikiNotes] = useState<WikiNote[]>([]);
  const [wikiNotesLoading, setWikiNotesLoading] = useState(false);
  /** Etiqueta tecleada en la cabecera (los chips salen del frontmatter). */
  const [tagInput, setTagInput] = useState("");
  /** Etiquetas de todo el vault: opciones del menú desplegable del campo. */
  const [vaultTags, setVaultTags] = useState<VaultTag[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagIndex, setTagIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Capa de la vista en vivo (se desplaza con el textarea). */
  const overlayRef = useRef<HTMLDivElement>(null);
  /** Cursor que hay que fijar tras insertar un enlace o un bloque. */
  const pendingCaretRef = useRef<[number, number] | null>(null);
  /** N.º de petición: solo la última lista de notas puede escribir estado. */
  const wikiRequestRef = useRef(0);
  /** N.º de petición de etiquetas del vault (menú desplegable). */
  const tagRequestRef = useRef(0);

  /** Ruta real del archivo: la propia tras un rename, aunque el padre aún no la pase. */
  const ownPathRef = useRef(path);
  /** Invalida guardados en vuelo cuando cambia la nota seleccionada. */
  const sequenceRef = useRef(0);
  const dirtyRef = useRef(false);
  const autoSaveRef = useRef(autoSave);
  autoSaveRef.current = autoSave;
  dirtyRef.current = saveState === "dirty";

  // Cambiar de nota (ruta ajena) ⇒ recargar; un rename originado aquí no.
  useEffect(() => {
    if (path === ownPathRef.current) return;

    sequenceRef.current += 1;
    ownPathRef.current = path;
    setTitle(initialTitle);
    setContent(initialContent);
    setSaveState("idle");
    setSaveError(null);
    setMenu(null);
    // Los props de la nueva nota llegan en el mismo render que la ruta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  /** En la vista previa se distingue qué `[[enlaces]]` apuntan a notas reales. */
  useEffect(() => {
    if (viewMode === "preview") loadWikiNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, vaultPath, path]);

  // Tras insertar un enlace o un bloque, el cursor vuelve al textarea.
  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const [from, to] = pendingCaretRef.current;
    pendingCaretRef.current = null;

    const area = textareaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(from, to);
    refreshCaretLine();
  }, [content]);

  // El recordatorio «/» se (re)ancla a la línea del cursor: al cargar la nota,
  // al cambiar de vista y tras cada tecleo o movimiento del cursor.
  useEffect(() => {
    if (viewMode === "preview") {
      setLineHint(null);
      return;
    }
    refreshCaretLine();
    const area = textareaRef.current;
    if (area) syncLineHint(area.value, area.selectionStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, content]);

  // La capa en vivo comparte scroll y columna de texto con el área: su
  // scrollbar aparece o desaparece según el cuerpo de la nota.
  useEffect(() => {
    syncOverlayGeometry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, inline, spell]);

  /** Renombra si hace falta (título ≠ nombre del archivo) y escribe el contenido. */
  async function persist(): Promise<boolean> {
    const sequence = ++sequenceRef.current;
    const from = ownPathRef.current;
    let target = from;

    try {
      const wanted = pathWithTitle(from, title);
      if (wanted !== from) {
        target = await invoke<string>("rename_vault_file", { from, to: wanted });
      }
      await invoke("write_vault_file", { path: target, content });
    } catch (error) {
      if (sequence === sequenceRef.current) {
        setSaveState("error");
        setSaveError(String(error));
      }
      return false;
    }

    // La nota cambió mientras se guardaba: no tocar el estado de la nueva.
    if (sequence !== sequenceRef.current) return false;

    ownPathRef.current = target;
    autoSaveRef.current?.({ path: target, title: safeFileName(title), content });
    setSaveState("saved");
    setSaveError(null);
    return true;
  }

  const persistRef = useRef(persist);
  persistRef.current = persist;

  /**
   * Volcado inmediato que el padre puede pedir antes de renombrar/mover/borrar
   * el archivo. Marca como "limpio" para que el desmontaje no repita la escritura
   * (y no recrie un archivo que ya no existiría).
   */
  async function flush(): Promise<boolean> {
    if (!dirtyRef.current) return true;

    dirtyRef.current = false;
    const saved = await persistRef.current();
    if (!saved) dirtyRef.current = true;
    return saved;
  }

  useImperativeHandle(ref, () => ({ flush }), [flush]);

  // Autoguardado con debounce (si está desactivado, solo Ctrl+S / al salir).
  useEffect(() => {
    if (saveState !== "dirty" || !autoSaveEnabled) return;

    const timer = setTimeout(() => void persistRef.current(), debounceMs);
    return () => clearTimeout(timer);
  }, [title, content, saveState, debounceMs, autoSaveEnabled]);

  // Al desmontar (p. ej. cambiar de pestaña) se vuelca lo que quede pendiente.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        void persistRef.current();
      }
    };
  }, []);

  function editTitle(next: string) {
    setTitle(next);
    setSaveState("dirty");
  }

  function editContent(next: string) {
    setContent(next);
    setSaveState("dirty");
  }

  /** Cambios del área de texto: el frontmatter oculto vuelve a su sitio. */
  function editBody(nextBody: string) {
    editContent(replaceBody(content, nextBody));
  }

  /** Cambia entre el markdown renderizado en vivo y el código fuente crudo. */
  function toggleInline() {
    const next = !inline;
    setInline(next);
    try {
      localStorage.setItem(INLINE_PREVIEW_KEY, next ? "1" : "0");
    } catch {
      // Sin almacenamiento disponible: la preferencia vale para esta sesión.
    }
  }

  /** Línea del cursor en el área: esa se pinta en crudo en la capa de atrás. */
  function refreshCaretLine() {
    const area = textareaRef.current;
    if (!area) return;
    const line = area.value.slice(0, area.selectionStart).split("\n").length - 1;
    setCaretLine((current) => (current === line ? current : line));
  }

  /** El overlay sigue el scroll y el ancho útil (scrollbar) del textarea. */
  function syncOverlayGeometry() {
    const area = textareaRef.current;
    if (!area) return;

    const overlay = overlayRef.current;
    if (overlay) overlay.scrollTop = area.scrollTop;

    const width = area.offsetWidth - area.clientWidth;
    setScrollbarWidth((current) => (current === width ? current : width));
  }

  /** Estado de la casilla de la tarea de la línea `line` (1-based); `null` si no lo es. */
  function taskCheckedAt(line: number): boolean | null {
    const match = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/.exec(content.split("\n")[line - 1] ?? "");
    return match ? match[1] !== " " : null;
  }

  /**
   * Marca/desmarca la tarea de la línea `line` desde la vista previa: edita el
   * markdown fuente y el autoguardado (debounce de 500 ms) lo persiste con
   * `write_vault_file`.
   */
  function toggleTaskAt(line: number) {
    const lines = content.split("\n");
    const source = lines[line - 1];
    if (source === undefined) return;

    const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(source);
    if (!match) return;

    const nextState = match[2] === " " ? "x" : " ";
    lines[line - 1] = `${match[1]}${nextState}${match[3]}${source.slice(match[0].length)}`;
    editContent(lines.join("\n"));
  }

  // ------------------------------------------------------------------
  // Etiquetas de la nota (chips en la cabecera → frontmatter `tags:`)
  // ------------------------------------------------------------------

  /**
   * Escribe las etiquetas en el frontmatter sin tocar el cuerpo: el textarea
   * no muestra ese bloque, así que su texto (y el cursor) no se mueven.
   */
  function applyNoteTags(next: string[]) {
    const updated = setNoteTags(content, next);
    if (updated === content) return;
    editContent(updated);
  }

  /** Pide las etiquetas de todo el vault para el menú desplegable. */
  function loadVaultTags() {
    if (!vaultPath) return;

    const request = ++tagRequestRef.current;
    invoke<VaultTag[]>("list_vault_tags", { path: vaultPath })
      .then((tags) => {
        if (request === tagRequestRef.current) setVaultTags(tags);
      })
      .catch(() => {
        // Sin lista disponible: el campo sigue creando etiquetas a mano.
      });
  }

  /** Añade la etiqueta elegida en el desplegable. */
  function pickTag(tag: string) {
    applyNoteTags([...parseNoteTags(content), tag]);
    setTagInput("");
    setTagIndex(0);
  }

  /** Vuelca lo tecleado en el campo de etiquetas a chips. */
  function commitTagInput() {
    const parsed = parseTagInput(tagInput);
    if (parsed.length === 0) return;

    applyNoteTags([...parseNoteTags(content), ...parsed]);
    setTagInput("");
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const options = tagOptions(vaultTags, tagInput, parseNoteTags(content));

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!tagMenuOpen || options.length === 0) return;
      event.preventDefault();

      const current = Math.min(tagIndex, options.length - 1);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % options.length
          : current <= 0
            ? options.length - 1
            : current - 1;
      setTagIndex(next);
      return;
    }

    if (event.key === "Escape") {
      if (!tagMenuOpen) return;
      event.preventDefault();
      setTagMenuOpen(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      // Con opciones disponibles Intro elige la resaltada; si no, crea la tecleada.
      if (tagMenuOpen && options.length > 0) {
        pickTag(options[Math.min(tagIndex, options.length - 1)].tag);
        return;
      }
      commitTagInput();
      return;
    }

    // Backspace en el campo vacío elimina el último chip.
    if (event.key === "Backspace" && tagInput === "") {
      const tags = parseNoteTags(content);
      if (tags.length > 0) applyNoteTags(tags.slice(0, -1));
    }
  }

  function handleTagInputChange(value: string) {
    // Escribir una coma confirma al instante lo que haya tecleado.
    if (/[,，]/.test(value)) {
      applyNoteTags([...parseNoteTags(content), ...parseTagInput(value)]);
      setTagInput("");
      return;
    }
    setTagInput(value);
    setTagIndex(0);
  }

  // ------------------------------------------------------------------
  // Menús del editor: autocompletado `[[` y bloques con `/`
  // ------------------------------------------------------------------

  /** Pide la lista de notas del vault (para `[[` y para los enlaces reales). */
  function loadWikiNotes() {
    if (!vaultPath) return;

    const request = ++wikiRequestRef.current;
    setWikiNotesLoading(true);

    invoke<WikiNote[]>("list_vault_notes", { path: vaultPath })
      .then((notes) => {
        if (request !== wikiRequestRef.current) return;
        setWikiNotes(notes);
        setWikiNotesLoading(false);
      })
      .catch(() => {
        if (request !== wikiRequestRef.current) return;
        setWikiNotesLoading(false);
      });
  }

  /**
   * Muestra (o no) el recordatorio de «/»: solo cuando la línea del cursor
   * está limpia. La nota vacía no lo necesita: su propio placeholder ya
   * recuerda el comando.
   */
  function syncLineHint(text: string, caret: number) {
    const area = textareaRef.current;
    if (!area || text === "" || area.selectionStart !== area.selectionEnd) {
      setLineHint(null);
      return;
    }
    if (lineAtCaret(text, caret).trim() !== "") {
      setLineHint(null);
      return;
    }

    const next = caretAnchor(area, caret);
    setLineHint((current) =>
      current &&
      current.top === next.top &&
      current.left === next.left &&
      current.height === next.height
        ? current
        : next,
    );
  }

  /** Abre (o cierra) el menú que toque según lo que haya antes del cursor. */
  function syncMenu(text: string, caret: number) {
    syncLineHint(text, caret);

    const wiki = detectWikiQuery(text, caret);
    if (wiki) {
      const area = textareaRef.current;
      if (area) {
        const anchor = caretAnchor(area, caret);
        setMenu((current) =>
          current &&
          current.kind === "wiki" &&
          current.start === wiki.start &&
          current.query === wiki.query
            ? current
            : { kind: "wiki", start: wiki.start, query: wiki.query, index: 0, anchor },
        );
      }
      if (!menu || menu.kind !== "wiki") loadWikiNotes();
      return;
    }

    const slash = detectSlashQuery(text, caret);
    if (slash) {
      const area = textareaRef.current;
      if (area) {
        const anchor = caretAnchor(area, caret);
        setMenu((current) =>
          current &&
          current.kind === "slash" &&
          current.start === slash.start &&
          current.query === slash.query
            ? current
            : { kind: "slash", start: slash.start, query: slash.query, index: 0, anchor },
        );
      }
      return;
    }

    setMenu(null);
  }

  /** Cambio de texto: autoguarda y vuelve a evaluar el menú del cursor. */
  function handleContentChange(next: string) {
    refreshCaretLine(); // el cursor ya apunta a la línea que corresponde
    editBody(next);
    // Los rangos del menú ortográfico ya no son fiables: se cierra.
    setSpellMenu(null);
    const area = textareaRef.current;
    syncMenu(next, area?.selectionStart ?? next.length);
  }

  /** El cursor se mueve (ratón o flechas): el menú debe seguirle o irse. */
  function handleCaretMove() {
    const area = textareaRef.current;
    if (!area) return;
    refreshCaretLine(); // la línea decorada cambia con el cursor
    setSpellMenu(null);
    syncMenu(area.value, area.selectionStart);
  }

  /** El textarea se desplaza: menú, recordatorio y capa en vivo le siguen. */
  function handleScroll() {
    const area = textareaRef.current;
    if (!area) return;
    if (menu) setMenu({ ...menu, anchor: caretAnchor(area, area.selectionStart) });
    setLineHint((current) => (current ? caretAnchor(area, area.selectionStart) : current));
    syncOverlayGeometry();
  }

  /** Sustituye `[start, cursor]` por `text` y deja el cursor en `caretOffset`. */
  function replaceRange(start: number, text: string, caretOffset: number) {
    const area = textareaRef.current;
    const current = area?.value ?? stripFrontmatter(content);
    const cursor = Math.max(area?.selectionEnd ?? current.length, start);

    pendingCaretRef.current = [start + caretOffset, start + caretOffset];
    editBody(`${current.slice(0, start)}${text}${current.slice(cursor)}`);
    setMenu(null);
  }

  /** Inserta el enlace de la nota elegida en el desplegable `[[`. */
  function insertWikiNote(note: WikiNote) {
    if (!menu) return;
    const text = wikiInsertText(wikiNotes, note);
    replaceRange(menu.start, text, text.length);
  }

  /** Inserta el enlace tal cual (sin notas que coincidan, a mano). */
  function insertWikiRaw() {
    if (!menu) return;
    const text = `[[${menu.query}]]`;
    replaceRange(menu.start, text, text.length);
  }

  /** Inserta el bloque del menú `/` con el cursor donde deja su snippet. */
  function insertSlashItem(item: SlashItem) {
    if (!menu) return;
    replaceRange(menu.start, item.snippet, item.caretOffset);
  }

  // ------------------------------------------------------------------
  // Menú contextual del corrector (clic derecho sobre una palabra)
  // ------------------------------------------------------------------

  /**
   * Botón derecho en el área: solo se intercepta si cae sobre una palabra en
   * rojo (o sobre una del diccionario personal, para poder quitarla). Con
   * selección —o sin corrector— manda el menú del sistema, que ya trae
   * cortar/copiar/pegar.
   */
  function handleContextMenu(event: MouseEvent<HTMLTextAreaElement>) {
    const area = event.currentTarget;
    if (!engine || area.selectionStart !== area.selectionEnd) return;

    // La palabra bajo el ratón; si no se puede ubicar, la del cursor.
    const offset =
      offsetAtPointer(area, event.clientX, event.clientY) ?? area.selectionStart;
    const span = spellWordAt(area.value, offset, engine.correct);
    if (!span) return;

    if (!span.bad) {
      // Solo las palabras propias merecen menú: para quitarlas del diccionario.
      if (!isPersonalWord(span.word)) return;
      event.preventDefault();
      setMenu(null);
      setSpellMenu({
        mode: "personal",
        word: span.word,
        start: span.start,
        end: span.end,
        suggestions: [],
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }

    event.preventDefault();
    setMenu(null); // el menú `[[`/`/` no debe competir con este
    setSpellMenu({
      mode: "misspelled",
      word: span.word,
      start: span.start,
      end: span.end,
      suggestions: engine.suggest(span.word),
      x: event.clientX,
      y: event.clientY,
    });
  }

  /** Sustituye la palabra del menú por `replacement` y deja el cursor tras ella. */
  function applySpellReplacement(replacement: string) {
    if (!spellMenu) return;
    const area = textareaRef.current;
    const current = area?.value ?? stripFrontmatter(content);
    const start = Math.min(spellMenu.start, current.length);
    const end = Math.min(Math.max(spellMenu.end, start), current.length);

    pendingCaretRef.current = [start + replacement.length, start + replacement.length];
    editBody(`${current.slice(0, start)}${replacement}${current.slice(end)}`);
    setSpellMenu(null);
  }

  /** Agrega la palabra al diccionario personal y la persiste en ajustes. */
  function addSpellWord() {
    if (!spellMenu) return;
    if (addPersonalWord(spellMenu.word)) onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
    setSpellMenu(null);
  }

  /** Olvida la palabra durante esta sesión (no se guarda en ningún sitio). */
  function ignoreSpellWord() {
    if (!spellMenu) return;
    ignoreWord(spellMenu.word);
    setSpellRevision((value) => value + 1);
    setSpellMenu(null);
  }

  /** Quita la palabra del diccionario personal y actualiza los ajustes. */
  function removeSpellWord() {
    if (!spellMenu) return;
    removePersonalWord(spellMenu.word);
    onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
    setSpellMenu(null);
  }

  // Ctrl/Cmd + S guarda sin esperar al debounce; el resto de teclas dependen
  // de si hay un menú abierto sobre el cursor.
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && spellMenu) {
      event.preventDefault();
      setSpellMenu(null);
      return;
    }

    if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void persistRef.current();
      return;
    }

    if (menu) {
      handleMenuKeyDown(event);
      // Solo si el menú no se comió la tecla (p. ej. «/» sin coincidencias).
      if (event.defaultPrevented) return;
    }

    handleListEnter(event);
  }

  /**
   * Intro en el texto: continúa las listas (`-`, `*`, `1.`, `- [ ]`…) con la
   * misma sangría (y el número siguiente en las ordenadas); un Intro sobre un
   * ítem vacío retira el marcador y cierra la lista. Si la línea no es de
   * lista, el salto es el normal del sistema.
   */
  function handleListEnter(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter") return;
    // Solo el Intro simple: Shift/Ctrl/Alt+Intro y la entrada IME son normales.
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.nativeEvent.isComposing) return;

    const area = event.target;
    if (!(area instanceof HTMLTextAreaElement)) return;
    // Con selección, el salto sustituye lo seleccionado: no interferir.
    if (area.selectionStart !== area.selectionEnd) return;

    const edit = listEnterEdit(area.value, area.selectionStart);
    if (!edit) return;

    event.preventDefault();
    replaceRange(edit.start, edit.insert, edit.caret - edit.start);
  }

  /** Flechas, Intro/Tab y Esc mientras el menú está abierto. */
  function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menu) return;

    if (event.key === "Escape") {
      event.preventDefault();
      setMenu(null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const size =
        menu.kind === "wiki"
          ? wikiMatches(wikiNotes, menu.query).length
          : filterSlashItems(menu.query).length;
      if (size === 0) return;

      const current = Math.min(menu.index, size - 1);
      const next =
        event.key === "ArrowDown"
          ? (current + 1) % size
          : current <= 0
            ? size - 1
            : current - 1;
      setMenu({ ...menu, index: next });
      return;
    }

    if (event.key !== "Enter" && event.key !== "Tab") return;

    if (menu.kind === "wiki") {
      const matches = wikiMatches(wikiNotes, menu.query);
      event.preventDefault();
      if (matches.length === 0) insertWikiRaw();
      else insertWikiNote(matches[Math.min(menu.index, matches.length - 1)]);
      return;
    }

    const items = filterSlashItems(menu.query);
    if (items.length === 0) return; // sin coincidencias se sigue escribiendo
    event.preventDefault();
    insertSlashItem(items[Math.min(menu.index, items.length - 1)]);
  }

  const statusLabel =
    saveState === "dirty"
      ? "Editando…"
      : saveState === "saved"
        ? "Guardado"
        : saveState === "error"
          ? "Error al guardar"
          : "Sin cambios";

  const statusDot =
    saveState === "dirty"
      ? "bg-amber-400"
      : saveState === "saved"
        ? "bg-emerald-400"
        : saveState === "error"
          ? "bg-rose-400"
          : "bg-gus-muted";

  // El frontmatter no se escribe ni se previsualiza: el textarea y la vista
  // previa comparten el cuerpo; sus líneas se descuentan de las posiciones de
  // las tareas para que las casillas toquen la línea correcta del archivo.
  const body = stripFrontmatter(content);
  const previewOffset = frontmatterLineOffset(content);
  const words = countWords(body);
  /** Líneas del cuerpo para la capa en vivo (el textarea normaliza CRLF). */
  const sourceLines = useMemo(() => body.split(/\r?\n/), [body]);
  /** Clasificación de bloques (cercados) memorizada con las líneas. */
  const sourceInfo = useMemo(() => classifySource(sourceLines), [sourceLines]);
  /**
   * Vista en vivo activa: solo en modo edición y en notas de tamaño
   * razonable; el resto vuelve al código fuente puro (sin capa de atrás).
   */
  const inlineActive = inline && viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;
  /**
   * En «Ver crudo» también hay capa, pero solo con las ondas del corrector:
   * repite cada línea con texto invisible para situar los subrayados bajo lo
   * que el textarea pinta encima (mismo tope de líneas que la vista en vivo).
   */
  const spellOverlay =
    spell !== null && viewMode === "edit" && sourceInfo.length <= MAX_DECORATED_LINES;
  /** Chips de la cabecera: salen del frontmatter del propio archivo. */
  const noteTags = parseNoteTags(content);
  /** Opciones del desplegable: etiquetas del vault que aún no están puestas. */
  const tagOptionList = tagOptions(vaultTags, tagInput, noteTags);

  /**
   * Renderizado del markdown en la vista previa, con el tema Calico
   * (`--color-gus-bg` de fondo y `--color-gus-card` en bloques y citas).
   * Las casillas de las tareas se pintan desde `li` y son clicables: editan el
   * `- [ ]` de la línea que corresponde (la posición viene del propio nodo).
   */
  const previewComponents: Components = {
    h1: ({ children }) => (
      <h1 className="mt-7 mb-3 border-b border-gus-border pb-2 text-3xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-6 mb-3 border-b border-gus-border pb-2 text-2xl font-bold tracking-tight text-gus-text first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-5 mb-2 text-xl font-semibold text-gus-text first:mt-0">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-4 mb-2 text-lg font-semibold text-gus-text first:mt-0">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="mt-4 mb-2 text-xs font-semibold tracking-wider text-gus-muted uppercase first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children }) => (
      <h6 className="mt-4 mb-2 text-xs font-semibold tracking-wider text-gus-muted/80 uppercase first:mt-0">
        {children}
      </h6>
    ),
    p: ({ children }) => <p className="my-3 leading-7 text-gus-text first:mt-0 last:mb-0">{children}</p>,
    a: ({ href, children }) => {
      const wikiTarget = href ? decodeWikiUrl(href) : null;

      // `[[enlace]]`: botón que la app convierte en «abrir esa nota».
      if (wikiTarget !== null) {
        const known = findWikiNote(wikiNotes, wikiTarget) !== null;

        return (
          <button
            type="button"
            onClick={() => onOpenWikiLink?.(wikiTarget)}
            title={
              known
                ? `Abrir «${wikiTarget}»`
                : `«${wikiTarget}» no existe todavía: se creará al pulsarlo`
            }
            className={clsx(
              "inline cursor-pointer rounded text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              known
                ? "text-gus-accent underline decoration-gus-accent/40 underline-offset-2 hover:decoration-gus-accent"
                : "text-gus-muted underline decoration-dashed decoration-gus-muted/60 hover:text-gus-text",
            )}
          >
            {children}
          </button>
        );
      }

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-gus-accent underline decoration-gus-accent/40 underline-offset-2 transition-colors hover:decoration-gus-accent"
        >
          {children}
        </a>
      );
    },
    ul: ({ children }) => (
      <ul className="my-3 list-disc space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 list-decimal space-y-1.5 pl-6 text-gus-text marker:text-gus-accent/70">
        {children}
      </ol>
    ),
    li: ({ node, children }) => {
      const rawClass = node?.properties?.className;
      const classNames = Array.isArray(rawClass) ? rawClass.map(String) : [];
      const line = node?.position?.start?.line;

      if (!classNames.includes("task-list-item") || typeof line !== "number") {
        return <li className="leading-7">{children}</li>;
      }

      // El bloque oculto mueve las líneas: se descuenta antes de leer el fuente.
      const sourceLine = line - previewOffset;
      const checked = taskCheckedAt(sourceLine) === true;

      return (
        <li className="my-1.5 flex list-none items-start gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={checked ? "Marcar tarea como pendiente" : "Marcar tarea como completada"}
            onClick={() => toggleTaskAt(sourceLine)}
            className={clsx(
              "mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60",
              checked
                ? "border-gus-accent bg-gus-accent text-gus-bg"
                : "border-gus-muted/50 bg-gus-card hover:border-gus-accent/60",
            )}
          >
            {checked && <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
          </button>
          <div className={clsx("min-w-0 flex-1", checked && "text-gus-muted line-through")}>
            {children}
          </div>
        </li>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="my-4 rounded-r-xl border-l-4 border-gus-accent/60 bg-gus-card px-4 py-3 text-gus-muted italic [&_p:first-child]:mt-0 [&_p:last-child]:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-6 border-gus-border" />,
    strong: ({ children }) => <strong className="font-semibold text-gus-text">{children}</strong>,
    del: ({ children }) => <del className="text-gus-muted line-through">{children}</del>,
    pre: ({ children }) => (
      <pre className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border bg-gus-card px-4 py-3 text-[13px] leading-relaxed text-gus-text [&_code]:rounded-none [&_code]:bg-transparent [&_code]:px-0 [&_code]:text-inherit">
        {children}
      </pre>
    ),
    code: ({ className, children }) => {
      // Los diagramas Mermaid se dibujan (la librería se descarga al vuelo).
      const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
      if (language === "mermaid") {
        return <MermaidDiagram code={String(children).replace(/\n+$/, "")} />;
      }

      return language ? (
        <code className={clsx("font-mono", className)}>{children}</code>
      ) : (
        <code className="rounded bg-gus-card px-1.5 py-0.5 font-mono text-[0.9em] text-gus-accent">
          {children}
        </code>
      );
    },
    table: ({ children }) => (
      <div className="gus-scrollbar my-4 overflow-x-auto rounded-xl border border-gus-border">
        <table className="w-full text-left text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-gus-card text-[11px] tracking-wide text-gus-muted uppercase">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className="border-b border-gus-border px-3 py-2 font-semibold text-gus-text">{children}</th>
    ),
    tr: ({ children }) => <tr className="odd:bg-gus-card/40">{children}</tr>,
    td: ({ children }) => (
      <td className="border-b border-gus-border/60 px-3 py-2 align-top text-gus-text">{children}</td>
    ),
    // Las casillas las pinta el `li` (necesita la línea de origen).
    input: () => null,
  };

  /** Panel de la vista «Previsualizar» (a pantalla completa, solo lectura). */
  function previewPane() {
    return (
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="Vista previa de la nota"
        className="gus-scrollbar min-h-0 flex-1 overflow-y-auto bg-gus-bg px-6 py-5 focus:outline-none"
      >
        {body.trim() === "" ? (
          <p className="text-sm text-gus-muted">
            Esta nota está vacía. Pulsa «Editar» para escribir.
          </p>
        ) : (
          <article className="mx-auto max-w-3xl pb-10">
            <Suspense fallback={<p className="text-sm text-gus-muted">Cargando vista previa…</p>}>
              <MarkdownBody components={previewComponents}>{body}</MarkdownBody>
            </Suspense>
          </article>
        )}
      </div>
    );
  }

  return (
    <div className={clsx("flex h-full min-h-0 flex-col bg-gus-bg", className)}>
      <header className="shrink-0 border-b border-gus-border px-6 py-4">
        <div className="flex items-start gap-3">
          <input
            value={title}
            onChange={(event) => editTitle(event.target.value)}
            placeholder="Sin título"
            aria-label="Título de la nota"
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-gus-text outline-none placeholder:text-gus-muted"
          />

          {/* Vista en vivo (estilo Obsidian) ↔ solo código fuente */}
          {viewMode === "edit" && (
            <button
              type="button"
              onClick={toggleInline}
              title={
                inline
                  ? "Ver solo el código fuente, sin resaltar"
                  : "Ver el markdown renderizado mientras escribes (como en Obsidian)"
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-3 py-1.5 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
            >
              <Code className="h-4 w-4" aria-hidden="true" />
              {inline ? "Ver crudo" : "Ver en vivo"}
            </button>
          )}

          {/* Alterna entre edición y vista previa */}
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setViewMode(viewMode === "edit" ? "preview" : "edit");
            }}
            aria-label={viewMode === "edit" ? "Previsualizar la nota" : "Volver a editar la nota"}
            title={viewMode === "edit" ? "Previsualizar" : "Editar"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-3 py-1.5 text-xs text-gus-muted outline-none transition-colors hover:border-gus-accent/50 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60"
          >
            {viewMode === "edit" ? (
              <>
                <Eye className="h-4 w-4" aria-hidden="true" />
                Previsualizar
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Editar
              </>
            )}
          </button>
        </div>

        {/* Etiquetas de la nota: chips del frontmatter, nunca como texto */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {noteTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[11px] text-gus-accent"
            >
              {tag}
              <button
                type="button"
                onClick={() => applyNoteTags(noteTags.filter((item) => item !== tag))}
                aria-label={`Quitar etiqueta ${tag}`}
                className="-mr-1 rounded-full opacity-70 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}

          <div className="relative min-w-40 max-w-64 flex-1">
            <input
              value={tagInput}
              onChange={(event) => handleTagInputChange(event.target.value)}
              onKeyDown={handleTagInputKeyDown}
              onFocus={() => {
                if (!vaultPath) return;
                loadVaultTags();
                setTagMenuOpen(true);
              }}
              onBlur={() => {
                commitTagInput();
                setTagMenuOpen(false);
              }}
              placeholder={noteTags.length > 0 ? "añadir etiqueta…" : "añadir etiqueta (Enter o coma)…"}
              aria-label="Etiquetas de la nota"
              role="combobox"
              aria-expanded={tagMenuOpen}
              aria-controls="gus-tag-menu"
              className="w-full rounded-full border border-transparent bg-gus-card/60 px-2.5 py-0.5 text-[11px] text-gus-text outline-none transition-colors placeholder:text-gus-muted/70 focus:border-gus-accent/50"
            />

            {/* Etiquetas ya usadas en el vault: clic o Intro para añadirlas */}
            {tagMenuOpen && (
              <div
                id="gus-tag-menu"
                role="listbox"
                aria-label="Etiquetas del vault"
                className="absolute left-0 top-full z-30 mt-1 max-h-56 w-64 min-w-full overflow-y-auto rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl"
              >
                {tagOptionList.length === 0 ? (
                  <p className="px-3 py-1.5 text-[11px] text-gus-muted">
                    {tagInput
                      ? `Sin coincidencias · Intro para crear «${tagInput}»`
                      : "Todavía no hay etiquetas en el vault"}
                  </p>
                ) : (
                  tagOptionList.map((entry, index) => (
                    <button
                      key={entry.tag}
                      type="button"
                      role="option"
                      aria-selected={index === Math.min(tagIndex, tagOptionList.length - 1)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickTag(entry.tag)}
                      onMouseEnter={() => setTagIndex(index)}
                      className={clsx(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] outline-none",
                        index === Math.min(tagIndex, tagOptionList.length - 1)
                          ? "bg-gus-accent/15 text-gus-accent"
                          : "text-gus-text hover:bg-gus-card",
                      )}
                    >
                      <span className="truncate">{entry.tag}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-gus-muted">
                        {entry.count} nota{entry.count === 1 ? "" : "s"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gus-muted">
          <span className="flex items-center gap-1.5" role="status" aria-live="polite">
            <span className={clsx("h-1.5 w-1.5 rounded-full", statusDot)} aria-hidden="true" />
            {statusLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {words} palabra{words === 1 ? "" : "s"} · {body.length} carácter
            {body.length === 1 ? "" : "es"}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-gus-muted/70">Ctrl+S para guardar</span>
        </div>
        {saveError && (
          <p className="mt-2 break-words rounded-md border border-rose-400/30 bg-rose-400/5 px-2 py-1.5 text-[11px] text-rose-300">
            {saveError}
          </p>
        )}
      </header>

      {viewMode === "edit" ? (
        <div className="relative min-h-0 w-full flex-1 bg-gus-bg">
          {/* Vista en vivo: markdown renderizado detrás del texto transparente
              del textarea; la línea del cursor se pinta en crudo para poder
              seguir editando `###`, `- [ ]`, etc. */}
          {(inlineActive || spellOverlay) && (
            <InlinePreview
              lines={sourceInfo}
              caretLine={caretLine}
              scrollbarWidth={scrollbarWidth}
              fontSize={fontSize}
              hidden={composing}
              overlayRef={overlayRef}
              spell={spell}
              raw={!inlineActive}
            />
          )}

          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => handleContentChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onSelect={handleCaretMove}
            onScroll={handleScroll}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onBlur={() => {
              setMenu(null);
              setSpellMenu(null);
            }}
            onContextMenu={handleContextMenu}
            placeholder="Escribe tu nota en markdown… — [[ enlazar otra nota · / insertar bloques"
            aria-label="Contenido de la nota"
            /* El corrector SIEMPRE es el nuestro (capa de atrás en vivo y
               capa de ondas en crudo): el nativo depende de diccionarios del
               sistema y trae un menú propio que chocaría con el nuestro. */
            spellCheck={false}
            lang={spellLang !== undefined && spellLang !== "off" ? spellLang : undefined}
            style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
            className={clsx(
              "gus-scrollbar relative h-full w-full resize-none px-6 py-4 font-mono text-sm leading-[23px] text-gus-text outline-none placeholder:text-gus-muted focus:outline-none",
              inlineActive && "gus-source-area",
              composing && "gus-source-text",
            )}
          />

          {/* Recordatorio del comando «/» sobre la línea limpia del cursor. */}
          {lineHint && !menu && (
            <span
              aria-hidden="true"
              style={{ position: "fixed", top: lineHint.top, left: lineHint.left + 8 }}
              className="pointer-events-none max-w-[60vw] select-none truncate font-mono text-sm leading-[23px] text-gus-muted/70"
            >
              Pulsa «/» para insertar bloques…
            </span>
          )}

          {/* Menús flotantes anclados al cursor del textarea. */}
          <AnimatePresence>
            {menu?.kind === "wiki" && (
              <WikiLinkMenu
                key="wiki"
                anchor={menu.anchor}
                notes={wikiMatches(wikiNotes, menu.query)}
                loading={wikiNotesLoading}
                query={menu.query}
                index={menu.index}
                onPick={insertWikiNote}
                onHover={(index) => setMenu({ ...menu, index })}
              />
            )}

            {menu?.kind === "slash" && (
              <SlashMenu
                key="slash"
                anchor={menu.anchor}
                items={filterSlashItems(menu.query)}
                index={menu.index}
                onPick={insertSlashItem}
                onHover={(index) => setMenu({ ...menu, index })}
              />
            )}
          </AnimatePresence>

          {/* Menú del corrector: solo sobre palabras en rojo o propias. */}
          {spellMenu && (
            <SpellMenu
              mode={spellMenu.mode}
              word={spellMenu.word}
              x={spellMenu.x}
              y={spellMenu.y}
              suggestions={spellMenu.suggestions}
              onPick={applySpellReplacement}
              onAdd={addSpellWord}
              onIgnore={ignoreSpellWord}
              onRemove={removeSpellWord}
              onClose={() => setSpellMenu(null)}
            />
          )}
        </div>
      ) : (
        previewPane()
      )}
    </div>
  );
}
