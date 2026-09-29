import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { FileText, Plus, Search, StickyNote } from "lucide-react";
import type { NoteFile } from "./FileExplorer";

interface RecentNote {
  name: string;
  path: string;
  relative: string;
  modified_ms: number | null;
}

export interface WelcomePanelProps {
  vaultPath: string;
  /** Se refresca al crear/borrar archivos para no mostrar notas viejas. */
  refreshKey?: number;
  onNewNote: () => void;
  onOpenPalette: () => void;
  onOpenNote: (file: NoteFile) => void;
}

type Status = "loading" | "ready" | "error";

const KEY_CLASS =
  "rounded border border-gus-border bg-gus-card px-1.5 py-0.5 font-mono text-[10px] text-gus-text";

function relativeTime(ms: number | null): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "ahora";
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)} h`;
  if (diff < 604_800_000) return `hace ${Math.floor(diff / 86_400_000)} d`;
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function folderOf(relative: string): string {
  const parts = relative.split(/[\\/]/);
  parts.pop();
  return parts.join(" / ") || "raíz del vault";
}

/**
 * Pantalla que ocupa el área del editor cuando no hay ninguna nota, imagen ni
 * PDF abierto: CTA para crear una nota, atajos útiles y las notas recientes.
 */
export default function WelcomePanel({
  vaultPath,
  refreshKey = 0,
  onNewNote,
  onOpenPalette,
  onOpenNote,
}: WelcomePanelProps) {
  const [notes, setNotes] = useState<RecentNote[]>([]);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    invoke<RecentNote[]>("list_recent_notes", { path: vaultPath, limit: 3 })
      .then((list) => {
        if (cancelled) return;
        setNotes(list);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setNotes([]);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [vaultPath, refreshKey]);

  const emptyVault = status === "ready" && notes.length === 0;

  return (
    <section
      aria-label="Ninguna nota abierta"
      className="gus-scrollbar flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="m-auto flex w-full max-w-md flex-col items-center gap-5 px-6 py-10 text-center"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gus-accent/40 bg-gus-accent/15 text-gus-accent">
          <StickyNote className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-gus-text">Ninguna nota abierta</h2>
          <p className="max-w-sm text-sm text-gus-muted">
            Elige un archivo en la lista de la izquierda o empieza una nota nueva en blanco.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={onNewNote}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gus-accent/50 bg-gus-accent/15 px-3.5 py-2 text-xs font-semibold text-gus-accent transition-colors hover:bg-gus-accent/25 focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            Nueva nota
          </button>

          <button
            type="button"
            onClick={onOpenPalette}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gus-border bg-gus-card px-3.5 py-2 text-xs text-gus-muted transition-colors hover:border-gus-accent/40 hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none"
          >
            <Search className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Buscar nota
            <kbd className={KEY_CLASS}>Ctrl</kbd>
            <kbd className={KEY_CLASS}>K</kbd>
          </button>
        </div>

        {emptyVault && (
          <p className="max-w-xs rounded-lg border border-dashed border-gus-border px-4 py-3 text-xs text-gus-muted">
            Todavía no hay notas en este vault. Crea la primera con el botón de arriba.
          </p>
        )}

        {!emptyVault && (
          <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-gus-muted">
            <li className="flex items-center gap-1.5">
              <kbd className={KEY_CLASS}>Supr</kbd>
              elimina lo resaltado
            </li>
            <li className="flex items-center gap-1.5">clic derecho: opciones del archivo</li>
            <li className="flex items-center gap-1.5">arrastra para mover</li>
          </ul>
        )}

        {notes.length > 0 && (
          <div className="w-full border-t border-gus-border pt-4">
            <p className="mb-2 text-left text-[10px] tracking-[0.14em] text-gus-muted uppercase">
              Editadas recientemente
            </p>
            <ul className="flex flex-col gap-1.5">
              {notes.map((note) => (
                <li key={note.path}>
                  <button
                    type="button"
                    onClick={() => onOpenNote({ id: note.path, name: note.name, kind: "note" })}
                    title={note.relative}
                    className="flex w-full items-center gap-3 rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                  >
                    <FileText
                      className="h-4 w-4 shrink-0 text-gus-muted"
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs text-gus-text">
                        {note.name.replace(/\.md$/i, "")}
                      </span>
                      <span className="block truncate text-[10px] text-gus-muted">
                        {folderOf(note.relative)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-gus-muted">
                      {relativeTime(note.modified_ms)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </motion.div>
    </section>
  );
}
