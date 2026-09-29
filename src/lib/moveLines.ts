/**
 * Mover líneas con Alt+↑ / Alt+↓, igual que en VS Code.
 *
 * El texto se trabaja por líneas (`split("\n")` / `join("\n")`), de forma que
 * la última línea del documento puede no tener salto final y el resultado
 * siga siendo fiel: moverla hacia arriba simplemente deja el salto al final.
 */

export interface MoveLinesEdit {
  /** Texto resultante tras el movimiento. */
  text: string;
  /** Inicio de la selección (o del cursor) tras el movimiento. */
  start: number;
  /** Fin de la selección tras el movimiento. */
  end: number;
}

/**
 * Desplaza una posición hacia arriba (`direction` = -1) o hacia abajo (= 1)
 * todas las líneas que toca la selección `[start, end]`, conservando la
 * columna del cursor y el tamaño de la selección.
 *
 * Como en VS Code, una selección que termina justo al empezar una línea no
 * arrastra esa línea, y el bloque no se mueve si saldría del documento
 * (primera línea hacia arriba, última hacia abajo): en esos casos devuelve
 * `null` y no se toca nada.
 */
export function moveLines(
  text: string,
  start: number,
  end: number,
  direction: -1 | 1,
): MoveLinesEdit | null {
  const from = Math.min(Math.max(Math.min(start, end), 0), text.length);
  const to = Math.min(Math.max(Math.max(start, end), 0), text.length);

  const lines = text.split("\n");
  const offsets: number[] = [];
  for (let index = 0, at = 0; index < lines.length; index += 1) {
    offsets.push(at);
    at += lines[index].length + 1;
  }

  const lineAt = (pos: number): number => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (offsets[index] <= pos) return index;
    }
    return 0;
  };

  let first = lineAt(from);
  let last = lineAt(to);
  // La selección acaba en la columna 0 de una línea: esa línea queda fuera.
  if (to > from && offsets[last] === to) last -= 1;
  if (last < first) return null;

  if (direction === -1 && first === 0) return null;
  if (direction === 1 && last === lines.length - 1) return null;

  const block = lines.slice(first, last + 1);
  const next =
    direction === -1
      ? [
          ...lines.slice(0, first - 1),
          ...block,
          lines[first - 1],
          ...lines.slice(last + 1),
        ]
      : [
          ...lines.slice(0, first),
          lines[last + 1],
          ...block,
          ...lines.slice(last + 2),
        ];

  const moved = next.join("\n");
  if (moved === text) return null;

  const nextOffsets: number[] = [];
  for (let index = 0, at = 0; index < next.length; index += 1) {
    nextOffsets.push(at);
    at += next[index].length + 1;
  }

  const target = direction === -1 ? first - 1 : first + 1;
  const start2 = nextOffsets[target] + (from - offsets[first]);
  const end2 = nextOffsets[target + (last - first)] + (to - offsets[last]);

  return {
    text: moved,
    start: Math.min(start2, moved.length),
    end: Math.min(end2, moved.length),
  };
}
