import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from "react";
import { addPersonalWord, getPersonalWords, ignoreWord, loadSpellEngines, removePersonalWord, spellSegments, spellWordAt, type SpellEngine, type SpellFn, type SpellLang } from "../lib/spellCheck";
import { caretAnchor } from "../lib/caretPosition";
import { stripFrontmatter } from "../lib/noteTags";
import { toLocalCoord } from "../lib/uiZoom";
import type { ContextMenuState, SpellPopup, ViewMode } from "./markdownEditorTypes";

/** Lo que el corrector necesita del editor: el campo de texto, la nota y el menú contextual. */
export interface EditorSpellDeps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  pendingCaretRef: RefObject<[number, number] | null>;
  viewMode: ViewMode;
  content: string;
  contextMenu: ContextMenuState | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  /** Escribe el cuerpo de la nota (sin frontmatter): así se aplica una corrección. */
  editBody: (next: string) => void;
  spellLangs?: SpellLang[];
  spellWords: string[];
  onSpellWordsChange?: (words: string[]) => void;
}

/**
 * Corrector ortográfico: carga los diccionarios, marca las palabras erróneas
 * (`spell`), calcula el cuadro de sugerencias bajo el cursor y aplica
 * correcciones, tanto desde ese cuadro como desde el menú contextual.
 */
export function useEditorSpell(deps: EditorSpellDeps) {
  const { textareaRef, pendingCaretRef, viewMode, content, contextMenu, setContextMenu, editBody, spellLangs, spellWords, onSpellWordsChange } = deps;

  const [engine, setEngine] = useState<SpellEngine | null>(null);

  const [spellRevision, setSpellRevision] = useState(0);

  const [spellPopup, setSpellPopup] = useState<SpellPopup | null>(null);
  const spellPopupTimerRef = useRef<number | null>(null);
  const spellSuggestCacheRef = useRef<{ word: string; list: string[] } | null>(null);
  /** Palabra descartada con Esc: no vuelve a abrirse hasta que el cursor salga. */
  const spellDismissedRef = useRef<{ word: string; start: number } | null>(null);
  /** Selección de la que ya partió un recálculo (corta bucles de recálculo). */
  const lastSpellSelRef = useRef<string | null>(null);
  // El temporizador vive fuera del render: siempre ejecuta la última versión.
  const spellPopupSyncRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    spellPopupSyncRef.current = syncSpellPopup;
  });

  useEffect(() => {
    const langs = spellLangs ?? [];
    if (langs.length === 0) {
      setEngine(null);
      return;
    }
    let alive = true;
    setEngine(null);
    void loadSpellEngines(langs).then((loaded) => {
      if (alive) setEngine(loaded);
    });
    return () => {
      alive = false;
    };
    // `spellLangs` viene del estado de ajustes y mantiene su identidad entre
    // renders, así que comparar por referencia equivale a comparar por
    // contenido y la dependencia se queda simple.
  }, [spellLangs]);

  const spell = useMemo<SpellFn | null>(() => {
    // `spellWords` se referencia a propósito: no cambia el resultado, pero
    // sí la identidad de `spell`, y con ella las líneas memorizadas que
    // vuelven a marcar el texto cuando cambia el diccionario.
    void spellWords;
    return engine ? (text: string) => spellSegments(text, engine.correct) : null;
  }, [engine, spellWords, spellRevision]);

  /** El motor cambia (idioma): se olvida lo sugerido antes. */
  useEffect(() => {
    spellSuggestCacheRef.current = null;
    if (engine) scheduleSpellPopup(0);
  }, [engine]);

  /**
   * El cursor no siempre pasa por «select» (hay movimientos programáticos), así
   * que se vigila la selección del documento. Solo si ha cambiado respecto a
   * la última vez que se programó un recálculo se vuelve a calcular: eso
   * también corta cualquier selección disparada por el propio cálculo.
   */
  useEffect(() => {
    const onSelectionChange = () => {
      const area = textareaRef.current;
      if (!area || document.activeElement !== area) return;
      const current = `${area.selectionStart}/${area.selectionEnd}`;
      if (current === lastSpellSelRef.current) return;
      scheduleSpellPopup();
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  /** Sugerencias de hunspell con caché de un término (se repiten al navegar). */
  function suggestionsFor(word: string): string[] {
    const cached = spellSuggestCacheRef.current;
    if (cached && cached.word === word) return cached.list;
    const list = engine ? engine.suggest(word) : [];
    spellSuggestCacheRef.current = { word, list };
    return list;
  }

  /**
   * Recalcula el cuadro de correcciones para la palabra bajo el cursor. No se
   * muestra si el motor aún no está listo, si el editor no tiene el foco o si
   * la palabra se ha quedado fuera de la vista.
   */
  function syncSpellPopup() {
    const area = textareaRef.current;
    if (
      !area ||
      !engine ||
      viewMode === "preview" ||
      document.activeElement !== area ||
      area.selectionStart !== area.selectionEnd
    ) {
      setSpellPopup(null);
      return;
    }

    const caret = area.selectionStart;
    const span = spellWordAt(area.value, caret, engine.correct);
    const dismissed = spellDismissedRef.current;
    if (dismissed && (!span || dismissed.word !== span.word || dismissed.start !== span.start)) {
      spellDismissedRef.current = null; // el cursor ya salió de esa palabra
    }
    if (!span || !span.bad) {
      setSpellPopup(null);
      return;
    }
    if (spellDismissedRef.current) {
      setSpellPopup(null);
      return;
    }

    const suggestions = suggestionsFor(span.word);
    if (suggestions.length === 0) {
      setSpellPopup(null);
      return;
    }

    const anchor = caretAnchor(area, span.start);
    const rect = area.getBoundingClientRect();
    const visibleTop = toLocalCoord(rect.top);
    const visibleBottom = toLocalCoord(rect.bottom);
    if (anchor.top < visibleTop || anchor.top + anchor.height > visibleBottom) {
      setSpellPopup(null);
      return;
    }

    setSpellPopup((current) =>
      current && current.start === span.start && current.word === span.word
        ? // Mismo término: se conserva el índice marcado con ↑/↓.
          { ...current, end: span.end, suggestions, anchor }
        : { start: span.start, end: span.end, word: span.word, suggestions, index: -1, anchor },
    );
  }

  /** Debounce: el cuadro sale cuando el cursor deja de moverse o de teclear. */
  function scheduleSpellPopup(delay = 160) {
    if (spellPopupTimerRef.current !== null) window.clearTimeout(spellPopupTimerRef.current);
    const area = textareaRef.current;
    lastSpellSelRef.current = area ? `${area.selectionStart}/${area.selectionEnd}` : null;
    spellPopupTimerRef.current = window.setTimeout(() => {
      spellPopupTimerRef.current = null;
      spellPopupSyncRef.current();
    }, delay);
  }

  /** Cierra el cuadro y cancela su cálculo pendiente. */
  function closeSpellPopup() {
    if (spellPopupTimerRef.current !== null) {
      window.clearTimeout(spellPopupTimerRef.current);
      spellPopupTimerRef.current = null;
    }
    setSpellPopup(null);
  }

  /** Sustituye el rango [start, end) por `replacement` y deja el cursor tras él. */
  function replaceSpellWord(start: number, end: number, replacement: string) {
    const area = textareaRef.current;
    const current = area?.value ?? stripFrontmatter(content);
    setContextMenu(null);
    const from = Math.min(start, current.length);
    const to = Math.min(Math.max(end, from), current.length);

    pendingCaretRef.current = [from + replacement.length, from + replacement.length];
    editBody(`${current.slice(0, from)}${replacement}${current.slice(to)}`);
    scheduleSpellPopup();
  }

  function applySpellReplacement(replacement: string) {
    const spell = contextMenu?.spell;
    if (!spell) {
      setContextMenu(null);
      return;
    }
    replaceSpellWord(spell.start, spell.end, replacement);
  }

  /**
   * Corrige la palabra errónea bajo el cursor sin ratón (Alt+Intro o el cuadro
   * de sugerencias). Devuelve `true` si había una palabra errónea: aunque no
   * tenga candidatas se consume la tecla para que no parta la línea sin querer.
   */
  function applySpellCorrection(suggestion?: string): boolean {
    const area = textareaRef.current;
    if (!area || !engine) return false;

    const caret = Math.max(area.selectionStart, area.selectionEnd);
    const span = spellWordAt(area.value, caret, engine.correct);
    if (!span || !span.bad) return false;

    const list = suggestionsFor(span.word);
    const popup = spellPopup;
    const marked =
      popup && popup.start === span.start && popup.word === span.word ? popup.index : -1;
    const target = suggestion ?? list[marked >= 0 ? marked : 0];
    // Palabra errónea sin candidatas: la tecla se consume igual para no partir
    // la línea sin querer.
    if (!target) return true;

    replaceSpellWord(span.start, span.end, target);
    return true;
  }

  function addSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    if (addPersonalWord(word)) onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
  }

  function ignoreSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    ignoreWord(word);
    setSpellRevision((value) => value + 1);
  }

  function removeSpellWord() {
    const word = contextMenu?.spell?.word;
    setContextMenu(null);
    if (!word) return;
    removePersonalWord(word);
    onSpellWordsChange?.(getPersonalWords());
    setSpellRevision((value) => value + 1);
  }

  /**
   * Teclado del cuadro de sugerencias. Mientras nadie lo ha recorrido con ↑/↓
   * no se secuestran teclas: el cuadro solo informa y el cursor sigue moviéndose
   * y partiendo líneas. En cuanto se toca la lista, ↑/↓ eligen y Intro o los
   * números 1-9 aplican la corrección; Esc lo cierra siempre.
   */
  function handleSpellPopupKeys(event: KeyboardEvent<HTMLElement>): boolean {
    const popup = spellPopup;
    if (!popup || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;

    if (event.key === "Escape") {
      event.preventDefault();
      spellDismissedRef.current = { word: popup.word, start: popup.start };
      closeSpellPopup();
      return true;
    }

    // El cuadro puede ir por detrás del cursor (recálculo aplazado): no se
    // aplica nada si esa palabra ya no es la que se tiene debajo.
    const area = textareaRef.current;
    const caret = area ? area.selectionStart : -1;
    if (
      !area ||
      caret < popup.start ||
      caret > popup.end ||
      area.value.slice(popup.start, popup.end) !== popup.word
    ) {
      scheduleSpellPopup(0);
      return false;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const size = popup.suggestions.length;
      if (size === 0) return false;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      const next =
        popup.index < 0
          ? down
            ? 0
            : size - 1
          : down
            ? (popup.index + 1) % size
            : popup.index <= 0
              ? size - 1
              : popup.index - 1;
      setSpellPopup({ ...popup, index: next });
      return true;
    }

    // La lista todavía no se ha tocado: Intro parte línea y los dígitos escriben.
    if (popup.index < 0) return false;

    if (event.key === "Enter") {
      if (!applySpellCorrection(popup.suggestions[popup.index])) return false;
      event.preventDefault();
      return true;
    }

    if (/^[1-9]$/.test(event.key)) {
      const target = popup.suggestions[Number(event.key) - 1];
      if (!target || !applySpellCorrection(target)) return false;
      event.preventDefault();
      return true;
    }

    return false;
  }

  return {
    engine,
    spell,
    spellPopup,
    setSpellPopup,
    spellDismissedRef,
    scheduleSpellPopup,
    closeSpellPopup,
    applySpellReplacement,
    applySpellCorrection,
    addSpellWord,
    ignoreSpellWord,
    removeSpellWord,
    handleSpellPopupKeys,
  };
}
