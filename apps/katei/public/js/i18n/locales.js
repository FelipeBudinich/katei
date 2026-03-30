export const SUPPORTED_UI_LOCALES = Object.freeze(['en', 'es-CL', 'ja']);
export const DEFAULT_UI_LOCALE = 'en';

const SUPPORTED_UI_LOCALE_SET = new Set(SUPPORTED_UI_LOCALES);
const UI_LOCALE_BY_LANGUAGE = buildUiLocaleByLanguageMap();
const UI_LOCALE_LABELS = Object.freeze({
  en: Object.freeze({
    en: 'English',
    'es-CL': 'Spanish (Chile)',
    ja: 'Japanese'
  }),
  'es-CL': Object.freeze({
    en: 'Inglés',
    'es-CL': 'Español (Chile)',
    ja: 'Japonés'
  }),
  ja: Object.freeze({
    en: '英語',
    'es-CL': 'スペイン語（チリ）',
    ja: '日本語'
  })
});

export function canonicalizeUiLocale(input) {
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

export function resolveSupportedUiLocale(input) {
  const canonicalLocale = canonicalizeUiLocale(input);

  if (!canonicalLocale) {
    return null;
  }

  if (SUPPORTED_UI_LOCALE_SET.has(canonicalLocale)) {
    return canonicalLocale;
  }

  return UI_LOCALE_BY_LANGUAGE.get(getLanguageSubtag(canonicalLocale)) ?? null;
}

export function getUiLocaleLabel(locale, uiLocale = DEFAULT_UI_LOCALE) {
  const resolvedLocale = resolveSupportedUiLocale(locale);
  const resolvedUiLocale = resolveSupportedUiLocale(uiLocale) ?? DEFAULT_UI_LOCALE;

  if (!resolvedLocale) {
    return String(locale ?? '');
  }

  return UI_LOCALE_LABELS[resolvedUiLocale]?.[resolvedLocale]
    ?? UI_LOCALE_LABELS[DEFAULT_UI_LOCALE]?.[resolvedLocale]
    ?? resolvedLocale;
}

export function parseAcceptLanguage(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) {
    return [];
  }

  return headerValue
    .split(',')
    .map((entry, index) => parseAcceptLanguageEntry(entry, index))
    .filter(Boolean)
    .sort(compareAcceptedLocaleEntries)
    .map(({ locale }) => locale);
}

function parseAcceptLanguageEntry(entry, index) {
  const [rawLocale, ...rawParameters] = entry.split(';');
  const locale = canonicalizeUiLocale(rawLocale);

  if (!locale) {
    return null;
  }

  const qValue = parseQValue(rawParameters);

  if (qValue == null || qValue === 0) {
    return null;
  }

  return {
    locale,
    q: qValue,
    index
  };
}

function parseQValue(rawParameters) {
  for (const rawParameter of rawParameters) {
    const normalizedParameter = rawParameter.trim();
    const match = normalizedParameter.match(/^q=([0-9]+(?:\.[0-9]+)?)$/i);

    if (!match) {
      continue;
    }

    const parsedValue = Number.parseFloat(match[1]);

    if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > 1) {
      return null;
    }

    return parsedValue;
  }

  return 1;
}

function compareAcceptedLocaleEntries(left, right) {
  return right.q - left.q || left.index - right.index;
}

function buildUiLocaleByLanguageMap() {
  const map = new Map();

  for (const locale of SUPPORTED_UI_LOCALES) {
    const languageSubtag = getLanguageSubtag(locale);

    if (!languageSubtag) {
      continue;
    }

    if (map.has(languageSubtag) && map.get(languageSubtag) !== locale) {
      map.set(languageSubtag, null);
      continue;
    }

    map.set(languageSubtag, locale);
  }

  return map;
}

function normalizeLocaleInput(input) {
  if (typeof input !== 'string') {
    return '';
  }

  return input.trim().replaceAll('_', '-');
}

function getLanguageSubtag(locale) {
  const [languageSubtag] = locale.split('-');
  return languageSubtag?.toLowerCase() ?? '';
}
