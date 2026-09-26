import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FolderOpen,
  Image as ImageIcon,
  Pencil,
  Plus,
  RotateCcw,
} from "lucide-react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { joinPath } from "../lib/fileName";
import gusIcon from "../assets/gus-icon-512.png";

/** Un vault conocido: nombre visible + ruta de su carpeta. */
export interface VaultInfo {
  name: string;
  path: string;
  /** Imagen de portada opcional (ruta absoluta elegida por el usuario). */
  cover?: string | null;
}

/** Configuración que devuelve `load_app_config` (JSON en camelCase). */
export interface VaultAppConfig {
  baseDir: string | null;
  vaults: VaultInfo[];
  lastVault: string | null;
  /** Ajustes globales del panel de configuración (ausente ⇒ por defecto). */
  settings?: unknown;
}

interface VaultPickerProps {
  vaults: VaultInfo[];
  /** Carpeta base elegida para crear los vaults nuevos. */
  baseDir: string;
  /** Último vault abierto: se resalta con la píldora "último". */
  lastVault: string | null;
  /** Hay una operación en curso (crear/abrir). */
  busy?: boolean;
  /** Error devuelto por el backend, si lo hay. */
  error?: string | null;
  /** Abre el vault indicado (pasa a ser el actual). */
  onOpen: (path: string) => void;
  /** Crea `name` dentro de `baseDir`. Resuelve `false` si falló. */
  onCreate: (name: string, baseDir: string) => Promise<boolean>;
  /** Añade una carpeta ya existente. Resuelve `false` si falló. */
  onAddExisting: (path: string) => Promise<boolean>;
  /** Cambia únicamente el nombre visible del vault; no mueve su carpeta. */
  onRename: (path: string, name: string) => Promise<boolean>;
  /** Establece (o quita con `null`) la imagen de portada del vault. */
  onSetCover: (path: string, cover: string | null) => Promise<boolean>;
  /** Quita varios vaults de la lista a la vez (no borra archivos del disco). */
  onRemoveMany: (paths: string[]) => void;
  /** Persiste la carpeta base elegida para los vaults nuevos. */
  onSelectBaseDir: (dir: string) => void;
}

type Mode = "idle" | "create";

const INPUT_CLASS =
  "w-full rounded-lg border border-gus-border bg-gus-card px-3 py-2 text-sm text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60";

const SMALL_BUTTON_CLASS =
  "rounded-lg px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-gus-accent/60 disabled:opacity-50";

/**
 * Fondo de una tarjeta de vault: siempre hay un fondo predeterminado y,
 * si el usuario eligió portada, se superpone la imagen (con fallback si falla).
 */
function VaultBackground({ cover }: { cover?: string | null }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!cover) {
      setSrc(null);
      return;
    }

    setSrc(null);
    invoke<string>("read_vault_image", { path: cover })
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        // Portada borrada o no legible → se queda el fondo predeterminado.
      });

    return () => {
      cancelled = true;
    };
  }, [cover]);

  return (
    <div aria-hidden="true" className="absolute inset-0">
      {/* Fondo predeterminado siempre presente, debajo de la imagen. */}
      <div className="absolute inset-0 bg-gradient-to-br from-gus-panel via-gus-card to-gus-accent/25" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.08),transparent_55%)]" />
      <img
        src={gusIcon}
        alt=""
        draggable={false}
        className="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 opacity-20 select-none"
      />

      {src && (
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setSrc(null)}
        />
      )}
    </div>
  );
}

/**
 * Pantalla principal estilo Obsidian: lista los vaults conocidos y permite
 * crear uno nuevo (eligiendo su carpeta con el explorador nativo) o abrir una
 * carpeta existente. Delega las operaciones de disco en los callbacks.
 */
export default function VaultPicker({
  vaults,
  baseDir,
  lastVault,
  busy = false,
  error = null,
  onOpen,
  onCreate,
  onAddExisting,
  onRename,
  onSetCover,
  onRemoveMany,
  onSelectBaseDir,
}: VaultPickerProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [showWelcome, setShowWelcome] = useState(vaults.length === 0);
  const [nameInput, setNameInput] = useState("");
  const [baseInput, setBaseInput] = useState(baseDir);
  const [localError, setLocalError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [choosingBase, setChoosingBase] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");
  /** Modo edición: muestra portada/renombrar y la selección múltiple. */
  const [editMode, setEditMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  /** Vault cuya portada se está eligiendo en este momento. */
  const [pickingCoverPath, setPickingCoverPath] = useState<string | null>(null);

  const shownError = localError ?? error;
  const effectiveBase = baseInput.trim() || baseDir;
  const pickerBusy = picking || choosingBase;

  function cancel() {
    setMode("idle");
    setLocalError(null);
  }

  async function submitCreate() {
    const raw = nameInput.trim();
    if (!raw) {
      setLocalError("Ponle un nombre al vault.");
      return;
    }
    setLocalError(null);
    const ok = await onCreate(raw, effectiveBase);
    if (ok) {
      setNameInput("");
      setMode("idle");
    }
  }

  /** Abre el explorador nativo y añade la carpeta elegida al listado. */
  async function pickExistingVault() {
    if (busy || pickerBusy) return;

    setPicking(true);
    setLocalError(null);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecciona un vault existente",
      });

      if (typeof selected !== "string") return;
      await onAddExisting(selected);
    } catch (error: unknown) {
      setLocalError(String(error));
    } finally {
      setPicking(false);
    }
  }

  /** Permite elegir con el explorador dónde se creará el siguiente vault. */
  async function pickBaseDirectory() {
    if (busy || pickerBusy) return;

    setChoosingBase(true);
    setLocalError(null);

    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Elige dónde crear el vault",
      });

      if (typeof selected !== "string") return;
      setBaseInput(selected);
      onSelectBaseDir(selected);
    } catch (error: unknown) {
      setLocalError(String(error));
    } finally {
      setChoosingBase(false);
    }
  }

  /** Abre el explorador nativo para elegir la portada de un vault. */
  async function pickCover(vault: VaultInfo) {
    if (busy || pickerBusy || pickingCoverPath) return;

    setPickingCoverPath(vault.path);
    setLocalError(null);

    try {
      const selected = await open({
        directory: false,
        multiple: false,
        title: `Elige la portada de ${vault.name}`,
        filters: [
          {
            name: "Imágenes",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"],
          },
        ],
      });

      if (typeof selected !== "string") return;
      await onSetCover(vault.path, selected);
    } catch (error: unknown) {
      setLocalError(String(error));
    } finally {
      setPickingCoverPath(null);
    }
  }

  /** Vuelve al fondo predeterminado del vault. */
  async function resetCover(vault: VaultInfo) {
    if (busy || pickerBusy || pickingCoverPath) return;
    setLocalError(null);
    await onSetCover(vault.path, null);
  }

  function startRename(path: string, currentName: string) {
    setRenamingPath(path);
    setRenameInput(currentName);
    setLocalError(null);
  }

  function cancelRename() {
    setRenamingPath(null);
    setRenameInput("");
    setLocalError(null);
  }

  async function submitRename() {
    if (!renamingPath) return;

    const cleanName = renameInput.trim();
    if (!cleanName) {
      setLocalError("Ponle un nombre al vault.");
      return;
    }

    setLocalError(null);
    const ok = await onRename(renamingPath, cleanName);
    if (ok) cancelRename();
  }

  /** Activa/desactiva el menú de edición de los vaults. */
  function toggleEditMode() {
    const next = !editMode;
    setEditMode(next);
    setConfirmBulkDelete(false);
    setSelectedPaths(new Set());
    setLocalError(null);
    if (!next) cancelRename();
  }

  /** Selecciona/deselecciona un vault para las acciones del modo edición. */
  function toggleSelect(path: string) {
    setConfirmBulkDelete(false);
    setSelectedPaths((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(path)) nextSet.delete(path);
      else nextSet.add(path);
      return nextSet;
    });
  }

  function toggleSelectAll() {
    setConfirmBulkDelete(false);
    setSelectedPaths((prev) =>
      prev.size === vaults.length
        ? new Set<string>()
        : new Set(vaults.map((vault) => vault.path)),
    );
  }

  /** Elimina de la lista todos los vaults seleccionados (una sola llamada). */
  function removeSelected() {
    if (selectedPaths.size === 0) return;
    onRemoveMany([...selectedPaths]);
    setSelectedPaths(new Set());
    setConfirmBulkDelete(false);
  }

  if (showWelcome && vaults.length === 0) {
    return (
      <div className="gus-scrollbar flex h-full w-full items-center justify-center overflow-y-auto bg-gus-bg px-6 py-10">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="w-full max-w-md text-center"
          aria-labelledby="welcome-title"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.08, type: "spring", stiffness: 260, damping: 18 }}
            className="mb-5"
            aria-hidden="true"
          >
            <img
              src={gusIcon}
              alt=""
              draggable={false}
              className="mx-auto h-[110px] w-[110px] select-none drop-shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
            />
          </motion.div>

          <motion.h1
            id="welcome-title"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16, duration: 0.35 }}
            className="text-3xl font-semibold tracking-tight"
          >
            Bienvenido a Gus
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24, duration: 0.35 }}
            className="mx-auto mt-3 max-w-sm text-sm leading-6 text-gus-muted"
          >
            Tu app para organizar tu día a día
          </motion.p>

          {shownError && (
            <p
              role="alert"
              className="mt-5 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"
            >
              {shownError}
            </p>
          )}

          <motion.button
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32, duration: 0.35 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setShowWelcome(false);
              setLocalError(null);
            }}
            className="mt-8 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-gus-accent px-7 text-sm font-semibold text-gus-bg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-gus-bg"
          >
            Empezar
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </motion.button>
        </motion.section>
      </div>
    );
  }

  return (
    <div className="gus-scrollbar flex h-full w-full items-start justify-center overflow-y-auto bg-gus-bg px-6 py-8">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-6xl"
      >
        {/* Cabecera + acciones pequeñas */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-3">
            <img
              src={gusIcon}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="mt-1 h-10 w-10 shrink-0 select-none"
            />
            <div>
              <h1 className="text-2xl font-semibold">
                {vaults.length === 0 ? "¿Cómo quieres empezar?" : "Tus vaults"}
              </h1>
              <p className="mt-1 text-sm text-gus-muted">
                {vaults.length === 0
                  ? "Crea uno nuevo o selecciona una carpeta que ya tengas."
                  : "Elige un vault o añade otro para empezar."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("create");
                setLocalError(null);
              }}
              disabled={busy || pickerBusy}
              aria-expanded={mode === "create"}
              aria-controls="vault-create-form"
              className={clsx(
                SMALL_BUTTON_CLASS,
                "inline-flex items-center gap-1.5 bg-gus-accent font-medium text-gus-bg hover:opacity-90",
              )}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Crear vault
            </button>

            <button
              type="button"
              onClick={() => void pickExistingVault()}
              disabled={busy || pickerBusy}
              className={clsx(
                SMALL_BUTTON_CLASS,
                "inline-flex items-center gap-1.5 border border-gus-border bg-gus-card text-gus-muted hover:text-gus-text",
              )}
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              {picking ? "Abriendo…" : "Abrir existente"}
            </button>

            <button
              type="button"
              onClick={toggleEditMode}
              disabled={busy || pickerBusy}
              aria-pressed={editMode}
              className={clsx(
                SMALL_BUTTON_CLASS,
                "inline-flex items-center gap-1.5 border",
                editMode
                  ? "border-gus-accent/60 bg-gus-accent/15 text-gus-accent"
                  : "border-gus-border bg-gus-card text-gus-muted hover:text-gus-text",
              )}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {editMode ? "Salir de edición" : "Editar vaults"}
            </button>
          </div>
        </header>

        {shownError && (
          <p
            role="alert"
            className="mb-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-300"
          >
            {shownError}
          </p>
        )}

        {/* Menú de edición: portadas, renombrar y selección múltiple. */}
        {editMode && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gus-accent/40 bg-gus-accent/10 px-3 py-2">
            <p className="text-xs text-gus-muted">
              Selecciona los vaults para eliminarlos de la lista, o usa los iconos de
              cada tarjeta para cambiar su portada o nombre.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleSelectAll}
                disabled={vaults.length === 0 || busy || pickerBusy}
                className={clsx(
                  SMALL_BUTTON_CLASS,
                  "border border-gus-border bg-gus-card text-xs text-gus-muted hover:text-gus-text",
                )}
              >
                {selectedPaths.size === vaults.length && vaults.length > 0
                  ? "Deseleccionar todo"
                  : "Seleccionar todo"}
              </button>

              {confirmBulkDelete ? (
                <>
                  <button
                    type="button"
                    onClick={removeSelected}
                    className={clsx(
                      SMALL_BUTTON_CLASS,
                      "border border-rose-400/40 bg-rose-400/10 text-xs text-rose-300 hover:bg-rose-400/20",
                    )}
                  >
                    Confirmar ({selectedPaths.size})
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkDelete(false)}
                    className={clsx(
                      SMALL_BUTTON_CLASS,
                      "border border-gus-border text-xs text-gus-muted hover:text-gus-text",
                    )}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={selectedPaths.size === 0 || busy || pickerBusy}
                  className={clsx(
                    SMALL_BUTTON_CLASS,
                    "border border-rose-400/40 bg-rose-400/10 text-xs text-rose-300 hover:bg-rose-400/20",
                  )}
                >
                  Eliminar seleccionados ({selectedPaths.size})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tarjetas de vaults (16:9, con fondo predeterminado o portada) */}
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {vaults.length === 0 && (
            <li className="rounded-xl border border-dashed border-gus-border px-3 py-10 text-center text-xs text-gus-muted sm:col-span-2 xl:col-span-3">
              No hay vaults todavía. Usa los botones de arriba para continuar.
            </li>
          )}

          {vaults.map((vault, index) => {
            const isRenaming = renamingPath === vault.path;
            const isPickingCover = pickingCoverPath === vault.path;
            const isSelected = selectedPaths.has(vault.path);

            return (
              <motion.li
                key={vault.path}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(index * 0.05, 0.3) }}
                className="group relative aspect-video overflow-hidden rounded-2xl border border-gus-border shadow-lg outline-none focus-within:ring-2 focus-within:ring-gus-accent/60"
              >
                <VaultBackground cover={vault.cover} />
                {/* Degradado para que el nombre siempre sea legible. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
                />

                {/* Toda la tarjeta abre el vault… */}
                <button
                  type="button"
                  onClick={() => onOpen(vault.path)}
                  disabled={busy || pickerBusy}
                  aria-label={`Abrir vault ${vault.name}`}
                  className="absolute inset-0 z-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent disabled:cursor-not-allowed"
                />

                {/* Modo edición: seleccionar la tarjeta para acciones múltiples. */}
                {editMode && (
                  <button
                    type="button"
                    onClick={() => toggleSelect(vault.path)}
                    aria-pressed={isSelected}
                    aria-label={`Seleccionar ${vault.name}`}
                    title={isSelected ? "Deseleccionar vault" : "Seleccionar vault"}
                    className={clsx(
                      "absolute top-2 left-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur transition focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none",
                      isSelected
                        ? "border-gus-accent bg-gus-accent text-gus-bg"
                        : "border-white/40 bg-black/45 text-transparent hover:border-white/80",
                    )}
                  >
                    <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                  </button>
                )}

                {/* Modo edición: opciones de portada y nombre. */}
                {editMode && (
                  <div className="absolute top-2 right-2 z-10 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void pickCover(vault)}
                      disabled={busy || pickerBusy}
                      title={
                        vault.cover
                          ? "Cambiar la imagen de portada"
                          : "Elegir una imagen de portada"
                      }
                      aria-label={`Elegir portada de ${vault.name}`}
                      className="rounded-md bg-black/45 p-1.5 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none disabled:opacity-50"
                    >
                      <ImageIcon
                        className={clsx("h-4 w-4", isPickingCover && "animate-pulse")}
                        aria-hidden="true"
                      />
                    </button>

                    {vault.cover && (
                      <button
                        type="button"
                        onClick={() => void resetCover(vault)}
                        disabled={busy || pickerBusy}
                        title="Volver al fondo predeterminado"
                        aria-label={`Quitar la portada de ${vault.name}`}
                        className="rounded-md bg-black/45 p-1.5 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => startRename(vault.path, vault.name)}
                      disabled={busy || pickerBusy}
                      title="Cambiar el nombre visible"
                      aria-label={`Renombrar ${vault.name}`}
                      className="rounded-md bg-black/45 p-1.5 text-white/80 backdrop-blur transition hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:outline-none disabled:opacity-50"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}

                {/* Nombre + ubicación + botón pequeño para abrir. */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-semibold text-white drop-shadow">
                        {vault.name}
                      </span>
                      {lastVault === vault.path && (
                        <span className="shrink-0 rounded-full border border-gus-accent/50 bg-gus-accent/20 px-1.5 py-px text-[9px] tracking-wide text-gus-accent uppercase backdrop-blur">
                          último
                        </span>
                      )}
                    </div>
                    <span
                      className="mt-0.5 block truncate font-mono text-[10px] text-white/70"
                      title={vault.path}
                    >
                      {vault.path}
                    </span>
                  </div>

                  {!editMode && (
                    <button
                      type="button"
                      onClick={() => onOpen(vault.path)}
                      disabled={busy || pickerBusy}
                      className="pointer-events-auto shrink-0 rounded-lg bg-gus-accent px-3 py-1.5 text-xs font-semibold text-gus-bg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-gus-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 disabled:opacity-50"
                    >
                      Abrir
                    </button>
                  )}
                </div>

                {/* Renombrar (dentro de la misma tarjeta 16:9). */}
                {isRenaming && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitRename();
                    }}
                    className="absolute inset-0 z-20 flex flex-col justify-center gap-2 bg-gus-bg/95 p-4 backdrop-blur-sm"
                  >
                    <label htmlFor={`vault-rename-${index}`} className="text-xs text-gus-muted">
                      Nombre visible
                    </label>
                    <input
                      id={`vault-rename-${index}`}
                      autoFocus
                      required
                      maxLength={120}
                      value={renameInput}
                      onChange={(event) => setRenameInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelRename();
                      }}
                      className={INPUT_CLASS}
                    />
                    <p className="truncate font-mono text-[10px] text-gus-muted" title={vault.path}>
                      {vault.path}
                    </p>
                    <div className="mt-1 flex gap-2">
                      <button
                        type="submit"
                        disabled={busy || pickerBusy}
                        className={clsx(
                          SMALL_BUTTON_CLASS,
                          "bg-gus-accent font-medium text-gus-bg hover:opacity-90",
                        )}
                      >
                        Guardar
                      </button>
                      <button
                        type="button"
                        onClick={cancelRename}
                        disabled={busy || pickerBusy}
                        className={clsx(
                          SMALL_BUTTON_CLASS,
                          "border border-gus-border text-gus-muted hover:text-gus-text",
                        )}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
              </motion.li>
            );
          })}
        </ul>

        {/* Formulario: crear vault */}
        {mode === "create" && (
          <motion.form
            id="vault-create-form"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
            className="mt-4 space-y-3 rounded-xl border border-gus-border bg-gus-panel p-4"
          >
            <div>
              <label htmlFor="vault-name" className="mb-1 block text-xs text-gus-muted">
                Nombre del vault
              </label>
              <input
                id="vault-name"
                autoFocus
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder="Mi diario"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="vault-base" className="mb-1 block text-xs text-gus-muted">
                Carpeta donde se creará
              </label>
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <FolderOpen
                    className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gus-muted"
                    aria-hidden="true"
                  />
                  <input
                    id="vault-base"
                    readOnly
                    value={effectiveBase}
                    title={effectiveBase}
                    className={clsx(INPUT_CLASS, "pr-3 pl-9 font-mono")}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void pickBaseDirectory()}
                  disabled={busy || pickerBusy}
                  className={clsx(
                    SMALL_BUTTON_CLASS,
                    "shrink-0 border border-gus-border text-gus-muted hover:text-gus-text",
                  )}
                >
                  {choosingBase ? "Eligiendo…" : "Elegir carpeta"}
                </button>
              </div>
              <p className="mt-1 text-[11px] break-all text-gus-muted">
                Se creará en:{" "}
                <span className="font-mono">
                  {joinPath(effectiveBase, nameInput.trim() || "…")}
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy || pickerBusy}
                className={clsx(
                  SMALL_BUTTON_CLASS,
                  "bg-gus-accent font-medium text-gus-bg hover:opacity-90",
                )}
              >
                Crear
              </button>
              <button
                type="button"
                onClick={cancel}
                className={clsx(
                  SMALL_BUTTON_CLASS,
                  "border border-gus-border text-gus-muted hover:text-gus-text",
                )}
              >
                Cancelar
              </button>
            </div>
          </motion.form>
        )}
      </motion.div>
    </div>
  );
}
