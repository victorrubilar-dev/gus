import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImageOff, X } from "lucide-react";
import { useT } from "../lib/i18n";
import { filterVaultImages, type VaultImage } from "../lib/imageLinks";

/** Con más que esto el selector es una lista que nadie recorre: se busca por nombre. */
const SHOWN = 48;

function Thumb({ image }: { image: VaultImage }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("read_vault_image_thumb", { path: image.path, maxPx: 96 })
      .then((thumb) => !cancelled && setSrc(thumb))
      .catch(() => {
        // Formato sin miniatura: se queda el icono.
      });
    return () => {
      cancelled = true;
    };
  }, [image.path]);

  return src ? (
    <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
  ) : (
    <ImageOff className="h-5 w-5 text-gus-muted" aria-hidden="true" />
  );
}

export interface BoardImagePickerProps {
  vaultPath: string;
  onPick: (image: VaultImage) => void;
  onClose: () => void;
}

/** Elige una imagen del vault para ponerla en la pizarra. */
export default function BoardImagePicker({ vaultPath, onPick, onClose }: BoardImagePickerProps) {
  const t = useT();
  const [images, setImages] = useState<VaultImage[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    invoke<VaultImage[]>("list_vault_images", { path: vaultPath })
      .then((list) => !cancelled && setImages(list))
      .catch(() => !cancelled && setImages([]));
    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  const shown = useMemo(() => filterVaultImages(images ?? [], query, SHOWN), [images, query]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("boards.pickImage")}
      className="absolute inset-0 z-20 grid place-items-center bg-black/40 p-6"
      onKeyDown={(event) => event.key === "Escape" && onClose()}
    >
      <div className="flex max-h-full w-full max-w-xl flex-col gap-3 rounded-2xl border border-gus-border bg-gus-card p-4 shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("boards.searchImage")}
            aria-label={t("boards.searchImage")}
            className="min-w-0 flex-1 rounded-lg border border-gus-border bg-gus-panel px-2 py-1.5 text-body text-gus-text outline-none focus:border-gus-accent/60"
          />
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="gus-btn gus-btn-icon">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {images === null && <p className="text-body text-gus-muted">{t("common.loading")}</p>}
        {images !== null && shown.length === 0 && <p className="text-body text-gus-muted">{t("boards.noImages")}</p>}

        <ul className="gus-scrollbar grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 overflow-y-auto">
          {shown.map((image) => (
            <li key={image.path}>
              <button
                type="button"
                onClick={() => onPick(image)}
                title={image.relative}
                className="flex w-full flex-col gap-1 rounded-lg border border-gus-border bg-gus-panel p-1.5 text-left hover:border-gus-accent/60 focus-visible:ring-2 focus-visible:ring-gus-accent/60 focus-visible:outline-none"
              >
                <span className="grid aspect-square place-items-center overflow-hidden rounded-md bg-gus-bg">
                  <Thumb image={image} />
                </span>
                <span className="truncate text-meta text-gus-muted">{image.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
