import { useT } from "../lib/i18n";

export interface OpenImage {
  path: string;
  title: string;
  src: string | null;
  error?: string;
}

interface ImagePaneProps {
  image: OpenImage;
  status: "idle" | "loading" | "ready" | "error";
  /** El webview no pudo decodificar el archivo: `error` es el texto para el usuario. */
  onDecodeError: (error: string) => void;
}

/** Visor de una imagen del vault, con su cabecera y los estados de carga y error. */
export default function ImagePane({ image, status, onDecodeError }: ImagePaneProps) {
  const t = useT();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-gus-border bg-gus-panel px-4 py-2">
        <span className="truncate font-mono text-body text-gus-muted">{image.title}</span>
        <span className="shrink-0 gus-chip uppercase tracking-wide">
          {t("app.badge.image")}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/20 p-4">
        {status === "loading" && (
          <p className="text-sm text-white/60">{t("app.loadingImage")}</p>
        )}

        {status === "error" && (
          <div className="flex max-w-md flex-col items-center gap-2 px-6 text-center">
            <p className="text-sm text-gus-muted">{t("app.imageError")}</p>
            {image.error && (
              <p className="break-words text-body text-rose-300">{image.error}</p>
            )}
          </div>
        )}

        {status === "ready" && image.src && (
          <img
            src={image.src}
            alt={image.title}
            onError={() => onDecodeError(t("app.imageDecodeError", { name: image.title }))}
            className="max-h-full max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}
