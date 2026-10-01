import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { useT } from "../lib/i18n";

interface CopyCodeButtonProps {
  /** Contenido del bloque de código que se lleva al portapapeles. */
  text: string;
}

/**
 * Botón de copiar de la vista previa: igual que el de Obsidian, en la esquina
 * superior derecha del bloque, transparente hasta que el ratón pasa por
 * encima; al pulsarlo el icono cambia a ✔ durante un segundo.
 */
export default function CopyCodeButton({ text }: CopyCodeButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function handleClick() {
    const ok = await copyText(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1000);
  }

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={copied ? t("common.copied") : t("common.copy")}
      aria-label={copied ? t("editor.codeCopied") : t("editor.copyCode")}
      className={clsx(
        "absolute top-1.5 right-1.5 z-10 rounded px-2 py-1.5 transition-colors",
        // Invisible hasta que el ratón entra en el bloque (como Obsidian, que
        // lo oculta con :not(:hover)); el foco de teclado también lo enseña.
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        "hover:bg-gus-border/70",
        copied ? "text-emerald-400 hover:text-emerald-400" : "text-gus-muted hover:text-gus-text",
      )}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}
