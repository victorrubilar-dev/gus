/** Contrato entre el menú de creación y las vistas que insertan la tarea. */
import type { TaskPriority } from "./taskPriority";

/** Payload del evento `task-created` (ventana del formulario → lista). */
export interface NewTask {
  title: string;
  /** Detalle opcional; llega como `null` cuando el formulario lo dejó vacío. */
  description?: string | null;
  /** Etiquetas libres, en orden. */
  tags: string[];
  /** Fecha de plazo ISO `AAAA-MM-DD`; `null` si no tiene. */
  due?: string | null;
  /** Prioridad elegida; `null` o ausente = sin prioridad. */
  priority?: TaskPriority | null;
}

/** Nombre del evento Tauri que publica la tarea creada. */
export const NEW_TASK_EVENT = "task-created";
