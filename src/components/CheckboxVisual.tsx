import { m } from "framer-motion";
import { Check } from "lucide-react";

export default function CheckboxVisual({ checked }: { checked: boolean }) {
  return (
    <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded-md border border-gus-border bg-gus-panel transition-colors peer-checked:border-gus-accent peer-checked:bg-gus-accent peer-focus-visible:ring-2 peer-focus-visible:ring-gus-accent/60">
      <m.span
        initial={false}
        animate={{ scale: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      >
        <Check className="h-3.5 w-3.5 text-gus-bg" strokeWidth={3} aria-hidden="true" />
      </m.span>
    </span>
  );
}
