/** Nombres de pizarra: el de una copia y las etiquetas de selección. */

/**
 * Nombre para la copia de una pizarra: «Plan (copia)», y si ya existe, «Plan
 * (copia 2)», «Plan (copia 3)»… Si se copia una copia no se encadenan sufijos.
 */
export function copyName(name: string, taken: readonly string[], label: string): string {
  const base = name.replace(new RegExp(`\\s*\\(${label}(?: \\d+)?\\)$`), "").trim() || name;
  const used = new Set(taken.map((entry) => entry.trim().toLowerCase()));
  let candidate = `${base} (${label})`;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${label} ${n})`;
  return candidate;
}
