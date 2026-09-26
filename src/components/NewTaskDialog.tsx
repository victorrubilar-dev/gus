import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Plus, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import DatePicker from "./DatePicker";
import { normalizeTags, parseTagInput } from "../lib/markdownTasks";
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  type TaskPriority,
} from "../lib/taskPriority";

const INPUT_CLASS =
  "w-full rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60";

const LABEL_CLASS = "mb-1 block text-xs text-gus-muted";

export interface NewTaskDialogProps {
  /** Estado abierto/cerrado, controlado por la app. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Menú superpuesto de «Nueva tarea» (mismo estilo que la paleta `Ctrl+K`):
 * un formulario flotante con nombre, descripción, etiquetas, prioridad y un
 * plazo opcional que se revela con el checkbox «Limitar fecha» y se elige en
 * un mini-calendario integrado (no usa el `<input type="date">`, cuyo
 * selector nativo se solapa con el menú en algunos webviews).
 * Al enviarse, publica el evento `task-created` con `publish_new_task`; las
 * vistas (Resumen, Tareas, Calendario) insertan la tarea en su almacén.
 * Sustituye a la antigua ventana nativa «nueva-tarea».
 */
export default function NewTaskDialog({ open, onOpenChange }: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [due, setDue] = useState("");
  /** Solo se pide plazo si el checkbox «Limitar fecha» está marcado. */
  const [dueEnabled, setDueEnabled] = useState(false);
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cada apertura empieza de cero (como la ventana que sustituye).
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setDue("");
    setDueEnabled(false);
    setPriority(null);
    setError(null);
    setSending(false);
  }, [open]);

  // Escape cierra el menú (mientras no haya un envío en curso).
  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !sending) {
        event.stopPropagation();
        onOpenChange(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, sending, onOpenChange]);

  /** Vuelca lo tecleado en el campo de etiquetas a chips. */
  function commitTagInput() {
    const parsed = parseTagInput(tagInput);
    if (parsed.length === 0) return;

    setTags((prev) => normalizeTags([...prev, ...parsed]));
    setTagInput("");
  }

  function handleTagInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault(); // Enter confirma la etiqueta, no crea la tarea
      commitTagInput();
      return;
    }

    // Backspace en el campo vacío elimina el último chip.
    if (event.key === "Backspace" && tagInput === "" && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function handleTagInputChange(value: string) {
    // Escribir una coma confirma al instante lo que haya tecleado.
    if (/[,，]/.test(value)) {
      setTags((prev) => normalizeTags([...prev, ...parseTagInput(value)]));
      setTagInput("");
      return;
    }
    setTagInput(value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("La tarea necesita un nombre.");
      return;
    }
    // Chips pendientes: «etiqueta» tecleada sin Enter/coma se añade al enviar.
    const allTags = normalizeTags([...tags, ...parseTagInput(tagInput)]);

    setSending(true);
    setError(null);

    try {
      await invoke("publish_new_task", {
        task: {
          title: cleanTitle,
          description: description.trim() || null,
          tags: allTags,
          due: dueEnabled && due ? due : null,
          priority,
        },
      });
      onOpenChange(false);
    } catch (submitError: unknown) {
      setError(String(submitError));
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="new-task-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 px-4 pt-[10vh] pb-8 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            // Clic fuera del panel ⇒ cerrar (salvo con un envío en curso).
            if (event.target === event.currentTarget && !sending) onOpenChange(false);
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Nueva tarea"
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-gus-border bg-gus-panel shadow-2xl shadow-black/40"
          >
            <form onSubmit={handleSubmit}>
              {/* Cabecera */}
              <div className="flex items-center gap-2 border-b border-gus-border px-4 py-3">
                <Plus className="h-4 w-4 shrink-0 text-gus-accent" aria-hidden="true" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-gus-text">
                  Nueva tarea
                </h2>
                <kbd className="shrink-0 rounded border border-gus-border bg-gus-card px-1.5 py-0.5 text-[10px] text-gus-muted">
                  Esc
                </kbd>
              </div>

              {/* Campos */}
              <div className="gus-scrollbar flex max-h-[62vh] flex-col gap-3 overflow-y-auto p-4">
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"
                  >
                    {error}
                  </p>
                )}

                {/* Nombre (obligatorio) */}
                <div>
                  <label htmlFor="tarea-nombre" className={LABEL_CLASS}>
                    Nombre <span className="text-rose-300">*</span>
                  </label>
                  <input
                    id="tarea-nombre"
                    autoFocus
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (error) setError(null);
                    }}
                    placeholder="¿Qué hay que hacer?"
                    aria-label="Nombre de la tarea"
                    aria-required="true"
                    className={INPUT_CLASS}
                  />
                </div>

                {/* Descripción (opcional) */}
                <div>
                  <label htmlFor="tarea-descripcion" className={LABEL_CLASS}>
                    Descripción <span className="text-gus-muted/70">(opcional)</span>
                  </label>
                  <textarea
                    id="tarea-descripcion"
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Detalles, enlaces, pasos…"
                    aria-label="Descripción de la tarea"
                    className={clsx(INPUT_CLASS, "min-h-20 resize-none leading-relaxed")}
                  />
                </div>

                {/* Etiquetas (opcional) */}
                <div>
                  <label htmlFor="tarea-etiquetas" className={LABEL_CLASS}>
                    Etiquetas <span className="text-gus-muted/70">(opcional)</span>
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-2.5 py-2 transition-colors focus-within:border-gus-accent/60">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-gus-accent/40 bg-gus-accent/15 px-2 py-0.5 text-[11px] capitalize text-gus-accent"
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                          aria-label={`Quitar etiqueta ${tag}`}
                          className="-mr-1 rounded-full px-1 opacity-60 transition hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current/60 focus-visible:outline-none"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                    <input
                      id="tarea-etiquetas"
                      value={tagInput}
                      onChange={(event) => handleTagInputChange(event.target.value)}
                      onKeyDown={handleTagInputKeyDown}
                      onBlur={commitTagInput}
                      placeholder={tags.length > 0 ? "añadir otra…" : "añadir… (Enter o coma)"}
                      aria-label="Etiquetas de la tarea"
                      className="min-w-32 flex-1 bg-transparent px-1 py-0.5 text-sm text-gus-text outline-none placeholder:text-gus-muted"
                    />
                  </div>
                </div>

                {/* Prioridad (opcional) */}
                <div>
                  <span className={LABEL_CLASS} id="tarea-prioridad">
                    Prioridad <span className="text-gus-muted/70">(opcional)</span>
                  </span>
                  <div
                    role="radiogroup"
                    aria-labelledby="tarea-prioridad"
                    className="flex flex-wrap gap-1.5"
                  >
                    {PRIORITY_OPTIONS.map((option) => {
                      const active = priority === option;
                      return (
                        <button
                          key={option ?? "ninguna"}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPriority(option)}
                          className={clsx(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] capitalize transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none",
                            active
                              ? option
                                ? `${PRIORITY_CLASS[option]} font-medium`
                                : "border-gus-accent/60 bg-gus-accent/15 text-gus-accent"
                              : "border-gus-border text-gus-muted hover:border-gus-accent/40 hover:text-gus-text",
                          )}
                        >
                          {option ? PRIORITY_LABEL[option] : "Sin prioridad"}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Limitar fecha (opcional): el plazo se revela con el checkbox */}
                <div>
                  <label className="flex w-fit cursor-pointer items-center gap-2 select-none">
                    <input
                      type="checkbox"
                      checked={dueEnabled}
                      onChange={(event) => {
                        setDueEnabled(event.target.checked);
                        // Sin casilla no queda fecha que guardar.
                        if (!event.target.checked) setDue("");
                      }}
                      className="peer sr-only"
                    />
                    <span
                      className={clsx(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-gus-accent/60",
                        dueEnabled
                          ? "border-gus-accent bg-gus-accent"
                          : "border-gus-border bg-gus-card",
                      )}
                    >
                      <Check
                        className={clsx(
                          "h-3 w-3 text-gus-bg transition-opacity",
                          dueEnabled ? "opacity-100" : "opacity-0",
                        )}
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                    </span>
                    <span className="text-xs text-gus-muted">
                      Limitar fecha <span className="text-gus-muted/70">(añade un plazo)</span>
                    </span>
                  </label>

                  <AnimatePresence initial={false}>
                    {dueEnabled && (
                      <motion.div
                        key="campo-fecha"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.16, ease: "easeOut" }}
                        className="overflow-hidden"
                      >
                        {/* Calendario propio dentro del menú: sin selector
                            nativo, se navega con las flechas o «Hoy» y el clic
                            en un día fija la fecha. */}
                        <div className="pt-2">
                          <DatePicker value={due || null} onChange={(iso) => setDue(iso ?? "")} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Pie: atisbos + acciones */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gus-border px-4 py-3">
                <span className="text-[11px] text-gus-muted">
                  <kbd className="rounded border border-gus-border bg-gus-card px-1 py-0.5">
                    Enter
                  </kbd>{" "}
                  crear ·{" "}
                  <kbd className="rounded border border-gus-border bg-gus-card px-1 py-0.5">
                    Esc
                  </kbd>{" "}
                  cerrar
                </span>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={sending}
                    className="rounded-lg bg-gus-accent px-4 py-1.5 text-sm font-medium text-gus-bg transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
                  >
                    {sending ? "Creando…" : "Crear tarea"}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    disabled={sending}
                    className="rounded-lg border border-gus-border px-4 py-1.5 text-sm text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
