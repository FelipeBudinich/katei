const EMPTY_LOCALE_LIST = Object.freeze([]);

export const DEFAULT_BOARD_LANGUAGE_POLICY = Object.freeze({
  defaultLocale: null,
  requiredLocales: EMPTY_LOCALE_LIST,
  allowedLocales: null
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
  if (policy == null) {
    return DEFAULT_BOARD_LANGUAGE_POLICY;
  }

  if (!isPlainObject(policy)) {
    return null;
  }

  const defaultLocale =
    policy.defaultLocale == null ? null : canonicalizeContentLocale(policy.defaultLocale);

  if (policy.defaultLocale != null && !defaultLocale) {
    return null;
  }

  const requiredLocales = normalizeLocaleList(policy.requiredLocales, EMPTY_LOCALE_LIST);

  if (!requiredLocales) {
    return null;
  }

  const allowedLocales =
    policy.allowedLocales == null ? null : normalizeLocaleList(policy.allowedLocales);

  if (policy.allowedLocales != null && !allowedLocales) {
    return null;
  }

  if (defaultLocale && allowedLocales && !allowedLocales.includes(defaultLocale)) {
    return null;
  }

  if (allowedLocales && requiredLocales.some((locale) => !allowedLocales.includes(locale))) {
    return null;
  }

  return {
    defaultLocale,
    requiredLocales: Object.freeze([...requiredLocales]),
    allowedLocales: allowedLocales ? Object.freeze([...allowedLocales]) : null
  };
}

export function validateBoardLanguagePolicy(policy) {
  return normalizeBoardLanguagePolicy(policy) !== null;
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
