import type { TaskPriority } from "./taskPriority";

export interface NewTask {
  title: string;
  description?: string | null;
  tags: string[];
  due?: string | null;
  priority?: TaskPriority | null;
}

export const NEW_TASK_EVENT = "task-created";
