import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  DEFAULT_LANGUAGE,
  isLanguage,
  resolveSystemLanguage,
  setLanguage,
  t,
  translate,
  type Language,
  type MessageKey,
  type TranslateParams,
} from "./core";

export interface I18nValue {
  language: Language;
  t: (key: MessageKey, params?: TranslateParams) => string;
}

const I18nContext = createContext<I18nValue>({
  language: DEFAULT_LANGUAGE,
  t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
});

/**
 * El idioma no depende del vault (es una preferencia de la persona, no del
 * contenido), así que vive en `localStorage`: se aplica antes del primer
 * render y así la ventana aparece ya en el idioma elegido.
 *
 * La primera vez no hay nada guardado y se usa el idioma del sistema (o el
 * más parecido si Gus no lo traduce). Solo quien cambia el idioma a mano lo
 * deja escrito: así un idioma de sistema nuevo sigue notándose.
 */
const STORAGE_KEY = "gus.language";

export function readStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && isLanguage(stored)) {
      setLanguage(stored);
      return stored;
    }
  } catch {
    // Sin almacenamiento (o con un idioma guardado corrupto): se detecta solo.
  }

  const detected = resolveSystemLanguage();
  setLanguage(detected);
  return detected;
}

export function storeLanguage(lang: Language): void {
  setLanguage(lang);
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
  }
}

export function I18nProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({
      language,
      t: (key, params) => translate(language, key, params),
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Traductor del componente. Re-renderiza solo cuando cambia el idioma. */
export function useT(): I18nValue["t"] {
  return useContext(I18nContext).t;
}

export function useLanguage(): Language {
  return useContext(I18nContext).language;
}

/**
 * Traductor para código que no es un componente de React (o que está fuera del
 * árbol, como los menús creados a mano): lee el idioma activo global.
 */
export { t };
