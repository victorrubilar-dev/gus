import type { ReactNode } from "react";

interface ViewHeaderProps {
  title: string;
  /** Texto del tooltip del título (p. ej. dónde se guardan las tareas). */
  titleHint?: string;
  description?: string;
  actions?: ReactNode;
}

/** Cabecera común de las vistas: título, descripción corta y acciones a la derecha. */
export default function ViewHeader({ title, titleHint, description, actions }: ViewHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-title font-semibold text-gus-text" title={titleHint}>
          {title}
        </h2>
        {description && <p className="text-body text-gus-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
