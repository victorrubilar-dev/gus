import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PenTool, Plus, Trash2 } from "lucide-react";
import BoardEditor from "./BoardEditor";
import BoardPreview from "./BoardPreview";
import EmptyState from "./EmptyState";
import ViewHeader from "./ViewHeader";
import { useT } from "../lib/i18n";
import { joinPath } from "../lib/fileName";
import { serializeBoard } from "../lib/board";
import { createTaskId } from "../lib/taskStore";

interface BoardInfo {
  id: string;
  name: string;
  modifiedMs: number | null;
}

export interface BoardsViewProps {
  vaultPath: string;
}

/** Lista de pizarras del vault (REQ-03); al abrir una, entra en su lienzo. */
export default function BoardsView({ vaultPath }: BoardsViewProps) {
  const t = useT();
  const [boards, setBoards] = useState<BoardInfo[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  /** Borrar pide una segunda pulsación; así un clic suelto no tira una pizarra. */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (openId !== null) return;
    let cancelled = false;
    invoke<BoardInfo[]>("list_boards", { vaultPath })
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

  async function create() {
    const id = createTaskId();
    try {
      await invoke("save_board", { vaultPath, id, json: serializeBoard({ name: t("boards.untitled"), elements: [] }) });
      setOpenId(id);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function remove(board: BoardInfo) {
    setConfirmId(null);
    try {
      // A la papelera del vault: se puede restaurar desde ahí.
      await invoke("move_to_trash", { path: joinPath(joinPath(vaultPath, ".gus-boards"), `${board.id}.json`), vault: vaultPath });
      setReload((key) => key + 1);
    } catch (reason) {
      setError(String(reason));
    }
  }

  if (openId !== null) {
    return <BoardEditor vaultPath={vaultPath} boardId={openId} onBack={() => setOpenId(null)} />;
  }

  return (
    <section data-tour="boards" className="gus-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
      <ViewHeader
        title={t("boards.title")}
        description={t("boards.desc")}
        actions={
          <button type="button" onClick={() => void create()} className="gus-btn gus-btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t("boards.new")}
          </button>
        }
      />

      {status === "loading" && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
      {error && <p className="break-words rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">{error}</p>}

      {status === "ready" && boards.length === 0 && <EmptyState icon={PenTool} title={t("boards.empty")} />}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {boards.map((board) => (
          <li key={board.id} className="group relative rounded-xl border border-gus-border bg-gus-card transition-colors hover:border-gus-accent/50">
            <button
              type="button"
              onClick={() => setOpenId(board.id)}
              className="flex w-full flex-col rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-gus-accent/60"
            >
              <BoardPreview vaultPath={vaultPath} id={board.id} version={board.modifiedMs} />
              <span className="flex flex-col gap-0.5 p-3">
                <span className="truncate text-sm font-medium text-gus-text">{board.name}</span>
                {board.modifiedMs !== null && (
                  <span className="text-meta text-gus-muted">{new Date(board.modifiedMs).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => (confirmId === board.id ? void remove(board) : setConfirmId(board.id))}
              onBlur={() => setConfirmId((current) => (current === board.id ? null : current))}
              aria-label={t("boards.deleteNamed", { name: board.name })}
              title={confirmId === board.id ? t("boards.deleteConfirm") : t("boards.delete")}
              className={
                confirmId === board.id
                  ? "absolute top-2 right-2 rounded-md bg-rose-400/25 px-2 py-1 text-meta text-rose-200"
                  : "absolute top-2 right-2 rounded-md bg-gus-card/80 p-1.5 text-gus-muted opacity-0 transition hover:bg-rose-400/10 hover:text-rose-400 focus-visible:opacity-100 group-hover:opacity-100"
              }
            >
              {confirmId === board.id ? t("boards.deleteConfirm") : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
