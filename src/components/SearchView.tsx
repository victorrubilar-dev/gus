import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CalendarRange,
  FolderTree,
  Loader2,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import clsx from "clsx";
import { useT } from "../lib/i18n";
import { baseName } from "../lib/fileName";
import {
  EMPTY_FILTERS,
  canSearch,
  filtersActive,
  snippetHits,
  type SearchFacets,
  type SearchFilters,
  type SearchResults,
  type SearchSnippet,
} from "../lib/searchIndex";

type LoadState = "idle" | "loading" | "ready" | "error";

export interface SearchViewProps {
  vaultPath: string;
  /** Cambios en el vault: hay que reconstruir el índice. */
  refreshKey?: number;
  /** Abre la nota de un resultado con clic. */
  onOpenNote: (note: { path: string; name: string }) => void;
  /**
   * Avisa a la app de que el índice ya existe, para que pueda mantenerlo al
   * editar sin volver a leer el vault entero.
   */
  onIndexReady?: () => void;
}

const FIELD_CLASS =
  "rounded-lg border border-gus-border bg-gus-panel px-2 py-1 text-xs text-gus-text outline-none transition-colors focus:border-gus-accent/60";

const ICON_BUTTON_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-md text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70";

/** Fecha corta de un resultado: «12 oct 2026». */
function shortDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Una línea de fragmento, con las coincidencias ya marcadas. */
function SnippetLine({ snippet }: { snippet: SearchSnippet }) {
  return (
    <p className="flex gap-2 text-xs leading-relaxed text-gus-text/80">
      <span className="w-8 shrink-0 text-right tabular-nums text-gus-muted/60 select-none">
        {snippet.line}
      </span>
      <span className="min-w-0 flex-1 break-words">
        {snippet.segments.map((segment, index) =>
          segment.hit ? (
            <mark
              key={index}
              className="rounded-sm bg-gus-accent/25 px-0.5 text-gus-accent"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </span>
    </p>
  );
}

/**
 * Búsqueda a texto completo dentro del vault (REQ-08). El índice vive en
 * `.gus-index/index.json` y lo levanta el backend: aquí solo se pide, se
 * filtra y se pintan los aciertos resaltados.
 */
export default function SearchView({
  vaultPath,
  refreshKey = 0,
  onOpenNote,
  onIndexReady,
}: SearchViewProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  /**
   * Consulta ya dejada de escribir: los resultados se piden con esta, no con
   * cada tecla, para no inundar al backend.
   */
  const [settledQuery, setSettledQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [indexState, setIndexState] = useState<LoadState>("loading");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<LoadState>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [tag, setTag] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  /** Cambia al pulsar «reconstruir», para pedir un índice nuevo a mano. */
  const [rebuildNonce, setRebuildNonce] = useState(0);

  /** Número de petición en vuelo: una respuesta vieja no pisa a la nueva. */
  const searchTokenRef = useRef(0);

  const filters = useMemo<SearchFilters>(
    () => ({
      ...EMPTY_FILTERS,
      folder,
      tags: tag ? [tag] : [],
      modifiedAfterMs: from ? new Date(`${from}T00:00:00`).getTime() : null,
      modifiedBeforeMs: to ? new Date(`${to}T23:59:59.999`).getTime() : null,
    }),
    [folder, tag, from, to],
  );

  /** Reconstruye el índice al abrir la pestaña y al cambiar el vault. */
  useEffect(() => {
    let cancelled = false;
    setIndexState("loading");
    setIndexError(null);

    async function rebuild(): Promise<void> {
      await invoke("build_search_index", { path: vaultPath });
      if (cancelled) return;

      const next = await invoke<SearchFacets>("search_index_facets", { path: vaultPath });
      if (cancelled) return;

      setFacets(next);
      setIndexState("ready");
      onIndexReady?.();
    }

    rebuild().catch((reason: unknown) => {
      if (cancelled) return;
      // El índice anterior se conserva: se puede seguir buscando en él.
      setIndexState("ready");
      setIndexError(String(reason));
    });

    return () => {
      cancelled = true;
    };
  }, [vaultPath, refreshKey, rebuildNonce, onIndexReady]);

  /** Retardo antes de buscar: evita una petición por tecla. */
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledQuery(query), 260);
    return () => window.clearTimeout(timer);
  }, [query]);

  /** Ejecuta la búsqueda cuando cambia la consulta o los filtros. */
  useEffect(() => {
    if (!canSearch(settledQuery)) {
      searchTokenRef.current += 1;
      setResults(null);
      setSearchState("idle");
      setSearchError(null);
      return;
    }

    const token = ++searchTokenRef.current;
    setSearchState("loading");
    setSearchError(null);

    invoke<SearchResults>("search_notes", {
      path: vaultPath,
      query: settledQuery,
      filters,
    })
      .then((next) => {
        if (token !== searchTokenRef.current) return;
        setResults(next);
        setSearchState("ready");
      })
      .catch((reason: unknown) => {
        if (token !== searchTokenRef.current) return;
        // Los resultados anteriores se quedan en pantalla junto al error.
        setSearchState("error");
        setSearchError(String(reason));
      });
  }, [vaultPath, settledQuery, filters]);

  const activeFilters = filtersActive(filters);
  const shown = results?.matches ?? [];

  return (
    <div data-tour="search" className="flex h-full w-full flex-col bg-gus-bg">
      <header className="flex items-center gap-2 border-b border-gus-border px-4 py-2">
        <Search className="h-3.5 w-3.5 shrink-0 text-gus-accent" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-xs font-semibold tracking-wide text-gus-text">
          {t("search.title")}
        </span>

        {facets && indexState === "ready" && (
          <span className="text-[11px] text-gus-muted">
            {t("search.indexNotes", { count: facets.notes })}
          </span>
        )}

        <button
          type="button"
          onClick={() => setRebuildNonce((value) => value + 1)}
          disabled={indexState === "loading"}
          title={t("search.reindex")}
          className={clsx(ICON_BUTTON_CLASS, "ml-auto")}
        >
          {indexState === "loading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </header>

      <div className="flex flex-col gap-2 border-b border-gus-border px-4 py-3">
        <label className="flex items-center gap-2 rounded-xl border border-gus-border bg-gus-panel px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-gus-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-gus-text outline-none placeholder:text-gus-muted/70"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              title={t("common.close")}
              className={ICON_BUTTON_CLASS}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1.5">
            <FolderTree className="h-3.5 w-3.5 text-gus-muted" aria-hidden="true" />
            <select
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              aria-label={t("search.filterFolder")}
              className={FIELD_CLASS}
            >
              <option value="">{t("search.allFolders")}</option>
              {(facets?.folders ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5 text-gus-muted" aria-hidden="true" />
            <select
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              aria-label={t("search.filterTag")}
              className={FIELD_CLASS}
            >
              <option value="">{t("search.allTags")}</option>
              {(facets?.tags ?? []).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5 text-gus-muted" aria-hidden="true" />
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label={t("search.filterFrom")}
              className={FIELD_CLASS}
            />
            <span className="text-[11px] text-gus-muted">→</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label={t("search.filterTo")}
              className={FIELD_CLASS}
            />
          </label>

          {activeFilters && (
            <button
              type="button"
              onClick={() => {
                setFolder("");
                setTag("");
                setFrom("");
                setTo("");
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-gus-muted outline-none transition-colors hover:bg-gus-card hover:text-gus-text focus-visible:ring-2 focus-visible:ring-gus-accent/70"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              {t("search.clearFilters")}
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {indexState === "error" && (
          <p role="alert" className="text-sm text-rose-300">
            {indexError ?? t("search.indexError")}
          </p>
        )}

        {indexState === "ready" && facets?.notes === 0 && (
          <p className="text-sm text-gus-muted">{t("search.indexEmpty")}</p>
        )}

        {!canSearch(settledQuery) && indexState !== "error" && (
          <p className="text-sm text-gus-muted">{t("search.empty")}</p>
        )}

        {canSearch(settledQuery) && (
          <>
            <p className="mb-2 text-[11px] text-gus-muted">
              {searchState === "loading"
                ? t("search.searching")
                : t("search.results", { count: results?.total ?? 0 })}
            </p>

            {searchState === "error" && (
              <p role="alert" className="mb-2 text-sm text-rose-300">
                {searchError ?? t("search.error")}
              </p>
            )}

            {searchState !== "loading" && shown.length === 0 && searchState !== "error" && (
              <p className="text-sm text-gus-muted">{t("search.noResults")}</p>
            )}

            <ul className="flex flex-col gap-2">
              {shown.map((match) => {
                const hits = match.snippets.reduce(
                  (total, snippet) => total + snippetHits(snippet),
                  0,
                );

                return (
                  <li key={match.path}>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenNote({ path: match.path, name: baseName(match.path) })
                      }
                      className="flex w-full flex-col gap-1.5 rounded-xl border border-gus-border bg-gus-panel px-3 py-2 text-left outline-none transition-colors hover:border-gus-accent/40 focus-visible:ring-2 focus-visible:ring-gus-accent/70"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-gus-text">
                          {match.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-gus-muted">
                          {match.folder || t("search.rootFolder")}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-gus-muted">
                          {shortDate(match.modifiedMs)}
                        </span>
                      </span>

                      {match.tags.length > 0 && (
                        <span className="flex flex-wrap gap-1">
                          {match.tags.map((entry) => (
                            <span
                              key={entry}
                              className="rounded-full border border-gus-accent/40 bg-gus-accent/15 px-1.5 text-[10px] text-gus-accent"
                            >
                              {entry}
                            </span>
                          ))}
                        </span>
                      )}

                      {match.snippets.length > 0 ? (
                        <span className="flex flex-col gap-0.5">
                          {match.snippets.map((snippet, index) => (
                            <SnippetLine key={`${snippet.line}-${index}`} snippet={snippet} />
                          ))}
                          {hits > 1 && (
                            <span className="pl-10 text-[11px] text-gus-muted">
                              {t("search.matches", { count: hits })}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-gus-muted/70">
                          {t("search.titleOnly")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
