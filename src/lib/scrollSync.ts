/** Lo que hace falta de un contenedor con scroll. */
export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Posición de `to` que corresponde a la de `from`, en proporción a lo que cada
 * uno puede desplazarse: la vista dividida mueve juntos el texto y su lectura.
 */
export function followScrollTop(from: ScrollBox, to: ScrollBox): number {
  const fromMax = from.scrollHeight - from.clientHeight;
  const toMax = to.scrollHeight - to.clientHeight;
  if (fromMax <= 0 || toMax <= 0) return 0;
  return Math.round((from.scrollTop / fromMax) * toMax);
}
