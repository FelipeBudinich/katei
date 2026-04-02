import { normalizeBoardAiLocalization } from '../../../../../apps/katei/public/js/domain/board_ai_localization.js';
import { canonicalizeContentLocale, normalizeBoardLanguagePolicy } from '../../../../../apps/katei/public/js/domain/board_language_policy.js';
import { getStoredCardContentVariant } from '../../../../../apps/katei/public/js/domain/card_localization.js';

export function findBoardInWorkspace(workspace, boardTitle) {
  const normalizedBoardTitle = normalizeOptionalString(boardTitle);

  if (!normalizedBoardTitle || !Array.isArray(workspace?.boardOrder)) {
    return null;
  }

  for (const boardId of workspace.boardOrder) {
    const board = workspace?.boards?.[boardId];

    if (normalizeOptionalString(board?.title) === normalizedBoardTitle) {
      return {
        boardId,
        board
      };
    }
  }

  return null;
}

export function summarizeBoardLocalizationState(board) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const aiLocalization = normalizeBoardAiLocalization(board?.aiLocalization ?? null);

  return {
    boardId: normalizeOptionalString(board?.id) || null,
    title: normalizeOptionalString(board?.title) || null,
    sourceLocale: languagePolicy?.sourceLocale ?? null,
    defaultLocale: languagePolicy?.defaultLocale ?? null,
    supportedLocales: Array.isArray(languagePolicy?.supportedLocales) ? [...languagePolicy.supportedLocales] : [],
    requiredLocales: Array.isArray(languagePolicy?.requiredLocales) ? [...languagePolicy.requiredLocales] : [],
    hasApiKey: aiLocalization.hasApiKey === true,
    apiKeyLast4: aiLocalization.hasApiKey ? aiLocalization.apiKeyLast4 ?? null : null,
    cardCount: listBoardCardsInStageOrder(board).length
  };
}

export function selectLocalizationCandidate(
  board,
  {
    cardId = null,
    cardTitle = null,
    targetLocale = null
  } = {}
) {
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
  const sourceLocale = languagePolicy?.sourceLocale ?? null;
  const requestedCardId = normalizeOptionalString(cardId);
  const requestedCardTitle = normalizeOptionalString(cardTitle);
  const requestedTargetLocale = canonicalizeContentLocale(targetLocale);

  if (!sourceLocale) {
    return {
      candidate: null,
      reason: 'missing-source-locale'
    };
  }

  const targetLocales = requestedTargetLocale
    ? [requestedTargetLocale]
    : (languagePolicy?.supportedLocales ?? []).filter((locale) => locale !== sourceLocale);

  if (targetLocales.length === 0) {
    return {
      candidate: null,
      reason: 'missing-target-locale'
    };
  }

  const orderedCards = listBoardCardsInStageOrder(board);
  const matchingCards = orderedCards.filter((card) => {
    if (requestedCardId && normalizeOptionalString(card?.id) !== requestedCardId) {
      return false;
    }

    if (requestedCardTitle && readCardDisplayTitle(card, sourceLocale) !== requestedCardTitle) {
      return false;
    }

    return true;
  });

  if (matchingCards.length === 0) {
    return {
      candidate: null,
      reason: requestedCardId || requestedCardTitle ? 'card-not-found' : 'missing-card'
    };
  }

  let sawSourceLocaleMissing = false;
  let sawTargetAlreadyPresent = false;

  for (const card of matchingCards) {
    const sourceVariant = getStoredCardContentVariant(card, sourceLocale);

    if (!hasMeaningfulVariantContent(sourceVariant)) {
      sawSourceLocaleMissing = true;
      continue;
    }

    for (const locale of targetLocales) {
      const targetVariant = getStoredCardContentVariant(card, locale);

      if (hasMeaningfulVariantContent(targetVariant)) {
        sawTargetAlreadyPresent = true;
        continue;
      }

      return {
        candidate: {
          cardId: normalizeOptionalString(card?.id),
          cardTitle: readCardDisplayTitle(card, sourceLocale),
          sourceLocale,
          targetLocale: locale,
          sourceVariant: cloneVariant(sourceVariant),
          targetVariant: cloneVariant(targetVariant)
        },
        reason: null
      };
    }
  }

  return {
    candidate: null,
    reason: sawTargetAlreadyPresent
      ? 'target-locale-already-present'
      : (sawSourceLocaleMissing ? 'source-locale-missing' : 'missing-card')
  };
}

export function listBoardCardsInStageOrder(board) {
  const orderedCards = [];
  const seenCardIds = new Set();

  for (const stageId of Array.isArray(board?.stageOrder) ? board.stageOrder : []) {
    const stage = board?.stages?.[stageId];

    for (const cardId of Array.isArray(stage?.cardIds) ? stage.cardIds : []) {
      if (seenCardIds.has(cardId)) {
        continue;
      }

      const card = board?.cards?.[cardId];

      if (!card || typeof card !== 'object') {
        continue;
      }

      seenCardIds.add(cardId);
      orderedCards.push(card);
    }
  }

  for (const [cardId, card] of Object.entries(board?.cards ?? {})) {
    if (!seenCardIds.has(cardId) && card && typeof card === 'object') {
      orderedCards.push(card);
    }
  }

  return orderedCards;
}

function readCardDisplayTitle(card, sourceLocale) {
  const sourceTitle = normalizeOptionalString(getStoredCardContentVariant(card, sourceLocale)?.title);

  if (sourceTitle) {
    return sourceTitle;
  }

  const contentByLocale = card?.contentByLocale ?? {};

  for (const locale of Object.keys(contentByLocale).sort((left, right) => left.localeCompare(right))) {
    const title = normalizeOptionalString(contentByLocale?.[locale]?.title);

    if (title) {
      return title;
    }
  }

  return normalizeOptionalString(card?.title);
}

function hasMeaningfulVariantContent(variant) {
  return Boolean(
    normalizeOptionalString(variant?.title)
    || normalizeOptionalString(variant?.detailsMarkdown)
  );
}

function cloneVariant(variant) {
  if (!variant || typeof variant !== 'object') {
    return null;
  }

  return structuredClone(variant);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
