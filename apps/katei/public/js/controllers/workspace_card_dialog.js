import { canonicalizeContentLocale } from '../domain/board_language_policy.js';
import { getCardContentVariant, getBoardCardContentVariant } from '../domain/workspace.js';
import { listCardLocaleStatuses } from '../domain/card_localization_requests.js';

export function createRuntimeCardDialogState(
  card,
  board,
  { requestedLocale = null, currentActorRole = null, canEditLocalizedContent = false } = {}
) {
  const content = getCardContentVariant(card, requestedLocale, board)
    ?? getBoardCardContentVariant(card, board);

  return {
    card,
    requestedLocale,
    displayVariant: content,
    currentActorRole,
    canEditLocalizedContent: Boolean(canEditLocalizedContent)
  };
}

export function buildCardEditorMutationPlan({
  mode,
  board,
  card,
  boardId,
  cardId,
  locale,
  input,
  sourceStageId,
  targetStageId
} = {}) {
  if (mode === 'create') {
    return {
      operations: [
        {
          method: 'createCard',
          args: [boardId, input]
        }
      ],
      includesLocalizedUpsert: false
    };
  }

  if (mode !== 'edit' || !board || !card || !boardId || !cardId) {
    return {
      operations: [],
      includesLocalizedUpsert: false
    };
  }

  const operations = [];
  const normalizedLocale = canonicalizeContentLocale(locale);
  const selectedStatus = normalizedLocale
    ? listCardLocaleStatuses(board, card).find((entry) => entry.locale === normalizedLocale) ?? null
    : null;
  const storedVariant = readStoredLocalizedVariant(card, normalizedLocale);
  const nextTitle = String(input?.title ?? '');
  const nextDetailsMarkdown = String(input?.detailsMarkdown ?? '');
  const shouldUpsertLocalizedContent = Boolean(
    normalizedLocale &&
      (
        !storedVariant ||
        storedVariant.title !== nextTitle ||
        storedVariant.detailsMarkdown !== nextDetailsMarkdown ||
        selectedStatus?.isRequested
      )
  );

  if (shouldUpsertLocalizedContent) {
    operations.push({
      method: 'upsertCardLocale',
      args: [
        boardId,
        cardId,
        normalizedLocale,
        {
          title: nextTitle,
          detailsMarkdown: nextDetailsMarkdown
        }
      ]
    });
  }

  if (card.priority !== input?.priority) {
    operations.push({
      method: 'updateCard',
      args: [
        boardId,
        cardId,
        {
          priority: input?.priority
        }
      ]
    });
  }

  if (sourceStageId && targetStageId && sourceStageId !== targetStageId) {
    operations.push({
      method: 'moveCard',
      args: [boardId, cardId, sourceStageId, targetStageId]
    });
  }

  return {
    operations,
    includesLocalizedUpsert: shouldUpsertLocalizedContent
  };
}

export function createCardLocaleRequestAction({ boardId, cardId, locale, clear = false } = {}) {
  return {
    method: clear ? 'clearCardLocaleRequest' : 'requestCardLocale',
    args: [boardId, cardId, canonicalizeContentLocale(locale) ?? locale]
  };
}

export async function executeWorkspaceCardEditorPlan(service, plan) {
  let nextWorkspace = null;

  for (const operation of plan?.operations ?? []) {
    nextWorkspace = await service[operation.method](...operation.args);
  }

  return nextWorkspace;
}

export async function executeWorkspaceServiceAction(service, action) {
  if (!action?.method) {
    return null;
  }

  return service[action.method](...(action.args ?? []));
}

function readStoredLocalizedVariant(card, locale) {
  if (!locale || !card?.contentByLocale || typeof card.contentByLocale !== 'object') {
    return null;
  }

  const storedVariant = card.contentByLocale[locale];

  if (!storedVariant || typeof storedVariant !== 'object') {
    return null;
  }

  return {
    title: typeof storedVariant.title === 'string' ? storedVariant.title : '',
    detailsMarkdown:
      typeof storedVariant.detailsMarkdown === 'string'
        ? storedVariant.detailsMarkdown
        : ''
  };
}
