import { useEffect, useRef } from "react";
import { Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";
import type { PdfNote } from "../lib/pdfAnnotations";

/**
 * Panel lateral con las notas del PDF, ordenadas por página. El botón de
 * añadir crea una nota en la página visible; pulsar el número de página
 * salta a ella en el documento.
 */
export default function PdfNotesPanel({
  notes,
  currentPage,
  autoFocusId,
  onAdd,
  onChange,
  onDelete,
  onJump,
  onClose,
}: {
  notes: PdfNote[];
  currentPage: number;
  autoFocusId: string | null;
  onAdd: () => void;
  onChange: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  onJump: (page: number) => void;
  onClose: () => void;
}) {
  const pendingFocusRef = useRef<string | null>(null);

  // Al crear una nota se abre y enfoca su cuadro de texto.
  useEffect(() => {
    if (!autoFocusId) return;
    pendingFocusRef.current = autoFocusId;
    const timer = window.setTimeout(() => {
      const area = document.querySelector<HTMLTextAreaElement>(
        `textarea[data-note-id="${autoFocusId}"]`,
      );
      area?.focus();
      pendingFocusRef.current = null;
    }, 40);
    return () => window.clearTimeout(timer);
  }, [autoFocusId]);

  const sorted = [...notes].sort((a, b) => a.page - b.page || a.created - b.created);

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-gus-border bg-gus-panel">
      <div className="flex items-center justify-between border-b border-gus-border px-3 py-2">
        <span className="text-xs font-semibold text-gus-text">Notas del PDF</span>
        <button
          type="button"
          onClick={onClose}
          title="Cerrar notas"
          aria-label="Cerrar notas"
          className="flex h-6 w-6 items-center justify-center rounded text-gus-muted transition-colors hover:bg-gus-border/40 hover:text-gus-text focus-visible:outline-2 focus-visible:outline-gus-accent/60"
        >
          <X size={14} />
        </button>
      </div>

      <div className="border-b border-gus-border px-3 py-2">
        <button
          type="button"
          onClick={onAdd}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-gus-accent/40 bg-gus-accent/15 px-2 py-1.5 text-xs text-gus-accent transition-colors hover:bg-gus-accent/25 focus-visible:outline-2 focus-visible:outline-gus-accent/60"
        >
          <Plus size={13} />
          Nota en la página {currentPage}
        </button>
      </div>

      <div className="gus-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {sorted.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs leading-relaxed text-gus-muted">
            Sin notas todavía.
            <br />
            Añade una en la página que estés leyendo.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((note) => (
              <li
                key={note.id}
                className="group rounded border border-gus-border bg-gus-bg/70 p-2 transition-colors focus-within:border-gus-accent/50"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onJump(note.page)}
                    title={`Ir a la página ${note.page}`}
                    className="rounded border border-gus-accent/40 bg-gus-accent/15 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-gus-accent transition-colors hover:bg-gus-accent/25 focus-visible:outline-2 focus-visible:outline-gus-accent/60"
                  >
                    pág. {note.page}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(note.id)}
                    title="Borrar nota"
                    aria-label="Borrar nota de la página"
                    className={clsx(
                      "flex h-5 w-5 items-center justify-center rounded text-gus-muted transition-all",
                      "opacity-0 hover:bg-rose-500/15 hover:text-rose-300 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-gus-accent/60",
                      "group-hover:opacity-100",
                    )}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  data-note-id={note.id}
                  value={note.text}
                  onChange={(event) => onChange(note.id, event.target.value)}
                  rows={3}
                  placeholder="Escribe tu nota…"
                  className="gus-scrollbar w-full resize-none rounded bg-transparent text-xs leading-relaxed text-gus-text placeholder:text-gus-muted/70 focus:outline-none"
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
