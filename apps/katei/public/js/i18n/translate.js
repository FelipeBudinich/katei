import { UI_MESSAGE_CATALOGS } from './messages.js';
import { DEFAULT_UI_LOCALE, resolveSupportedUiLocale } from './locales.js';

export function createTranslator(locale) {
  const uiLocale = resolveSupportedUiLocale(locale) ?? DEFAULT_UI_LOCALE;
  const localeCatalog = UI_MESSAGE_CATALOGS[uiLocale] ?? {};
  const fallbackCatalog = UI_MESSAGE_CATALOGS[DEFAULT_UI_LOCALE] ?? {};

  function translate(key, replacements = {}) {
    const localeValue = getValueByDotPath(localeCatalog, key);
    const fallbackValue = getValueByDotPath(fallbackCatalog, key);
    const template = typeof localeValue === 'string'
      ? localeValue
      : typeof fallbackValue === 'string'
        ? fallbackValue
        : null;

    if (typeof template !== 'string') {
      return String(key);
    }

    return interpolateMessage(template, replacements);
  }

  translate.locale = uiLocale;

  return translate;
}

function getValueByDotPath(value, key) {
  if (typeof key !== 'string' || !key.trim()) {
    return null;
  }

  const path = key
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (path.length === 0) {
    return null;
  }

  let currentValue = value;

  for (const segment of path) {
    if (!currentValue || typeof currentValue !== 'object' || !Object.hasOwn(currentValue, segment)) {
      return null;
    }

    currentValue = currentValue[segment];
  }

  return currentValue;
}

function interpolateMessage(template, replacements) {
  if (!replacements || typeof replacements !== 'object') {
    return template;
  }

  return template.replace(/\{([^{}]+)\}/g, (match, token) => {
    const replacement = replacements[token.trim()];
    return replacement == null ? match : String(replacement);
  });
}
