import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Command } from "cmdk";
import { invoke } from "@tauri-apps/api/core";
import { FileText, Loader2, Search } from "lucide-react";

/** Una nota devuelta por el comando Rust `list_vault_notes`. */
export interface VaultNote {
  /** Nombre del archivo con extensión, p. ej. `diario.md`. */
  name: string;
  /** Ruta completa del archivo. */
  path: string;
  /** Ruta relativa al vault con `/`, p. ej. `viajes/diario.md`. */
  relative: string;
  /** Última modificación en milisegundos desde el epoch. */
  modified_ms?: number | null;
}

export interface CommandPaletteProps {
  /** Estado abierto/cerrado, controlado por la app. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Vault activo; sin vault la paleta no se muestra ni escucha atajos. */
  vaultPath: string | null;
  /** Selecciona una nota de los resultados (la app la abre en el editor). */
  onSelectNote: (note: { path: string; name: string }) => void;
}

type LoadState = "loading" | "ready" | "error";

/** Carpeta que se muestra junto al título («raíz» si la nota está en la raíz). */
function folderOf(note: VaultNote): string {
  const slash = note.relative.lastIndexOf("/");
  return slash === -1 ? "raíz" : note.relative.slice(0, slash);
}

/** Título de la nota sin extensión `.md`. */
function titleOf(note: VaultNote): string {
  return note.name.replace(/\.md$/i, "");
}

/**
 * Paleta de comandos flotante (`Ctrl+K` / `Ctrl+P`): lista todas las notas
 * `.md` del vault y filtra en tiempo real mientras escribes. Al pulsar Enter
 * (o clic) se cierra y selecciona la nota en la app.
 *
 * El panel lo anima framer-motion; la lista, el filtrado y la navegación con
 * flechas las hace `cmdk`.
 */
export default function CommandPalette({
  open,
  onOpenChange,
  vaultPath,
  onSelectNote,
}: CommandPaletteProps) {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [status, setStatus] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  // Refleja el estado abierto para que el atajo global nunca vea un valor viejo.
  const openRef = useRef(open);
  openRef.current = open;

  // Atajo global: Ctrl/⌘ + K o Ctrl/⌘ + P abre y cierra la paleta.
  useEffect(() => {
    if (!vaultPath) return;

    function onKeyDown(event: KeyboardEvent) {
      const combo = (event.ctrlKey || event.metaKey) && (event.key === "k" || event.key === "p");
      if (!combo) return;
      event.preventDefault();
      onOpenChange(!openRef.current);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [vaultPath, onOpenChange]);

  // Escape cierra la paleta mientras esté abierta.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onOpenChange(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Cada vez que se abre se recargan las notas (recoge renombrados y altas).
  useEffect(() => {
    if (!open || !vaultPath) return;
    let cancelled = false;

    setStatus("loading");
    setError(null);
    invoke<VaultNote[]>("list_vault_notes", { path: vaultPath })
      .then((list) => {
        if (cancelled) return;
        setNotes(list);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(String(reason));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [open, vaultPath]);

  return (
    <AnimatePresence>
      {open && vaultPath !== null && (
        <motion.div
          key="command-palette-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[2px]"
          onMouseDown={(event) => {
            // Clic fuera del panel ⇒ cerrar.
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Paleta de comandos"
            initial={{ opacity: 0, y: -14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-gus-border bg-gus-panel shadow-2xl shadow-black/40"
          >
            <Command loop label="Paleta de comandos">
              {/* Buscador */}
              <div className="flex items-center gap-2 border-b border-gus-border px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-gus-accent" aria-hidden="true" />
                <Command.Input
                  autoFocus
                  placeholder="Buscar una nota…"
                  aria-label="Buscar una nota"
                  className="min-w-0 flex-1 bg-transparent text-sm text-gus-text outline-none placeholder:text-gus-muted"
                />
                <kbd className="shrink-0 rounded border border-gus-border bg-gus-card px-1.5 py-0.5 text-[10px] text-gus-muted">
                  Esc
                </kbd>
              </div>

              <Command.List className="gus-scrollbar max-h-[50vh] overflow-y-auto p-1.5">
                {status === "loading" && (
                  <p className="flex items-center gap-2 px-3 py-6 text-sm text-gus-muted">
                    <Loader2 className="h-4 w-4 animate-spin text-gus-accent" aria-hidden="true" />
                    Cargando notas…
                  </p>
                )}

                {status === "error" && (
                  <p role="alert" className="px-3 py-6 text-sm text-rose-300">
                    {error ?? "No se pudieron cargar las notas"}
                  </p>
                )}

                {status === "ready" && (
                  <>
                    <Command.Group
                      heading="Notas"
                      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-gus-muted [&_[cmdk-group-heading]]:uppercase"
                    >
                      {notes.map((note) => (
                        <Command.Item
                          key={note.path}
                          value={note.relative}
                          keywords={[note.name, note.relative]}
                          onSelect={() => {
                            onOpenChange(false);
                            onSelectNote(note);
                          }}
                          className="group flex cursor-pointer items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-gus-text outline-none transition-colors data-[selected=true]:border-gus-accent/40 data-[selected=true]:bg-gus-accent/15 data-[selected=true]:text-gus-accent"
                        >
                          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{titleOf(note)}</span>
                          <span className="ml-auto shrink-0 truncate pl-2 text-xs text-gus-muted">
                            {folderOf(note)}
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>

                    {/* Solo con la lista cargada: durante la carga no hay items
                        y cmdk lo contaría como «sin coincidencias». */}
                    <Command.Empty className="px-3 py-6 text-center text-sm text-gus-muted">
                      No hay notas que coincidan
                    </Command.Empty>
                  </>
                )}
              </Command.List>

              {/* Pistas de teclado */}
              <div className="flex items-center justify-between gap-2 border-t border-gus-border px-4 py-2 text-[11px] text-gus-muted">
                <span>
                  <kbd className="rounded border border-gus-border bg-gus-card px-1 py-0.5">↑</kbd>{" "}
                  <kbd className="rounded border border-gus-border bg-gus-card px-1 py-0.5">↓</kbd>{" "}
                  navegar ·{" "}
                  <kbd className="rounded border border-gus-border bg-gus-card px-1 py-0.5">
                    Enter
                  </kbd>{" "}
                  abrir
                </span>
                <span className="text-gus-muted/70">Ctrl+K / Ctrl+P</span>
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
