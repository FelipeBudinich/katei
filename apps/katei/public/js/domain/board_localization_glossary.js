import { canonicalizeContentLocale } from './board_language_policy.js';

export function createDefaultBoardLocalizationGlossary() {
  return [];
}

export function normalizeBoardLocalizationGlossary(value, { supportedLocales = null } = {}) {
  if (value == null) {
    return createDefaultBoardLocalizationGlossary();
  }

  if (!Array.isArray(value)) {
    throw new Error('Board localization glossary is invalid.');
  }

  const normalizedEntries = [];
  const seenSourceTerms = new Set();
  const supportedLocaleSet = createSupportedLocaleSet(supportedLocales);

  for (const rawEntry of value) {
    if (!isPlainObject(rawEntry)) {
      throw new Error('Board localization glossary is invalid.');
    }

    const source = normalizeRequiredText(
      rawEntry.source,
      'Localization glossary source terms are required.'
    );
    const sourceKey = source.toLocaleLowerCase();

    if (seenSourceTerms.has(sourceKey)) {
      throw new Error('Localization glossary source terms must be unique.');
    }

    seenSourceTerms.add(sourceKey);
    normalizedEntries.push({
      source,
      translations: normalizeGlossaryTranslations(rawEntry.translations, {
        supportedLocaleSet
      })
    });
  }

  return normalizedEntries;
}

export function validateBoardLocalizationGlossary(value, { supportedLocales = null } = {}) {
  try {
    normalizeBoardLocalizationGlossary(value, {
      supportedLocales
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeGlossaryTranslations(value, { supportedLocaleSet = null } = {}) {
  if (!isPlainObject(value)) {
    throw new Error('Localization glossary translations are required.');
  }

  const normalizedTranslations = {};
  const seenLocales = new Set();

  for (const [rawLocale, rawTranslation] of Object.entries(value)) {
    const locale = canonicalizeContentLocale(rawLocale);

    if (!locale || seenLocales.has(locale) || (supportedLocaleSet && !supportedLocaleSet.has(locale))) {
      throw new Error('Localization glossary translations must use supported locale ids.');
    }

    normalizedTranslations[locale] = normalizeRequiredText(
      rawTranslation,
      'Localization glossary translations are required.'
    );
    seenLocales.add(locale);
  }

  if (Object.keys(normalizedTranslations).length < 1) {
    throw new Error('Localization glossary translations are required.');
  }

  return normalizedTranslations;
}

function createSupportedLocaleSet(supportedLocales) {
  if (!Array.isArray(supportedLocales)) {
    return null;
  }

  return new Set(
    supportedLocales
      .map((locale) => canonicalizeContentLocale(locale))
      .filter(Boolean)
  );
}

function normalizeRequiredText(value, errorMessage) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
