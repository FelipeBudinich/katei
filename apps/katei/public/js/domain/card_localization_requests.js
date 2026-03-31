import {
  canonicalizeContentLocale,
  normalizeBoardLanguagePolicy
} from './board_language_policy.js';

export function listCardLocaleStatuses(board, card) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const requestMap = getOpenLocalizationRequestMap(card);
  const statuses = [];

  for (const locale of listRelevantLocales(languagePolicy, card, requestMap)) {
    const request = requestMap.get(locale) ?? null;
    const hasContent = hasCardLocaleContent(card, locale, languagePolicy);

    statuses.push({
      locale,
      status: hasContent ? 'present' : request ? 'requested' : 'missing',
      hasContent,
      isRequested: request != null,
      isSourceLocale: languagePolicy?.sourceLocale === locale,
      isDefaultLocale: languagePolicy?.defaultLocale === locale,
      isRequired: languagePolicy?.requiredLocales.includes(locale) ?? false,
      request: request ? structuredClone(request) : null
    });
  }

  return statuses;
}

export function getOpenLocalizationRequest(card, locale) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    return null;
  }

  const request = getOpenLocalizationRequestMap(card).get(normalizedLocale);
  return request ? structuredClone(request) : null;
}

export function getRequestedMissingLocales(board, card) {
  return listCardLocaleStatuses(board, card)
    .filter((entry) => entry.status === 'requested')
    .map((entry) => entry.locale);
}

export function requestCardLocale(card, locale, actor, now) {
  const normalizedLocale = canonicalizeRequiredLocale(locale);
  const normalizedActor = normalizeActor(actor);
  const requestedAt = normalizeIsoTimestamp(now, 'Localization request timestamp is required.');
  const { key, value } = getLocalizationRequestStore(card);
  const nextRequests = {
    ...value,
    [normalizedLocale]: {
      locale: normalizedLocale,
      status: 'open',
      requestedBy: normalizedActor,
      requestedAt
    }
  };

  return {
    ...(isPlainObject(card) ? structuredClone(card) : {}),
    [key]: nextRequests
  };
}

export function clearCardLocaleRequest(card, locale) {
  const normalizedLocale = canonicalizeRequiredLocale(locale);
  const { key, value } = getLocalizationRequestStore(card);

  if (!Object.prototype.hasOwnProperty.call(value, normalizedLocale)) {
    return isPlainObject(card) ? structuredClone(card) : {};
  }

  const nextCard = isPlainObject(card) ? structuredClone(card) : {};
  const nextRequests = {
    ...value
  };

  delete nextRequests[normalizedLocale];

  if (Object.keys(nextRequests).length > 0) {
    nextCard[key] = nextRequests;
  } else {
    delete nextCard[key];
  }

  return nextCard;
}

function listRelevantLocales(languagePolicy, card, requestMap) {
  const locales = [];
  const seenLocales = new Set();

  function addLocale(locale) {
    if (!locale || seenLocales.has(locale)) {
      return;
    }

    seenLocales.add(locale);
    locales.push(locale);
  }

  for (const locale of languagePolicy?.supportedLocales ?? []) {
    addLocale(locale);
  }

  for (const locale of listContentLocales(card)) {
    addLocale(locale);
  }

  for (const locale of [...requestMap.keys()].sort((left, right) => left.localeCompare(right))) {
    addLocale(locale);
  }

  return locales;
}

function listContentLocales(card) {
  const locales = [];
  const seenLocales = new Set();

  for (const [rawLocale, rawVariant] of Object.entries(getContentByLocaleRecord(card))) {
    const locale = canonicalizeContentLocale(rawLocale);

    if (!locale || seenLocales.has(locale) || !isPlainObject(rawVariant)) {
      continue;
    }

    seenLocales.add(locale);
    locales.push(locale);
  }

  locales.sort((left, right) => left.localeCompare(right));

  return locales;
}

function hasCardLocaleContent(card, locale, languagePolicy) {
  if (hasLocalizedContentVariant(card, locale)) {
    return true;
  }

  return languagePolicy?.sourceLocale === locale && hasLegacyCardContent(card);
}

function hasLocalizedContentVariant(card, locale) {
  for (const [rawLocale, rawVariant] of Object.entries(getContentByLocaleRecord(card))) {
    if (canonicalizeContentLocale(rawLocale) === locale && isPlainObject(rawVariant)) {
      return true;
    }
  }

  return false;
}

function getOpenLocalizationRequestMap(card) {
  const requests = new Map();

  for (const [rawLocale, rawRequest] of Object.entries(getLocalizationRequestStore(card).value)) {
    const locale = canonicalizeContentLocale(rawLocale);
    const normalizedRequest = locale ? normalizeLocalizationRequest(locale, rawRequest) : null;

    if (normalizedRequest) {
      requests.set(locale, normalizedRequest);
    }
  }

  return requests;
}

function normalizeLocalizationRequest(locale, request) {
  if (!isPlainObject(request)) {
    return null;
  }

  const requestLocale = canonicalizeContentLocale(request.locale ?? locale);
  const status = normalizeOptionalString(request.status).toLowerCase();
  const requestedBy = readActor(request.requestedBy ?? request.actor ?? null);
  const requestedAt = normalizeOptionalIsoTimestamp(request.requestedAt ?? request.timestamp ?? null);

  if (!requestLocale || requestLocale !== locale || !requestedBy || !requestedAt) {
    return null;
  }

  if (status && status !== 'open') {
    return null;
  }

  return {
    locale,
    status: 'open',
    requestedBy,
    requestedAt
  };
}

function getLocalizationRequestStore(card) {
  if (isPlainObject(card?.localeRequests)) {
    return {
      key: 'localeRequests',
      value: structuredClone(card.localeRequests)
    };
  }

  if (isPlainObject(card?.localizationRequests)) {
    return {
      key: 'localizationRequests',
      value: structuredClone(card.localizationRequests)
    };
  }

  if (card?.localeRequests != null) {
    return {
      key: 'localeRequests',
      value: {}
    };
  }

  if (card?.localizationRequests != null) {
    return {
      key: 'localizationRequests',
      value: {}
    };
  }

  return {
    key: 'localeRequests',
    value: {}
  };
}

function getContentByLocaleRecord(card) {
  return isPlainObject(card?.contentByLocale) ? card.contentByLocale : {};
}

function hasLegacyCardContent(card) {
  const title = normalizeOptionalString(card?.title);
  const detailsMarkdown = normalizeOptionalString(card?.detailsMarkdown);
  return title.length > 0 || detailsMarkdown.length > 0;
}

function canonicalizeRequiredLocale(locale) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error(`Invalid content locale: ${locale}`);
  }

  return normalizedLocale;
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) {
    throw new Error('Localization request actor is required.');
  }

  const type = normalizeOptionalString(actor.type).toLowerCase();
  const id = normalizeOptionalString(actor.id);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    throw new Error('Localization request actor must include a supported type and id.');
  }

  return { type, id };
}

function readActor(actor) {
  if (!isPlainObject(actor)) {
    return null;
  }

  const type = normalizeOptionalString(actor.type).toLowerCase();
  const id = normalizeOptionalString(actor.id);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    return null;
  }

  return { type, id };
}

function normalizeIsoTimestamp(value, errorMessage) {
  const timestamp = normalizeOptionalIsoTimestamp(value);

  if (!timestamp) {
    throw new Error(errorMessage);
  }

  return timestamp;
}

function normalizeOptionalIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
