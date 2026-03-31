import {
  canonicalizeContentLocale,
  normalizeBoardLanguagePolicy
} from './board_language_policy.js';
import { listCardLocaleStatuses } from './card_localization_requests.js';

export function createCardContentProvenance({
  actor,
  timestamp,
  includesHumanInput = true
} = {}) {
  return {
    actor: normalizeProvenanceActor(actor),
    timestamp: normalizeIsoTimestamp(timestamp, 'Card content provenance timestamp is required.'),
    includesHumanInput: Boolean(includesHumanInput)
  };
}

export function getCardContentVariant(card, locale, board) {
  const requestedLocale = canonicalizeContentLocale(locale);
  const localizedContent = getLocalizedContentMap(card);
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const preferredLocales = [];
  const primaryPreferredLocale = requestedLocale ?? languagePolicy?.defaultLocale ?? languagePolicy?.sourceLocale ?? null;

  if (requestedLocale) {
    preferredLocales.push(requestedLocale);
  }

  if (languagePolicy?.defaultLocale && !preferredLocales.includes(languagePolicy.defaultLocale)) {
    preferredLocales.push(languagePolicy.defaultLocale);
  }

  if (languagePolicy?.sourceLocale && !preferredLocales.includes(languagePolicy.sourceLocale)) {
    preferredLocales.push(languagePolicy.sourceLocale);
  }

  for (const preferredLocale of preferredLocales) {
    if (!localizedContent.has(preferredLocale)) {
      continue;
    }

    return materializeVariant(localizedContent.get(preferredLocale), preferredLocale, {
      isFallback: primaryPreferredLocale != null && primaryPreferredLocale !== preferredLocale,
      source: 'localized'
    });
  }

  if (localizedContent.size > 0) {
    const [firstLocale] = [...localizedContent.keys()].sort((left, right) => left.localeCompare(right));

    return materializeVariant(localizedContent.get(firstLocale), firstLocale, {
      isFallback: primaryPreferredLocale != null && primaryPreferredLocale !== firstLocale,
      source: 'localized'
    });
  }

  if (!hasLegacyCardContent(card)) {
    return null;
  }

  return {
    locale: requestedLocale ?? languagePolicy?.defaultLocale ?? languagePolicy?.sourceLocale ?? null,
    title: typeof card?.title === 'string' ? card.title : '',
    detailsMarkdown: typeof card?.detailsMarkdown === 'string' ? card.detailsMarkdown : '',
    provenance: null,
    isFallback: true,
    source: 'legacy'
  };
}

export function getStoredCardContentVariant(card, locale) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    return null;
  }

  const storedVariant = getContentByLocaleRecord(card)[normalizedLocale];

  if (!isPlainObject(storedVariant)) {
    return null;
  }

  return normalizeStoredVariant(storedVariant);
}

export function getBoardCardContentVariant(card, board) {
  return getCardContentVariant(card, resolveBoardCardContentLocale(board), board);
}

export function listCardLocales(card) {
  return [...getLocalizedContentMap(card).keys()].sort((left, right) => left.localeCompare(right));
}

export function getMissingRequiredLocales(board, card) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);

  if (!languagePolicy) {
    return [];
  }

  const localeStatuses = new Map(
    listCardLocaleStatuses(board, card).map((entry) => [entry.locale, entry])
  );

  return languagePolicy.requiredLocales.filter((locale) => !localeStatuses.get(locale)?.hasContent);
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
        provenance:
          provenance === undefined
            ? currentVariant.provenance ?? null
            : createCardContentProvenance(provenance)
      }
    }
  };
}

export function validateCardContentByLocale(card, board) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy);

  if (!languagePolicy) {
    return false;
  }

  const contentByLocale = getContentByLocaleRecord(card);
  const localeEntries = Object.entries(contentByLocale);

  if (localeEntries.length < 1) {
    return false;
  }

  const seenLocales = new Set();

  for (const [rawLocale, rawVariant] of localeEntries) {
    const locale = canonicalizeContentLocale(rawLocale);

    if (!locale || locale !== rawLocale || seenLocales.has(locale) || !isValidLocalizedContentVariant(rawVariant)) {
      return false;
    }

    seenLocales.add(locale);
  }

  return seenLocales.has(languagePolicy.sourceLocale);
}

export function projectWorkspaceWithLegacyCardContent(workspace) {
  if (!isPlainObject(workspace) || !isPlainObject(workspace.boards)) {
    return workspace;
  }

  const projectedWorkspace = structuredClone(workspace);

  for (const board of Object.values(projectedWorkspace.boards)) {
    if (!isPlainObject(board) || !isPlainObject(board.cards)) {
      continue;
    }

    for (const card of Object.values(board.cards)) {
      if (!isPlainObject(card)) {
        continue;
      }

      const projectedVariant = getBoardCardContentVariant(card, board);

      if (!projectedVariant) {
        delete card.title;
        delete card.detailsMarkdown;
        continue;
      }

      card.title = projectedVariant.title;
      card.detailsMarkdown = projectedVariant.detailsMarkdown;
    }
  }

  return projectedWorkspace;
}

export function stripLegacyCardContentAliasesFromWorkspace(workspace) {
  if (!isPlainObject(workspace) || !isPlainObject(workspace.boards)) {
    return workspace;
  }

  const normalizedWorkspace = structuredClone(workspace);

  for (const board of Object.values(normalizedWorkspace.boards)) {
    if (!isPlainObject(board) || !isPlainObject(board.cards)) {
      continue;
    }

    for (const card of Object.values(board.cards)) {
      if (!isPlainObject(card)) {
        continue;
      }

      delete card.title;
      delete card.detailsMarkdown;
    }
  }

  return normalizedWorkspace;
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
      ? normalizeStoredProvenance(normalizedVariant.provenance)
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

function isValidLocalizedContentVariant(variant) {
  return Boolean(
    isPlainObject(variant) &&
      typeof variant.title === 'string' &&
      variant.title.trim() &&
      typeof variant.detailsMarkdown === 'string' &&
      isValidProvenance(variant.provenance)
  );
}

function isValidProvenance(provenance) {
  return Boolean(
    isPlainObject(provenance) &&
      isValidProvenanceActor(provenance.actor) &&
      typeof provenance.timestamp === 'string' &&
      !Number.isNaN(new Date(provenance.timestamp).getTime()) &&
      typeof provenance.includesHumanInput === 'boolean'
  );
}

function isValidProvenanceActor(actor) {
  return Boolean(
    isPlainObject(actor) &&
      typeof actor.type === 'string' &&
      ['human', 'agent', 'system'].includes(actor.type) &&
      typeof actor.id === 'string' &&
      actor.id.trim()
  );
}

function normalizeStoredProvenance(provenance) {
  if (!isPlainObject(provenance)) {
    return null;
  }

  try {
    return createCardContentProvenance(provenance);
  } catch (error) {
    return null;
  }
}

function normalizeProvenanceActor(actor) {
  if (!isPlainObject(actor)) {
    throw new Error('Card content provenance actor is required.');
  }

  const type = normalizeRequiredString(actor.type, 'Card content provenance actor.type is required.');
  const id = normalizeRequiredString(actor.id, 'Card content provenance actor.id is required.');

  if (!['human', 'agent', 'system'].includes(type)) {
    throw new Error(`Unsupported card content provenance actor.type: ${type}`);
  }

  return { type, id };
}

function normalizeIsoTimestamp(value, errorMessage) {
  const normalizedValue = normalizeRequiredString(value, errorMessage);
  const timestamp = new Date(normalizedValue);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('Card content provenance timestamp must be an ISO timestamp.');
  }

  return timestamp.toISOString();
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function resolveBoardCardContentLocale(board) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  return languagePolicy?.defaultLocale ?? languagePolicy?.sourceLocale ?? null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
