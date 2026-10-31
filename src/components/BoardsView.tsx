import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CheckSquare, Copy, Download, PenTool, Plus, Search, Trash2 } from "lucide-react";
import BoardCard, { type BoardEntry } from "./BoardCard";
import BoardEditor from "./BoardEditor";
import EmptyState from "./EmptyState";
import ViewHeader from "./ViewHeader";
import { useT } from "../lib/i18n";
import type { MessageKey } from "../lib/i18n/core";
import { joinPath, safeFileName } from "../lib/fileName";
import { serializeBoard } from "../lib/board";
import {
  drawForExport,
  duplicateBoard,
  encodeExport,
  exportBoardsToFolder,
  loadBoard,
  loadBoardImages,
  renameBoard,
  copyBoardImage,
  setBoardLabel,
  type ExportFormat,
} from "../lib/boardActions";
import { BOARD_SORTS, isBoardSort, listBoards, type BoardSort } from "../lib/boardList";
import { createTaskId } from "../lib/taskStore";

const SORT_KEY = "gus.boards-sort";

function readSort(): BoardSort {
  try {
    const stored = window.localStorage.getItem(SORT_KEY);
    if (isBoardSort(stored)) return stored;
  } catch {
    // Sin almacenamiento se usa el orden por defecto.
  }
  return "recent";
}

export interface BoardsViewProps {
  vaultPath: string;
}

/** Lista de pizarras del vault (REQ-03); al abrir una, entra en su lienzo. */
export default function BoardsView({ vaultPath }: BoardsViewProps) {
  const t = useT();
  const [boards, setBoards] = useState<BoardEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Borrar una pide confirmación; así un clic suelto no tira una pizarra. */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmMany, setConfirmMany] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BoardSort>(readSort);

  useEffect(() => {
    if (openId !== null) return;
    let cancelled = false;
    invoke<BoardEntry[]>("list_boards", { vaultPath })
      .then((list) => {
        if (cancelled) return;
        setBoards(list);
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
  }, [vaultPath, openId, reload]);

  // Esc sale del modo selección.
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") leaveSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  function fail(reason: unknown) {
    setNotice(null);
    setError(t("boards.exportError", { error: String(reason) }));
  }

  function say(message: string) {
    setError(null);
    setNotice(message);
  }

  function leaveSelection() {
    setSelecting(false);
    setSelected(new Set());
    setConfirmMany(false);
    setExportMenu(false);
  }

  function toggleSelect(id: string) {
    setConfirmMany(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visible = listBoards(boards, query, sort);
  const chosen = boards.filter((board) => selected.has(board.id));

  async function create() {
    const id = createTaskId();
    try {
      await invoke("save_board", { vaultPath, id, json: serializeBoard({ name: t("boards.untitled"), elements: [] }) });
      setOpenId(id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function trash(list: BoardEntry[]) {
    setConfirmId(null);
    setConfirmMany(false);
    try {
      // A la papelera del vault: se pueden restaurar desde ahí.
      for (const board of list) {
        await invoke("move_to_trash", { path: joinPath(joinPath(vaultPath, ".gus-boards"), `${board.id}.json`), vault: vaultPath });
      }
      setSelected(new Set());
      setReload((key) => key + 1);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function commitRename(board: BoardEntry, raw: string) {
    setRenamingId(null);
    const name = raw.trim();
    if (!name || name === board.name) return;
    try {
      await renameBoard(vaultPath, board.id, name);
      setReload((key) => key + 1);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function duplicate(list: BoardEntry[]) {
    setBusy(true);
    try {
      const taken = boards.map((board) => board.name);
      for (const board of list) {
        const id = await duplicateBoard(vaultPath, board, taken, t("boards.copyLabel"));
        const copy = (await loadBoard(vaultPath, id, board.name)).name;
        taken.push(copy);
      }
      setReload((key) => key + 1);
      say(t(list.length === 1 ? "boards.duplicated" : "boards.duplicatedMany"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function label(board: BoardEntry, change: { pinned?: boolean; color?: string | null }) {
    try {
      await setBoardLabel(vaultPath, board.id, board.name, change);
      setReload((key) => key + 1);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function copyImage(board: BoardEntry) {
    setBusy(true);
    try {
      const loaded = await loadBoard(vaultPath, board.id, board.name);
      const copied = await copyBoardImage(loaded.elements, await loadBoardImages(vaultPath, loaded.elements));
      if (copied) say(t("boards.imageCopied"));
      else {
        setNotice(null);
        setError(t("boards.exportEmpty"));
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  async function exportOne(board: BoardEntry, format: ExportFormat) {
    setBusy(true);
    try {
      const loaded = await loadBoard(vaultPath, board.id, board.name);
      const drawn = drawForExport(loaded.elements, await loadBoardImages(vaultPath, loaded.elements));
      if (!drawn) {
        setNotice(null);
        setError(t("boards.exportEmpty"));
        return;
      }
      const target = await save({
        title: t("boards.exportTitle"),
        defaultPath: `${safeFileName(loaded.name)}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!target) return;
      await invoke("write_image_file", { path: target, data: await encodeExport(drawn, format), format });
      say(t("boards.exported"));
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  async function exportMany(list: BoardEntry[], format: ExportFormat) {
    setExportMenu(false);
    setBusy(true);
    try {
      const folder = await open({ directory: true, multiple: false, title: t("boards.chooseFolder") });
      if (typeof folder !== "string") return;
      const result = await exportBoardsToFolder(vaultPath, list, format, folder);
      const parts = [t("boards.exportedMany", { saved: result.saved })];
      if (result.empty > 0) parts.push(t("boards.exportedEmptySkipped", { empty: result.empty }));
      if (result.failed.length > 0) parts.push(t("boards.exportedFailed", { names: result.failed.join(", ") }));
      if (result.failed.length > 0) {
        setNotice(null);
        setError(parts.join(" "));
      } else {
        say(parts.join(" "));
      }
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }

  if (openId !== null) {
    return <BoardEditor vaultPath={vaultPath} boardId={openId} onBack={() => setOpenId(null)} />;
  }

  const barButton = "gus-btn gus-btn-secondary";

  return (
    <section data-tour="boards" className="gus-scrollbar flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ViewHeader
        title={t("boards.title")}
        description={t("boards.desc")}
        actions={
          <>
            {boards.length > 0 && (
              <button
                type="button"
                onClick={() => (selecting ? leaveSelection() : setSelecting(true))}
                aria-pressed={selecting}
                className={barButton}
              >
                <CheckSquare className="h-4 w-4" aria-hidden="true" />
                {t(selecting ? "boards.selectDone" : "boards.select")}
              </button>
            )}
            <button type="button" onClick={() => void create()} className="gus-btn gus-btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("boards.new")}
            </button>
          </>
        }
      />

      {selecting && (
        <div role="toolbar" aria-label={t("boards.select")} className="flex flex-wrap items-center gap-2 rounded-xl border border-gus-accent/40 bg-gus-accent/10 px-3 py-2">
          <span className="mr-1 text-body text-gus-text">{t("boards.selectedCount", { count: selected.size })}</span>
          <button type="button" onClick={() => setSelected(new Set(visible.map((board) => board.id)))} className={barButton}>
            {t("boards.selectAll")}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} disabled={selected.size === 0} className={barButton}>
            {t("boards.selectNone")}
          </button>

          <span className="mx-1 hidden h-5 w-px bg-gus-border min-[700px]:block" aria-hidden="true" />

          <button type="button" onClick={() => void duplicate(chosen)} disabled={selected.size === 0 || busy} className={barButton}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            {t("boards.duplicate")}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenu((openNow) => !openNow)}
              disabled={selected.size === 0 || busy}
              aria-haspopup="menu"
              aria-expanded={exportMenu}
              className={barButton}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t("boards.exportSelected")}
            </button>
            {exportMenu && (
              <div role="menu" aria-label={t("boards.exportSelected")} className="absolute left-0 z-30 mt-1.5 w-64 overflow-hidden rounded-lg border border-gus-border bg-gus-card py-1 shadow-xl">
                {(["svg", "png"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => void exportMany(chosen, format)}
                    className="flex w-full items-center px-3 py-1.5 text-left text-body text-gus-muted transition-colors hover:bg-gus-panel hover:text-gus-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gus-accent/60 focus-visible:outline-none"
                  >
                    {t(format === "svg" ? "boards.exportSvg" : "boards.exportPng")}
                  </button>
                ))}
              </div>
            )}
          </div>

          {confirmMany ? (
            <>
              <span className="text-body text-rose-300">{t("boards.confirmTrashMany", { count: selected.size })}</span>
              <button type="button" onClick={() => void trash(chosen)} className={`${barButton} text-rose-300`}>
                {t("boards.confirmYes")}
              </button>
              <button type="button" onClick={() => setConfirmMany(false)} className={barButton}>
                {t("common.cancel")}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmMany(true)} disabled={selected.size === 0 || busy} className={`${barButton} text-rose-300`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t("boards.toTrashMany", { count: selected.size })}
            </button>
          )}
        </div>
      )}

      {boards.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1 max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gus-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("boards.searchPlaceholder")}
              aria-label={t("boards.search")}
              className="w-full rounded-lg border border-gus-border bg-gus-panel py-1.5 pr-3 pl-9 text-body text-gus-text outline-none transition-colors placeholder:text-gus-muted focus:border-gus-accent/60"
            />
          </label>
          <label className="flex items-center gap-2 text-body text-gus-muted">
            {t("boards.sort")}
            <select
              value={sort}
              onChange={(event) => {
                const next = event.target.value;
                if (!isBoardSort(next)) return;
                setSort(next);
                try {
                  window.localStorage.setItem(SORT_KEY, next);
                } catch {
                  // El orden solo dura esta sesión.
                }
              }}
              className="rounded-lg border border-gus-border bg-gus-panel px-2 py-1.5 text-body text-gus-text outline-none focus:border-gus-accent/60"
            >
              {BOARD_SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(`boards.sort.${option}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {status === "loading" && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {error && <p role="alert" className="break-words rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">{error}</p>}
      {notice && (
        <p role="status" className="rounded-lg border border-gus-accent/30 bg-gus-accent/10 px-3 py-2 text-body text-gus-accent">
          {notice}
        </p>
      )}

      {status === "ready" && boards.length === 0 && <EmptyState icon={PenTool} title={t("boards.empty")} />}

      {status === "ready" && boards.length > 0 && visible.length === 0 && (
        <p className="py-8 text-center text-body text-gus-muted">{t("boards.noMatches", { query: query.trim() })}</p>
      )}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {visible.map((board) => (
          <BoardCard
            key={board.id}
            vaultPath={vaultPath}
            board={board}
            selecting={selecting}
            selected={selected.has(board.id)}
            menuOpen={menuId === board.id}
            renaming={renamingId === board.id}
            confirmingTrash={confirmId === board.id}
            onOpen={() => setOpenId(board.id)}
            onToggleSelect={() => toggleSelect(board.id)}
            onMenuOpenChange={(openNow) => setMenuId(openNow ? board.id : null)}
            onStartRename={() => setRenamingId(board.id)}
            onCommitRename={(name) => void commitRename(board, name)}
            onCancelRename={() => setRenamingId(null)}
            onDuplicate={() => void duplicate([board])}
            onExport={(format) => void exportOne(board, format)}
            onCopyImage={() => void copyImage(board)}
            onTogglePin={() => void label(board, { pinned: !board.pinned })}
            onSetColor={(color) => void label(board, { color })}
            onAskTrash={() => setConfirmId(board.id)}
            onConfirmTrash={() => void trash([board])}
            onCancelTrash={() => setConfirmId(null)}
          />
        ))}
      </ul>
    </section>
  );
}
