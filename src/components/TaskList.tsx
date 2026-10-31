import { Fragment, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { ListTodo, Plus, RefreshCw, SquareKanban, StickyNote } from "lucide-react";
import type { Task } from "../lib/taskStore";
import {
  addSubtask as addSubtaskTo,
  cyclePriority as cyclePriorityOf,
  matchesTag as tagMatches,
  moveToColumn,
  removeTask,
  setTags,
  tagCounts,
  toggleDone,
} from "../lib/taskActions";
import { useTaskStore } from "./useTaskStore";
import { DUE_CLASS, dueKind, shortDate } from "../lib/taskDue";
import { useT } from "../lib/i18n";
import TaskRow from "./TaskRow";
import { TagFilterBar } from "./TaskTags";
import type { MessageKey, TranslateParams } from "../lib/i18n/core";
import EmptyState from "./EmptyState";
import SegmentedControl from "./SegmentedControl";
import ViewHeader from "./ViewHeader";
import TaskRelations from "./TaskRelations";
import { flattenTree, pendingBlockers, setParent, subtaskProgress, toggleBlocker } from "../lib/taskTree";
import NoteTasksView from "./NoteTasksView";
import type { NoteTask } from "../lib/noteTasks";
import KanbanBoard, { type KanbanColumnId } from "./KanbanBoard";

export type { Task };

type Translator = (key: MessageKey, params?: TranslateParams) => string;

export interface TaskListProps {
  tasks?: Task[];
  vaultPath?: string | null;
  onTasksChange?: (tasks: Task[]) => void;
  hideCompleted?: boolean;
  onNewTask: () => void;
  /** Checkboxes de las notas (REQ-09): marcarlos reescribe la línea de su nota. */
  onToggleNoteTask?: (task: NoteTask) => Promise<void>;
  onOpenNote?: (path: string) => void;
}

function dueState(
  task: { completes: boolean; due?: string },
  t: Translator,
): { due: string; title: string; className: string } | null {
  const due = task.due;
  if (!due) return null;

  const kind = dueKind(task, due);
  const title =
    kind === "overdue"
      ? t("tasks.dueOverdue")
      : kind === "today"
        ? t("tasks.dueToday")
        : `${t("tasks.dueLabel")}: ${shortDate(due)}`;
  return { due, title, className: DUE_CLASS[kind] };
}

export default function TaskList({
  tasks = [],
  vaultPath,
  onTasksChange,
  hideCompleted = false,
  onNewTask,
  onToggleNoteTask,
  onOpenNote,
}: TaskListProps) {
  const t = useT();
  const { fileMode, items, status, loadError, syncError, commitTasks, reload } = useTaskStore({
    vaultPath,
    tasks,
    onTasksChange,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const [relationsId, setRelationsId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "board" | "notes">("board");

  function toggle(id: string) {
    commitTasks(toggleDone(items, id));
  }

  function cyclePriority(id: string) {
    commitTasks(cyclePriorityOf(items, id));
  }

  function moveTask(id: string, column: KanbanColumnId) {
    commitTasks(moveToColumn(items, id, column));
  }

  function toggleTagFilter(tag: string) {
    setTagFilter((current) =>
      current?.toLowerCase() === tag.toLowerCase() ? null : tag,
    );
  }

  function matchesTag(tags: string[]): boolean {
    return tagMatches(tags, tagFilter);
  }

  function remove(id: string) {
    commitTasks(removeTask(items, id));
    if (relationsId === id) setRelationsId(null);
  }

  function addSubtask(parentId: string, title: string) {
    commitTasks(addSubtaskTo(items, parentId, title));
  }

  const visible = flattenTree(
    [...items]
      .filter((task) => (!hideCompleted || !task.completes) && matchesTag(task.tags))
      .sort((a, b) => Number(a.completes) - Number(b.completes)),
  );
  const done = items.filter((task) => task.completes).length;

  const boardItems = items.filter((task) => matchesTag(task.tags));


  const tagEntries = tagCounts(items);

  return (
    <section data-tour="tasks" className="flex h-full flex-col gap-4 p-6">
      <ViewHeader
        title={t("tasks.title")}
        titleHint={vaultPath ? t("tasks.storeTitle", { path: vaultPath }) : t("tasks.staticList")}
        actions={
          <>
            <SegmentedControl
              ariaLabel={t("tasks.title")}
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: t("tasks.viewBoard"), title: t("tasks.kanban"), icon: SquareKanban },
                { value: "list", label: t("tasks.viewList"), title: t("tasks.list"), icon: ListTodo },
                ...(fileMode && onToggleNoteTask
                  ? [{ value: "notes" as const, label: t("tasks.viewNotes"), title: t("tasks.notesTitle"), icon: StickyNote }]
                  : []),
              ]}
            />
            <span className="text-body text-gus-muted">
              {status === "loading"
                ? t("common.loading")
                : t("tasks.doneCount", { done, total: items.length })}
            </span>
          </>
        }
      />

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onNewTask}
          disabled={status === "loading" || status === "error"}
          className="gus-btn gus-btn-primary w-full"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("tasks.new")}
        </button>

        {syncError && (
          <p className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-3 py-2 text-body text-rose-300">
            {t("tasks.syncError", { error: syncError })}
          </p>
        )}

      </div>

      <TagFilterBar
        entries={tagEntries}
        activeFilter={tagFilter}
        onToggle={toggleTagFilter}
        onClear={() => setTagFilter(null)}
      />

      <div className="gus-scrollbar flex-1 space-y-6 overflow-y-auto pr-1">
        {/* La frontera vive fuera de las condiciones de vista: al cambiar de
            vista observa la salida (los `m.li` anidados corren su `exit`) y la
            lista espera a terminar antes de enseñar el tablero. */}
        <AnimatePresence mode="wait" initial={false}>
        {view === "board" && (
          <div key="board" className="space-y-3">
            {status === "loading" && (
              <p className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
                {t("tasks.loading")}
              </p>
            )}

            {status === "error" && (
              <p className="break-words rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-body text-rose-300">
                {t("tasks.loadError")}
                {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                {loadError && <span className="block text-rose-400/80">{loadError}</span>}
              </p>
            )}

            {status === "ready" && (
              <KanbanBoard
                tasks={boardItems}
                onMove={moveTask}
                onTagClick={toggleTagFilter}
                tagFilter={tagFilter}
              />
            )}
          </div>
        )}

        {view === "notes" && vaultPath && onToggleNoteTask && (
          <NoteTasksView
            key="notes"
            vaultPath={vaultPath}
            hideCompleted={hideCompleted}
            onToggle={onToggleNoteTask}
            onOpenNote={onOpenNote}
          />
        )}

        {view === "list" && (
        <ul key="list" className="space-y-2">
            {visible.map(({ task, depth }) => {
              return (
                <Fragment key={task.id}>
                  <TaskRow
                    task={task}
                    depth={depth}
                    due={dueState(task, t)}
                    progress={subtaskProgress(items, task.id)}
                    waiting={pendingBlockers(items, task)}
                    tagFilter={tagFilter}
                    isEditingTags={editingId === task.id}
                    relationsOpen={relationsId === task.id}
                    onToggle={() => toggle(task.id)}
                    onCyclePriority={() => cyclePriority(task.id)}
                    onToggleTagFilter={toggleTagFilter}
                    onStartEditingTags={() => setEditingId(task.id)}
                    onCommitTags={(tags) => commitTasks(setTags(items, task.id, tags))}
                    onStopEditingTags={() => setEditingId(null)}
                    onToggleRelations={() => setRelationsId((current) => (current === task.id ? null : task.id))}
                    onRemove={() => remove(task.id)}
                  />
                {relationsId === task.id && (
                  <li style={{ marginLeft: depth * 24 }}>
                    <TaskRelations
                      task={task}
                      tasks={items}
                      onSetParent={(parentId) => commitTasks(setParent(items, task.id, parentId))}
                      onToggleBlocker={(blockerId) => commitTasks(toggleBlocker(items, task.id, blockerId))}
                      onAddSubtask={(title) => addSubtask(task.id, title)}
                    />
                  </li>
                )}
                </Fragment>
              );
            })}

          {status === "loading" && (
            <li className="rounded-xl border border-dashed border-gus-border px-4 py-8 text-center text-sm text-gus-muted">
              {t("tasks.loading")}
            </li>
          )}

          {status === "error" && (
            <li className="flex flex-col items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-400/5 px-4 py-4 text-body text-rose-300">
              <span className="break-words">
                {t("tasks.loadError")}
                {vaultPath && <span className="font-mono"> · {vaultPath}</span>}
                {loadError && <span className="block text-rose-400/80">{loadError}</span>}
              </span>
              <button
                type="button"
                onClick={reload}
                className="flex items-center gap-1.5 rounded-md border border-gus-border bg-gus-card px-2 py-1 text-gus-muted transition-colors hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                {t("editor.retry")}
              </button>
            </li>
          )}

          {status === "ready" && visible.length === 0 && (
            <li className="rounded-xl border border-dashed border-gus-border">
              <EmptyState
                icon={ListTodo}
                title={tagFilter ? t("tasks.emptyFiltered", { tag: tagFilter }) : t("tasks.empty")}
              />
            </li>
          )}
        </ul>
        )}
        </AnimatePresence>

      </div>
    </section>
  );
}
