import {
  canonicalizeContentLocale,
  canonicalizeContentLocaleWithLegacyAliases,
  normalizeBoardLanguagePolicy
} from './board_language_policy.js';
import {
  clearCardLocaleRequest,
  getOpenLocalizationRequest,
  listCardLocaleStatuses
} from './card_localization_requests.js';
import { isHumanAuthoredVariant } from './localized_content_guard.js';

const CARD_CONTENT_REVIEW_ORIGIN_AI = 'ai';
const CARD_CONTENT_REVIEW_ORIGIN_HUMAN = 'human';
const CARD_CONTENT_REVIEW_STATUS_AI = 'ai';
const CARD_CONTENT_REVIEW_STATUS_NEEDS_HUMAN_VERIFICATION = 'needs-human-verification';
const CARD_CONTENT_REVIEW_STATUS_VERIFIED = 'verified';

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

export function createCardContentReview({
  origin,
  verificationRequestedBy = null,
  verificationRequestedAt = null,
  verifiedBy = null,
  verifiedAt = null
} = {}) {
  const requestedVerification = normalizeOptionalReviewEvent({
    actor: verificationRequestedBy,
    timestamp: verificationRequestedAt
  });
  const completedVerification = normalizeOptionalReviewEvent({
    actor: verifiedBy,
    timestamp: verifiedAt
  });

  return {
    origin: normalizeRequiredReviewOrigin(origin),
    verificationRequestedBy: requestedVerification?.actor ?? null,
    verificationRequestedAt: requestedVerification?.timestamp ?? null,
    verifiedBy: completedVerification?.actor ?? null,
    verifiedAt: completedVerification?.timestamp ?? null
  };
}

export function getCardContentReviewState(review) {
  const normalizedReview = normalizeCardContentReview(review, {
    fallbackOrigin: null
  });

  if (!normalizedReview) {
    return {
      origin: null,
      status: null,
      isAiOrigin: false,
      isVerificationRequested: false,
      isVerified: false
    };
  }

  if (normalizedReview.origin !== CARD_CONTENT_REVIEW_ORIGIN_AI) {
    return {
      origin: normalizedReview.origin,
      status: null,
      isAiOrigin: false,
      isVerificationRequested: false,
      isVerified: false
    };
  }

  if (normalizedReview.verifiedAt) {
    return {
      origin: normalizedReview.origin,
      status: CARD_CONTENT_REVIEW_STATUS_VERIFIED,
      isAiOrigin: true,
      isVerificationRequested: true,
      isVerified: true
    };
  }

  if (normalizedReview.verificationRequestedAt) {
    return {
      origin: normalizedReview.origin,
      status: CARD_CONTENT_REVIEW_STATUS_NEEDS_HUMAN_VERIFICATION,
      isAiOrigin: true,
      isVerificationRequested: true,
      isVerified: false
    };
  }

  return {
    origin: normalizedReview.origin,
    status: CARD_CONTENT_REVIEW_STATUS_AI,
    isAiOrigin: true,
    isVerificationRequested: false,
    isVerified: false
  };
}

export function requestCardContentHumanVerification(review, actor, timestamp) {
  const normalizedReview = normalizeCardContentReview(review, {
    fallbackOrigin: null
  });

  if (!normalizedReview || normalizedReview.origin !== CARD_CONTENT_REVIEW_ORIGIN_AI) {
    return normalizedReview;
  }

  if (getCardContentReviewState(normalizedReview).status !== CARD_CONTENT_REVIEW_STATUS_AI) {
    return normalizedReview;
  }

  const verificationRequest = createRequiredReviewEvent(
    actor,
    timestamp,
    'Card content review request timestamp is required.'
  );

  return createCardContentReview({
    origin: normalizedReview.origin,
    verificationRequestedBy: verificationRequest.actor,
    verificationRequestedAt: verificationRequest.timestamp,
    verifiedBy: normalizedReview.verifiedBy,
    verifiedAt: normalizedReview.verifiedAt
  });
}

export function verifyCardContentHumanVerification(review, actor, timestamp) {
  const normalizedReview = normalizeCardContentReview(review, {
    fallbackOrigin: null
  });

  if (!normalizedReview || normalizedReview.origin !== CARD_CONTENT_REVIEW_ORIGIN_AI) {
    return normalizedReview;
  }

  if (getCardContentReviewState(normalizedReview).status === CARD_CONTENT_REVIEW_STATUS_VERIFIED) {
    return normalizedReview;
  }

  const verificationEvent = createRequiredReviewEvent(
    actor,
    timestamp,
    'Card content verification timestamp is required.'
  );

  return createCardContentReview({
    origin: normalizedReview.origin,
    verificationRequestedBy: normalizedReview.verificationRequestedBy ?? verificationEvent.actor,
    verificationRequestedAt: normalizedReview.verificationRequestedAt ?? verificationEvent.timestamp,
    verifiedBy: verificationEvent.actor,
    verifiedAt: verificationEvent.timestamp
  });
}

export function normalizeCardContentReview(review, { provenance = null, fallbackOrigin = null } = {}) {
  const normalizedOrigin =
    normalizeOptionalReviewOrigin(review?.origin)
    ?? deriveCardContentReviewOriginFromProvenance(provenance, { fallbackOrigin });

  if (!normalizedOrigin) {
    return null;
  }

  return createCardContentReview({
    origin: normalizedOrigin,
    verificationRequestedBy: review?.verificationRequestedBy ?? null,
    verificationRequestedAt: review?.verificationRequestedAt ?? null,
    verifiedBy: review?.verifiedBy ?? null,
    verifiedAt: review?.verifiedAt ?? null
  });
}

export function deriveCardContentReviewOriginFromProvenance(
  provenance,
  { fallbackOrigin = CARD_CONTENT_REVIEW_ORIGIN_HUMAN } = {}
) {
  if (!isPlainObject(provenance)) {
    return fallbackOrigin;
  }

  if (provenance.includesHumanInput === false) {
    return CARD_CONTENT_REVIEW_ORIGIN_AI;
  }

  return CARD_CONTENT_REVIEW_ORIGIN_HUMAN;
}

export function resolveDefaultCardLocale({
  board,
  requestedLocale = null,
  uiLocale = null,
  candidateLocales = []
} = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const normalizedRequestedLocale = canonicalizeContentLocaleWithLegacyAliases(requestedLocale);
  const normalizedUiLocale = canonicalizeContentLocaleWithLegacyAliases(uiLocale);
  const hasExplicitRequestedLocale = normalizedRequestedLocale != null;
  const orderedCandidateLocales = [];
  const seenCandidateLocales = new Set();

  for (const candidateLocale of candidateLocales) {
    const normalizedCandidateLocale = canonicalizeContentLocaleWithLegacyAliases(candidateLocale);

    if (!normalizedCandidateLocale || seenCandidateLocales.has(normalizedCandidateLocale)) {
      continue;
    }

    seenCandidateLocales.add(normalizedCandidateLocale);
    orderedCandidateLocales.push(normalizedCandidateLocale);
  }

  const candidateLocaleSet = new Set(orderedCandidateLocales);
  const matchedRequestedLocale = findPreferredCandidateLocale(
    normalizedRequestedLocale,
    orderedCandidateLocales,
    candidateLocaleSet
  );
  const matchedUiLocale = findPreferredCandidateLocale(
    normalizedUiLocale,
    orderedCandidateLocales,
    candidateLocaleSet
  );

  if (matchedRequestedLocale) {
    return matchedRequestedLocale;
  }

  if (!hasExplicitRequestedLocale && matchedUiLocale) {
    return matchedUiLocale;
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
      isFallback: canonicalizeContentLocaleWithLegacyAliases(locale) !== resolvedLocale,
      source: 'localized'
    });
  }

  return null;
}

export function getStoredCardContentVariant(card, locale) {
  const normalizedLocale = canonicalizeContentLocaleWithLegacyAliases(locale);

  if (!normalizedLocale) {
    return null;
  }

  return getLocalizedContentMap(card).get(normalizedLocale) ?? null;
}

export function getBoardCardContentVariant(card, board, { requestedLocale = null, uiLocale = null } = {}) {
  return getCardContentVariant(card, requestedLocale, board, { uiLocale });
}

function findPreferredCandidateLocale(locale, orderedCandidateLocales, candidateLocaleSet) {
  if (!locale) {
    return null;
  }

  if (candidateLocaleSet.has(locale)) {
    return locale;
  }

  const preferredLanguage = getLanguageSubtag(locale);

  if (!preferredLanguage) {
    return null;
  }

  return orderedCandidateLocales.find((candidateLocale) => getLanguageSubtag(candidateLocale) === preferredLanguage) ?? null;
}

function getLanguageSubtag(locale) {
  const [languageSubtag] = String(locale).split('-');
  return languageSubtag?.toLowerCase() ?? '';
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

export function upsertCardContentVariant(card, locale, patch, provenance, { review = undefined } = {}) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error(`Invalid content locale: ${locale}`);
  }

  const nextPatch = normalizeVariantPatch(patch);
  const currentContentByLocale = getContentByLocaleRecord(card);
  const currentVariant = normalizeStoredVariant(currentContentByLocale[normalizedLocale]);
  const nextProvenance =
    provenance === undefined
      ? currentVariant.provenance ?? null
      : createCardContentProvenance(provenance);
  const nextReview =
    review === undefined
      ? resolveImplicitCardContentReview(currentVariant, nextProvenance, nextPatch)
      : normalizeCardContentReview(review, {
        provenance: nextProvenance,
        fallbackOrigin: null
      });

  return {
    ...(isPlainObject(card) ? card : {}),
    contentByLocale: {
      ...currentContentByLocale,
      [normalizedLocale]: {
        ...currentVariant,
        ...nextPatch,
        provenance: nextProvenance,
        review: nextReview
      }
    }
  };
}

export function discardCardContentVariant(card, locale) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error(`Invalid content locale: ${locale}`);
  }

  const currentContentByLocale = getContentByLocaleRecord(card);
  const localeKeysToRemove = Object.keys(currentContentByLocale).filter(
    (rawLocale) => canonicalizeContentLocaleWithLegacyAliases(rawLocale) === normalizedLocale
  );

  if (localeKeysToRemove.length < 1) {
    return isPlainObject(card) ? structuredClone(card) : {};
  }

  const nextContentByLocale = {
    ...currentContentByLocale
  };

  for (const rawLocale of localeKeysToRemove) {
    delete nextContentByLocale[rawLocale];
  }

  return {
    ...(isPlainObject(card) ? card : {}),
    contentByLocale: nextContentByLocale
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
    },
    {
      review: createCardContentReview({
        origin: CARD_CONTENT_REVIEW_ORIGIN_AI
      })
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
    const locale = canonicalizeContentLocaleWithLegacyAliases(rawLocale);

    if (!locale || !isPlainObject(rawVariant)) {
      continue;
    }

    const normalizedVariant = normalizeStoredVariant(rawVariant);
    const currentEntry = localizedContent.get(locale) ?? null;

    if (!currentEntry || shouldPreferLocaleEntry(rawLocale, currentEntry.rawLocale, locale)) {
      localizedContent.set(locale, {
        rawLocale,
        variant: normalizedVariant
      });
    }
  }

  return new Map(
    [...localizedContent.entries()].map(([locale, entry]) => [locale, entry.variant])
  );
}

function getContentByLocaleRecord(card) {
  return isPlainObject(card?.contentByLocale) ? card.contentByLocale : {};
}

function shouldPreferLocaleEntry(nextRawLocale, currentRawLocale, normalizedLocale) {
  if (!currentRawLocale) {
    return true;
  }

  return canonicalizeContentLocale(nextRawLocale) === normalizedLocale
    && canonicalizeContentLocale(currentRawLocale) !== normalizedLocale;
}

function materializeVariant(variant, locale, { isFallback, source }) {
  return {
    locale,
    title: variant.title,
    detailsMarkdown: variant.detailsMarkdown,
    provenance: cloneValue(variant.provenance),
    review: cloneValue(variant.review),
    isFallback,
    source
  };
}

function normalizeStoredVariant(variant) {
  const hasStoredVariant = isPlainObject(variant);
  const normalizedVariant = hasStoredVariant ? variant : {};
  const normalizedProvenance = Object.prototype.hasOwnProperty.call(normalizedVariant, 'provenance')
    ? normalizeStoredProvenance(normalizedVariant.provenance)
    : null;

  return {
    ...normalizedVariant,
    title: typeof normalizedVariant.title === 'string' ? normalizedVariant.title : '',
    detailsMarkdown:
      typeof normalizedVariant.detailsMarkdown === 'string' ? normalizedVariant.detailsMarkdown : '',
    provenance: normalizedProvenance,
    review: hasStoredVariant
      ? normalizeCardContentReview(normalizedVariant.review, {
        provenance: normalizedProvenance,
        fallbackOrigin: CARD_CONTENT_REVIEW_ORIGIN_HUMAN
      })
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

function resolveImplicitCardContentReview(currentVariant, provenance, patch) {
  const currentReview = currentVariant.review
    ?? normalizeCardContentReview(null, {
      provenance,
      fallbackOrigin: null
    });

  if (!didVariantContentChange(currentVariant, patch)) {
    return currentReview;
  }

  return clearCardContentReviewVerification(currentReview);
}

function didVariantContentChange(currentVariant, patch) {
  return (
    (Object.prototype.hasOwnProperty.call(patch, 'title') && patch.title !== currentVariant.title) ||
    (Object.prototype.hasOwnProperty.call(patch, 'detailsMarkdown') && patch.detailsMarkdown !== currentVariant.detailsMarkdown)
  );
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

function createRequiredReviewEvent(actor, timestamp, errorMessage) {
  return {
    actor: normalizeProvenanceActor(actor),
    timestamp: normalizeIsoTimestamp(timestamp, errorMessage)
  };
}

function clearCardContentReviewVerification(review) {
  const normalizedReview = normalizeCardContentReview(review, {
    fallbackOrigin: null
  });

  if (!normalizedReview || normalizedReview.origin !== CARD_CONTENT_REVIEW_ORIGIN_AI) {
    return normalizedReview;
  }

  return createCardContentReview({
    origin: normalizedReview.origin,
    verificationRequestedBy: normalizedReview.verificationRequestedBy,
    verificationRequestedAt: normalizedReview.verificationRequestedAt,
    verifiedBy: null,
    verifiedAt: null
  });
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
      isValidProvenance(variant.provenance) &&
      isValidReview(variant.review)
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

function isValidReview(review) {
  return review == null || (
    isPlainObject(review) &&
      isValidReviewOrigin(review.origin) &&
      isValidOptionalReviewEvent(review.verificationRequestedBy, review.verificationRequestedAt) &&
      isValidOptionalReviewEvent(review.verifiedBy, review.verifiedAt)
  );
}

function isValidOptionalReviewEvent(actor, timestamp) {
  if (actor == null && timestamp == null) {
    return true;
  }

  return Boolean(
    isValidProvenanceActor(actor) &&
      typeof timestamp === 'string' &&
      !Number.isNaN(new Date(timestamp).getTime())
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

function normalizeOptionalActor(actor) {
  if (!isPlainObject(actor)) {
    return null;
  }

  try {
    return normalizeProvenanceActor(actor);
  } catch (error) {
    return null;
  }
}

function normalizeIsoTimestamp(value, errorMessage) {
  const normalizedTimestamp = normalizeOptionalIsoTimestamp(value);

  if (!normalizedTimestamp) {
    throw new Error(errorMessage);
  }

  return normalizedTimestamp;
}

function normalizeOptionalIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
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

function normalizeRequiredReviewOrigin(value) {
  const normalizedOrigin = normalizeOptionalReviewOrigin(value);

  if (!normalizedOrigin) {
    throw new Error('Card content review origin is required.');
  }

  return normalizedOrigin;
}

function normalizeOptionalReviewOrigin(value) {
  const normalizedOrigin = normalizeOptionalLocalizedString(value).toLowerCase();

  return isValidReviewOrigin(normalizedOrigin) ? normalizedOrigin : null;
}

function normalizeOptionalReviewEvent({ actor = null, timestamp = null } = {}) {
  const normalizedActor = normalizeOptionalActor(actor);
  const normalizedTimestamp = normalizeOptionalIsoTimestamp(timestamp);

  if (!normalizedActor || !normalizedTimestamp) {
    return null;
  }

  return {
    actor: normalizedActor,
    timestamp: normalizedTimestamp
  };
}

function isValidReviewOrigin(value) {
  return value === CARD_CONTENT_REVIEW_ORIGIN_AI || value === CARD_CONTENT_REVIEW_ORIGIN_HUMAN;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
