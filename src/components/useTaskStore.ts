import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { NEW_TASK_EVENT, type NewTask } from "../lib/newTask";
import { taskFromNew } from "../lib/taskActions";
import { loadTaskStore, type Task } from "../lib/taskStore";

interface TaskStoreOptions {
  /** Con vault, las tareas viven en `.gus-tasks.json`; sin él, en la lista que pasa el padre. */
  vaultPath?: string | null;
  tasks: Task[];
  onTasksChange?: (tasks: Task[]) => void;
}

/**
 * Las tareas y su almacén: carga, guardado en orden (una cola, para que dos
 * cambios seguidos no se pisen) y las tareas nuevas que llegan del diálogo.
 */
export function useTaskStore({ vaultPath, tasks, onTasksChange }: TaskStoreOptions) {
  const fileMode = vaultPath != null && vaultPath !== "";
  const [items, setItems] = useState<Task[]>(() =>
    fileMode ? [] : tasks.map((task) => ({ ...task })),
  );
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() =>
    fileMode ? "loading" : "ready",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  // Último callback del padre. Al llamarse también desde handlers (no solo
  // desde efectos) hace falta el espejo de ref, sincronizado tras el commit.
  const onTasksChangeRef = useRef(onTasksChange);
  useLayoutEffect(() => {
    onTasksChangeRef.current = onTasksChange;
  });

  useEffect(() => {
    if (!fileMode || !vaultPath) return;

    let cancelled = false;
    setStatus("loading");

    loadTaskStore(vaultPath)
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setLoadError(null);
        setStatus("ready");
        onTasksChangeRef.current?.(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        setLoadError(String(error));
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [fileMode, vaultPath, reloadKey]);

  function notify(next: Task[]) {
    onTasksChangeRef.current?.(next);
  }

  function updateLocal(next: Task[]) {
    setItems(next);
    notify(next);
  }

  function commitTasks(next: Task[]) {
    setItems(next);
    setSyncError(null);
    notify(next);

    if (fileMode && vaultPath) {
      const path = vaultPath;
      writeQueueRef.current = writeQueueRef.current
        .then(() => invoke("save_tasks", { vaultPath: path, tasks: next }))
        .catch((error: unknown) => setSyncError(String(error)));
    }
  }

  function addTaskFromWindow(input: NewTask) {
    if (fileMode && status !== "ready") return;
    const nextTask = taskFromNew(input);
    if (!nextTask) return;

    if (fileMode) {
      commitTasks([nextTask, ...items]);
    } else {
      updateLocal([nextTask, ...items]);
    }
  }

  const onNewTaskEvent = useEffectEvent(addTaskFromWindow);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listen<NewTask>(NEW_TASK_EVENT, (event) => {
      onNewTaskEvent(event.payload);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return {
    fileMode,
    items,
    status,
    loadError,
    syncError,
    commitTasks,
    reload: () => setReloadKey((key) => key + 1),
  };
}
