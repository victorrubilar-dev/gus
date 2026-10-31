import clsx from "clsx";

/** Anillo de progreso: `done` de `total`, con un texto opcional en el centro. */
export default function Ring({ done, total, size, stroke, label }: { done: number; total: number; size: number; stroke: number; label?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total === 0 ? 0 : done / total;

  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-gus-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className={clsx("transition-[stroke-dashoffset] duration-300", ratio === 1 ? "stroke-gus-accent" : "stroke-gus-accent/70")}
        />
      </svg>
      {label && <span className="absolute text-center leading-none">{label}</span>}
    </span>
  );
}
