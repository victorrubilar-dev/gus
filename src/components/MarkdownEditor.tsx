import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { pathWithTitle, safeFileName } from "../lib/fileName";

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
  /** Autoguardado: se invoca con la nota ya guardada en disco. */
  autoSave?: (draft: EditorDraft) => void;
  /** Retardo del autoguardado en ms (500 por defecto). */
  debounceMs?: number;
  className?: string;
  /** Permite al padre forzar un volcado (`flush()`) antes de una acción sobre el archivo. */
  ref?: Ref<MarkdownEditorHandle>;
}

const DEFAULT_DEBOUNCE = 500;

type SaveState = "idle" | "dirty" | "saved" | "error";

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export default function MarkdownEditor({
  path,
  title: initialTitle,
  content: initialContent,
  autoSave,
  debounceMs = DEFAULT_DEBOUNCE,
  className,
  ref,
}: MarkdownEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

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
    // Los props de la nueva nota llegan en el mismo render que la ruta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

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

  // Autoguardado con debounce.
  useEffect(() => {
    if (saveState !== "dirty") return;

    const timer = setTimeout(() => void persistRef.current(), debounceMs);
    return () => clearTimeout(timer);
  }, [title, content, saveState, debounceMs]);

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

  // Ctrl/Cmd + S guarda sin esperar al debounce.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key.toLowerCase() === "s" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void persistRef.current();
    }
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

  const words = countWords(content);

  return (
    <div className={clsx("flex h-full min-h-0 flex-col bg-gus-bg", className)}>
      <header className="shrink-0 border-b border-gus-border px-6 py-4">
        <input
          value={title}
          onChange={(event) => editTitle(event.target.value)}
          placeholder="Sin título"
          aria-label="Título de la nota"
          className="w-full bg-transparent text-xl font-semibold text-gus-text outline-none placeholder:text-gus-muted"
        />
        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gus-muted">
          <span className="flex items-center gap-1.5" role="status" aria-live="polite">
            <span className={clsx("h-1.5 w-1.5 rounded-full", statusDot)} aria-hidden="true" />
            {statusLabel}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {words} palabra{words === 1 ? "" : "s"} · {content.length} carácter
            {content.length === 1 ? "" : "es"}
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

      <textarea
        value={content}
        onChange={(event) => editContent(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe tu nota en markdown…"
        aria-label="Contenido de la nota"
        spellCheck={false}
        className="gus-scrollbar min-h-0 w-full flex-1 resize-none bg-transparent px-6 py-4 font-mono text-sm leading-relaxed text-gus-text outline-none placeholder:text-gus-muted"
      />
    </div>
  );
}
