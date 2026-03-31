import { canonicalizeContentLocale, normalizeBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { getCardContentVariant } from '../domain/card_localization.js';
import { listCardLocaleStatuses } from '../domain/card_localization_requests.js';

export function createLocalizedCardViewState({ board, card, selectedLocale = null } = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const localeStatuses = card ? listCardLocaleStatuses(board, card) : [];
  const supportedLocales = getSupportedCardLocales(languagePolicy, localeStatuses);
  const resolvedSelectedLocale = resolveCardLocaleSelection({
    board,
    preferredLocale: selectedLocale,
    supportedLocales
  });
  const variant = card ? getCardContentVariant(card, resolvedSelectedLocale, board) : null;
  const localeStatusByLocale = new Map(localeStatuses.map((entry) => [entry.locale, entry]));
  const selectedStatus = resolvedSelectedLocale ? localeStatusByLocale.get(resolvedSelectedLocale) ?? null : null;

  return {
    supportedLocales,
    selectedLocale: resolvedSelectedLocale,
    renderedLocale: variant?.locale ?? null,
    variant,
    localeStatuses,
    presentCount: localeStatuses.filter((entry) => entry.hasContent).length,
    requestedCount: localeStatuses.filter((entry) => entry.isRequested).length,
    missingCount: localeStatuses.filter((entry) => !entry.hasContent && !entry.isRequested).length,
    isMissingSelectedLocale: Boolean(resolvedSelectedLocale && !selectedStatus?.hasContent),
    noLocalizedContent: variant == null
  };
}

export function resolveCardLocaleSelection({ board, preferredLocale = null, supportedLocales = null } = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const availableLocales = Array.isArray(supportedLocales)
    ? supportedLocales
    : getSupportedCardLocales(languagePolicy);
  const normalizedPreferredLocale = canonicalizeContentLocale(preferredLocale);

  if (normalizedPreferredLocale && (availableLocales.length === 0 || availableLocales.includes(normalizedPreferredLocale))) {
    return normalizedPreferredLocale;
  }

  return (
    languagePolicy?.defaultLocale ??
    languagePolicy?.sourceLocale ??
    availableLocales[0] ??
    normalizedPreferredLocale ??
    null
  );
}

function getSupportedCardLocales(languagePolicy, localeStatuses = []) {
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

  for (const entry of localeStatuses) {
    addLocale(entry.locale);
  }

  return locales;
}
