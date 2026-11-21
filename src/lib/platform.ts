/** Android: la única plataforma móvil que se compila (iOS exige un Mac). No cambia en marcha. */
export const IS_MOBILE = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
