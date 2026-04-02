import {
  canonicalizeContentLocale,
  normalizeBoardLanguagePolicy
} from './board_language_policy.js';
import {
  clearCardLocaleRequest,
  getOpenLocalizationRequest,
  listCardLocaleStatuses
} from './card_localization_requests.js';
import { isHumanAuthoredVariant } from './localized_content_guard.js';

export class CardLocalizationGenerationConflictError extends Error {
  constructor(message, { code = 'LOCALIZATION_ALREADY_PRESENT', locale = null, status = 409 } = {}) {
    super(message);
    this.name = 'CardLocalizationGenerationConflictError';
    this.code = code;
    this.locale = locale;
    this.status = status;
  }
}

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

export function resolveDefaultCardLocale({
  board,
  requestedLocale = null,
  uiLocale = null,
  candidateLocales = []
} = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const normalizedRequestedLocale = canonicalizeContentLocale(requestedLocale);
  const normalizedUiLocale = canonicalizeContentLocale(uiLocale);
  const orderedCandidateLocales = [];
  const seenCandidateLocales = new Set();

  for (const candidateLocale of candidateLocales) {
    const normalizedCandidateLocale = canonicalizeContentLocale(candidateLocale);

    if (!normalizedCandidateLocale || seenCandidateLocales.has(normalizedCandidateLocale)) {
      continue;
    }

    seenCandidateLocales.add(normalizedCandidateLocale);
    orderedCandidateLocales.push(normalizedCandidateLocale);
  }

  const candidateLocaleSet = new Set(orderedCandidateLocales);

  if (normalizedRequestedLocale && candidateLocaleSet.has(normalizedRequestedLocale)) {
    return normalizedRequestedLocale;
  }

  if (normalizedUiLocale && candidateLocaleSet.has(normalizedUiLocale)) {
    return normalizedUiLocale;
  }

  if (languagePolicy?.defaultLocale && candidateLocaleSet.has(languagePolicy.defaultLocale)) {
    return languagePolicy.defaultLocale;
  }

  if (languagePolicy?.sourceLocale && candidateLocaleSet.has(languagePolicy.sourceLocale)) {
    return languagePolicy.sourceLocale;
  }

  return orderedCandidateLocales[0] ?? null;
}

export function getCardContentVariant(card, locale, board, { uiLocale = null } = {}) {
  const localizedContent = getLocalizedContentMap(card);
  const candidateLocales = [...localizedContent.keys()].sort((left, right) => left.localeCompare(right));
  const resolvedLocale = resolveDefaultCardLocale({
    board,
    requestedLocale: locale,
    uiLocale,
    candidateLocales
  });

  if (resolvedLocale && localizedContent.has(resolvedLocale)) {
    return materializeVariant(localizedContent.get(resolvedLocale), resolvedLocale, {
      isFallback: canonicalizeContentLocale(locale) !== resolvedLocale,
      source: 'localized'
    });
  }

  return null;
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

export function getBoardCardContentVariant(card, board, { requestedLocale = null, uiLocale = null } = {}) {
  return getCardContentVariant(card, requestedLocale, board, { uiLocale });
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

export function applyGeneratedCardLocalization(card, locale, patch, { actor, timestamp } = {}) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error(`Invalid content locale: ${locale}`);
  }

  const existingVariant = getStoredCardContentVariant(card, normalizedLocale);

  if (hasMeaningfulVariantContent(existingVariant)) {
    if (isHumanAuthoredVariant(existingVariant)) {
      throw new CardLocalizationGenerationConflictError(
        'Human-authored localized content already exists for this locale.',
        {
          code: 'LOCALIZATION_HUMAN_AUTHORED_CONFLICT',
          locale: normalizedLocale
        }
      );
    }

    throw new CardLocalizationGenerationConflictError(
      'Localized content already exists for this locale.',
      {
        code: 'LOCALIZATION_ALREADY_PRESENT',
        locale: normalizedLocale
      }
    );
  }

  let nextCard = upsertCardContentVariant(
    card,
    normalizedLocale,
    {
      title: normalizeRequiredLocalizedTitle(patch?.title),
      detailsMarkdown: normalizeOptionalLocalizedString(patch?.detailsMarkdown)
    },
    {
      actor,
      timestamp,
      includesHumanInput: false
    }
  );

  if (getOpenLocalizationRequest(card, normalizedLocale)) {
    nextCard = clearCardLocaleRequest(nextCard, normalizedLocale);
  }

  return nextCard;
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

function normalizeRequiredLocalizedTitle(value) {
  const normalizedValue = normalizeOptionalLocalizedString(value);

  if (!normalizedValue) {
    throw new Error('Generated localized card title is required.');
  }

  return normalizedValue;
}

function normalizeOptionalLocalizedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneValue(value) {
  return value == null ? value : structuredClone(value);
}

function hasMeaningfulVariantContent(variant) {
  return Boolean(
    normalizeOptionalLocalizedString(variant?.title) || normalizeOptionalLocalizedString(variant?.detailsMarkdown)
  );
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
