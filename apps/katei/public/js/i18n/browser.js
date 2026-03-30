import { DEFAULT_UI_LOCALE, resolveSupportedUiLocale } from './locales.js';
import { createTranslator } from './translate.js';

export const DEFAULT_BROWSER_DATE_TIME_FORMAT_OPTIONS = Object.freeze({
  dateStyle: 'medium',
  timeStyle: 'short'
});

export function resolveBrowserUiLocale(documentRef = globalThis.document) {
  const htmlElement = documentRef?.documentElement;
  const rawLocale =
    htmlElement?.dataset?.uiLocale ||
    getDocumentLanguage(htmlElement) ||
    '';

  return resolveSupportedUiLocale(rawLocale) ?? DEFAULT_UI_LOCALE;
}

export function getBrowserTranslator(documentRef = globalThis.document) {
  return createTranslator(resolveBrowserUiLocale(documentRef));
}

export function createBrowserDateTimeFormatter(
  options = DEFAULT_BROWSER_DATE_TIME_FORMAT_OPTIONS,
  documentRef = globalThis.document
) {
  return new Intl.DateTimeFormat(resolveBrowserUiLocale(documentRef), options);
}

function getDocumentLanguage(htmlElement) {
  if (!htmlElement) {
    return '';
  }

  if (typeof htmlElement.lang === 'string' && htmlElement.lang.trim()) {
    return htmlElement.lang;
  }

  if (typeof htmlElement.getAttribute === 'function') {
    return htmlElement.getAttribute('lang') ?? '';
  }

  return '';
}
