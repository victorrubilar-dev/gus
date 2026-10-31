import type { ReactNode } from "react";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

/** Tarjeta del resumen: icono y título a la izquierda, una acción opcional a la derecha. */
export default function DashboardCard({
  icon: Icon,
  title,
  badge,
  action,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx("flex min-w-0 flex-col gap-3 rounded-xl border border-gus-border bg-gus-card p-4", className)}>
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-gus-muted" strokeWidth={1.75} aria-hidden="true" />
          <h3 className="text-sm font-semibold">{title}</h3>
          {badge}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Botón de texto discreto para la esquina de una tarjeta («Ver todas», «Ver hábitos»…). */
export function CardLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="gus-btn gus-btn-ghost w-auto px-2 text-body focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}
