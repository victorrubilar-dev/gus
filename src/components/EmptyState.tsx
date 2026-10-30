import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** Acción primaria opcional, normalmente un `gus-btn gus-btn-primary`. */
  action?: ReactNode;
}

/** Estado vacío común: icono, título y, si hace falta, una acción. */
export default function EmptyState({ icon: Icon, title, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Icon className="h-6 w-6 text-gus-muted" strokeWidth={1.75} aria-hidden="true" />
      <p className="text-display text-gus-text">{title}</p>
      {action}
    </div>
  );
}
