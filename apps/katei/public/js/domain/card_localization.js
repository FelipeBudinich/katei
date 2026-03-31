import {
  canonicalizeContentLocale,
  normalizeBoardLanguagePolicy
} from './board_language_policy.js';

export function getCardContentVariant(card, locale, board) {
  const requestedLocale = canonicalizeContentLocale(locale);
  const localizedContent = getLocalizedContentMap(card);

  if (requestedLocale && localizedContent.has(requestedLocale)) {
    return materializeVariant(localizedContent.get(requestedLocale), requestedLocale, {
      isFallback: false,
      source: 'localized'
    });
  }

  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy);
  const defaultLocale = languagePolicy?.defaultLocale ?? null;

  if (defaultLocale && localizedContent.has(defaultLocale)) {
    return materializeVariant(localizedContent.get(defaultLocale), defaultLocale, {
      isFallback: requestedLocale != null && requestedLocale !== defaultLocale,
      source: 'localized'
    });
  }

  if (!requestedLocale && localizedContent.size > 0) {
    const [firstLocale] = [...localizedContent.keys()].sort((left, right) => left.localeCompare(right));

    return materializeVariant(localizedContent.get(firstLocale), firstLocale, {
      isFallback: false,
      source: 'localized'
    });
  }

  if (!hasLegacyCardContent(card)) {
    return null;
  }

  return {
    locale: requestedLocale ?? defaultLocale ?? null,
    title: typeof card?.title === 'string' ? card.title : '',
    detailsMarkdown: typeof card?.detailsMarkdown === 'string' ? card.detailsMarkdown : '',
    provenance: null,
    isFallback: true,
    source: 'legacy'
  };
}

export function listCardLocales(card) {
  return [...getLocalizedContentMap(card).keys()].sort((left, right) => left.localeCompare(right));
}

export function getMissingRequiredLocales(board, card) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy);

  if (!languagePolicy) {
    return [];
  }

  const presentLocales = new Set(listCardLocales(card));

  // Legacy cards still store their base content outside localized variants.
  if (languagePolicy.defaultLocale && hasLegacyCardContent(card)) {
    presentLocales.add(languagePolicy.defaultLocale);
  }

  return languagePolicy.requiredLocales.filter((locale) => !presentLocales.has(locale));
}

export function upsertCardContentVariant(card, locale, patch, provenance) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error(`Invalid content locale: ${locale}`);
  }

  const nextPatch = normalizeVariantPatch(patch);
  const currentContentByLocale = getContentByLocaleRecord(card);
  const currentVariant = normalizeStoredVariant(currentContentByLocale[normalizedLocale]);

  return {
    ...(isPlainObject(card) ? card : {}),
    contentByLocale: {
      ...currentContentByLocale,
      [normalizedLocale]: {
        ...currentVariant,
        ...nextPatch,
        provenance: provenance === undefined ? currentVariant.provenance ?? null : cloneValue(provenance)
      }
    }
  };
}

function getLocalizedContentMap(card) {
  const contentByLocale = getContentByLocaleRecord(card);
  const localizedContent = new Map();

  for (const [rawLocale, rawVariant] of Object.entries(contentByLocale)) {
    const locale = canonicalizeContentLocale(rawLocale);

    if (!locale || !isPlainObject(rawVariant)) {
      continue;
    }

    localizedContent.set(locale, normalizeStoredVariant(rawVariant));
  }

  return localizedContent;
}

function getContentByLocaleRecord(card) {
  return isPlainObject(card?.contentByLocale) ? card.contentByLocale : {};
}

function materializeVariant(variant, locale, { isFallback, source }) {
  return {
    locale,
    title: variant.title,
    detailsMarkdown: variant.detailsMarkdown,
    provenance: cloneValue(variant.provenance),
    isFallback,
    source
  };
}

function normalizeStoredVariant(variant) {
  const normalizedVariant = isPlainObject(variant) ? variant : {};

  return {
    ...normalizedVariant,
    title: typeof normalizedVariant.title === 'string' ? normalizedVariant.title : '',
    detailsMarkdown:
      typeof normalizedVariant.detailsMarkdown === 'string' ? normalizedVariant.detailsMarkdown : '',
    provenance: Object.prototype.hasOwnProperty.call(normalizedVariant, 'provenance')
      ? cloneValue(normalizedVariant.provenance)
      : null
  };
}

function normalizeVariantPatch(patch) {
  const normalizedPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'title')) {
    normalizedPatch.title = String(patch.title ?? '');
  }

  if (Object.prototype.hasOwnProperty.call(patch ?? {}, 'detailsMarkdown')) {
    normalizedPatch.detailsMarkdown = String(patch.detailsMarkdown ?? '');
  }

  return normalizedPatch;
}

function hasLegacyCardContent(card) {
  const title = typeof card?.title === 'string' ? card.title.trim() : '';
  const detailsMarkdown = typeof card?.detailsMarkdown === 'string' ? card.detailsMarkdown.trim() : '';

  return title.length > 0 || detailsMarkdown.length > 0;
}

function cloneValue(value) {
  return value == null ? value : structuredClone(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
