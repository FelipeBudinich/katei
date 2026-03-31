const EMPTY_LOCALE_LIST = Object.freeze([]);

export function createDefaultBoardLanguagePolicy() {
  return {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  };
}

export const DEFAULT_BOARD_LANGUAGE_POLICY = Object.freeze({
  sourceLocale: 'en',
  defaultLocale: 'en',
  supportedLocales: Object.freeze(['en']),
  requiredLocales: Object.freeze(['en'])
});

export function canonicalizeContentLocale(input) {
  const normalizedInput = normalizeLocaleInput(input);

  if (!normalizedInput || normalizedInput === '*') {
    return null;
  }

  try {
    return Intl.getCanonicalLocales(normalizedInput)[0] ?? null;
  } catch (error) {
    return null;
  }
}

export function normalizeBoardLanguagePolicy(policy) {
  if (policy === null) {
    return createDefaultBoardLanguagePolicy();
  }

  if (policy === undefined) {
    return null;
  }

  if (!isPlainObject(policy)) {
    return null;
  }

  const sourceLocale = canonicalizeContentLocale(policy.sourceLocale);
  const defaultLocale = canonicalizeContentLocale(policy.defaultLocale);

  if (!sourceLocale || !defaultLocale) {
    return null;
  }

  const supportedLocales = normalizeLocaleList(policy.supportedLocales);

  if (!supportedLocales) {
    return null;
  }

  const requiredLocales = normalizeLocaleList(policy.requiredLocales, EMPTY_LOCALE_LIST);

  if (!requiredLocales) {
    return null;
  }

  if (!supportedLocales.includes(sourceLocale) || !supportedLocales.includes(defaultLocale)) {
    return null;
  }

  if (requiredLocales.some((locale) => !supportedLocales.includes(locale))) {
    return null;
  }

  return {
    sourceLocale,
    defaultLocale,
    supportedLocales: Object.freeze([...supportedLocales]),
    requiredLocales: Object.freeze([...requiredLocales]),
  };
}

export function validateBoardLanguagePolicy(policy) {
  return isPlainObject(policy) && normalizeBoardLanguagePolicy(policy) !== null;
}

function normalizeLocaleList(value, fallback = null) {
  if (value == null) {
    return fallback;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const locales = [];
  const seenLocales = new Set();

  for (const entry of value) {
    const locale = canonicalizeContentLocale(entry);

    if (!locale || seenLocales.has(locale)) {
      return null;
    }

    seenLocales.add(locale);
    locales.push(locale);
  }

  return locales;
}

function normalizeLocaleInput(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input.trim().replaceAll('_', '-');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
