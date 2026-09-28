/** Factor de zoom CSS activo (escala de la interfaz); 1 = 100%. */
export function uiZoomFactor(): number {
  const raw = Number.parseFloat(document.documentElement.style.zoom);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Convierte una medida de viewport (coordenada de evento, rect o delta de
 * puntero) al espacio local: con zoom activo, `left`/`top` de los menús se
 * resuelven multiplicados, mientras eventos y rects vienen en px de pantalla.
 */
export function toLocalCoord(value: number): number {
  return value / uiZoomFactor();
}
