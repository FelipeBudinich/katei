import { canonicalizeContentLocale, normalizeBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { getCardContentVariant } from '../domain/card_localization.js';
import { listCardLocaleStatuses } from '../domain/card_localization_requests.js';

export function createLocalizedCardViewState({
  board,
  card,
  selectedLocale = null,
  localeSelection = 'supported'
} = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const localeStatuses = card ? listCardLocaleStatuses(board, card) : [];
  const supportedLocales = getSupportedCardLocales(languagePolicy, localeStatuses);
  const availableLocales = getAvailableCardLocales(localeStatuses);
  const selectableLocales = localeSelection === 'available' ? availableLocales : supportedLocales;
  const resolvedSelectedLocale = resolveCardLocaleSelection({
    board,
    preferredLocale: selectedLocale,
    supportedLocales: selectableLocales
  });
  const variant = card ? getCardContentVariant(card, resolvedSelectedLocale, board) : null;
  const localeStatusByLocale = new Map(localeStatuses.map((entry) => [entry.locale, entry]));
  const selectedStatus = resolvedSelectedLocale ? localeStatusByLocale.get(resolvedSelectedLocale) ?? null : null;

  return {
    supportedLocales,
    availableLocales,
    selectedLocale: resolvedSelectedLocale,
    renderedLocale: variant?.locale ?? null,
    variant,
    localeStatuses,
    selectedStatus,
    presentCount: localeStatuses.filter((entry) => entry.hasContent).length,
    requestedCount: localeStatuses.filter((entry) => entry.isRequested).length,
    missingCount: localeStatuses.filter((entry) => !entry.hasContent && !entry.isRequested).length,
    isMissingSelectedLocale: Boolean(resolvedSelectedLocale && !selectedStatus?.hasContent),
    noLocalizedContent: variant == null
  };
}

export function createLocalizedCardEditorUiState({
  board,
  card,
  selectedLocale = null,
  mode = 'create',
  canEditLocalizedContent = false,
  currentActorRole = null
} = {}) {
  const localizedView = createLocalizedCardViewState({ board, card, selectedLocale });
  const isReadOnly = mode === 'view' || !canEditLocalizedContent;
  const selectedStatus = localizedView.selectedStatus;
  const hasCard = Boolean(card);
  const hasSelectedLocale = Boolean(localizedView.selectedLocale);
  const canRequestSelectedLocale =
    hasCard &&
    !isReadOnly &&
    hasSelectedLocale &&
    !selectedStatus?.hasContent &&
    !selectedStatus?.isRequested;
  const canClearSelectedLocaleRequest =
    hasCard &&
    !isReadOnly &&
    hasSelectedLocale &&
    Boolean(selectedStatus?.isRequested);

  return {
    ...localizedView,
    mode,
    currentActorRole,
    canEditLocalizedContent: Boolean(canEditLocalizedContent),
    isReadOnly,
    showSaveControls: !isReadOnly,
    showReadOnlyNotice: hasCard && isReadOnly,
    showRequestLocaleButton: canRequestSelectedLocale,
    showClearLocaleRequestButton: canClearSelectedLocaleRequest,
    localeEditSummaryState: resolveLocaleEditSummaryState({
      hasCard,
      isReadOnly,
      selectedStatus,
      selectedLocale: localizedView.selectedLocale
    })
  };
}

export function resolveCardLocaleSelection({ board, preferredLocale = null, supportedLocales = null } = {}) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const hasExplicitLocales = Array.isArray(supportedLocales);
  const availableLocales = hasExplicitLocales
    ? supportedLocales
    : getSupportedCardLocales(languagePolicy);
  const normalizedPreferredLocale = canonicalizeContentLocale(preferredLocale);

  if (normalizedPreferredLocale && (!hasExplicitLocales || availableLocales.includes(normalizedPreferredLocale))) {
    return normalizedPreferredLocale;
  }

  if (availableLocales.length > 0) {
    if (languagePolicy?.defaultLocale && availableLocales.includes(languagePolicy.defaultLocale)) {
      return languagePolicy.defaultLocale;
    }

    if (languagePolicy?.sourceLocale && availableLocales.includes(languagePolicy.sourceLocale)) {
      return languagePolicy.sourceLocale;
    }

    return availableLocales[0];
  }

  if (hasExplicitLocales) {
    return null;
  }

  return (
    languagePolicy?.defaultLocale ??
    languagePolicy?.sourceLocale ??
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

function getAvailableCardLocales(localeStatuses = []) {
  return localeStatuses
    .filter((entry) => entry.hasContent)
    .map((entry) => entry.locale);
}

function resolveLocaleEditSummaryState({ hasCard, isReadOnly, selectedStatus, selectedLocale }) {
  if (!hasCard || !selectedLocale) {
    return null;
  }

  if (isReadOnly) {
    return {
      key: 'cardEditor.viewingLocaleValue',
      locale: selectedLocale
    };
  }

  if (selectedStatus?.isRequested && !selectedStatus?.hasContent) {
    return {
      key: 'cardEditor.requestedLocaleValue',
      locale: selectedLocale
    };
  }

  if (!selectedStatus?.hasContent) {
    return {
      key: 'cardEditor.missingLocaleValue',
      locale: selectedLocale
    };
  }

  return {
    key: 'cardEditor.editingLocaleValue',
    locale: selectedLocale
  };
}
