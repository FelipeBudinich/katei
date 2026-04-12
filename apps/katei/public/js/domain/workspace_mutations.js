import { createBoardId, createCardId } from '../utils/id.js';
import {
  createCardContentProvenance,
  createCardContentReview,
  getStoredCardContentVariant,
  upsertCardContentVariant
} from './card_localization.js';
import {
  createCardWorkflowReview,
  resetCardWorkflowReview
} from './card_workflow_review.js';
import { stageSupportsAction } from './board_stage_actions.js';
import {
  DEFAULT_PRIORITY,
  cloneWorkspace,
  createWorkspaceBoard
} from './workspace_read_model.js';
import { findColumnIdByCardId, getBoard, getCard } from './workspace_selectors.js';
import {
  assertValidBoardId,
  assertValidColumnId,
  normalizeBoardTitle,
  normalizeCardTitle,
  normalizeDetailsMarkdown,
  normalizePriority
} from './workspace_validation.js';

// Compatibility mutators for the current snapshot-based browser flow.
// Later 6b steps move these runtime mutations behind a server-authoritative command engine.

export function createBoard(workspace, input) {
  const nextWorkspace = cloneWorkspace(workspace);
  const timestamp = createTimestamp();
  const board = createWorkspaceBoard({
    id: createBoardId(),
    title: normalizeBoardTitle(input?.title),
    createdAt: timestamp,
    updatedAt: timestamp,
    creator: {
      type: 'system',
      id: 'browser-mutation'
    }
  });

  nextWorkspace.boards[board.id] = board;
  nextWorkspace.boardOrder = [...nextWorkspace.boardOrder, board.id];
  nextWorkspace.ui.activeBoardId = board.id;

  return nextWorkspace;
}

export function renameBoard(workspace, boardId, title) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);

  board.title = normalizeBoardTitle(title);
  board.updatedAt = createTimestamp();

  return nextWorkspace;
}

export function deleteBoard(workspace, boardId) {
  if (workspace.boardOrder.length === 1) {
    throw new Error('Cannot delete the last remaining board.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const boardIndex = nextWorkspace.boardOrder.indexOf(boardId);

  if (boardIndex === -1 || !nextWorkspace.boards[boardId]) {
    throw new Error('Board not found.');
  }

  nextWorkspace.boardOrder = nextWorkspace.boardOrder.filter((currentBoardId) => currentBoardId !== boardId);
  delete nextWorkspace.boards[boardId];

  if (nextWorkspace.ui.activeBoardId === boardId) {
    const nextBoardId =
      nextWorkspace.boardOrder[boardIndex] ?? nextWorkspace.boardOrder[boardIndex - 1] ?? nextWorkspace.boardOrder[0];
    nextWorkspace.ui.activeBoardId = nextBoardId;
  }

  return nextWorkspace;
}

export function setActiveBoard(workspace, boardId) {
  const nextWorkspace = cloneWorkspace(workspace);
  assertValidBoardId(boardId, nextWorkspace.boards);
  nextWorkspace.ui.activeBoardId = boardId;
  return nextWorkspace;
}

export function resetBoard(workspace, boardId) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const timestamp = createTimestamp();

  nextWorkspace.boards[boardId] = {
    ...createWorkspaceBoard({
      id: board.id,
      title: board.title,
      createdAt: board.createdAt,
      updatedAt: timestamp,
      creator: null
    }),
    stageOrder: [...board.stageOrder],
    stages: createClearedStages(board),
    templates: structuredClone(board.templates),
    collaboration: structuredClone(board.collaboration ?? { memberships: [], invites: [] }),
    languagePolicy: structuredClone(board.languagePolicy)
  };

  return nextWorkspace;
}

export function createCard(workspace, boardId, input) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const timestamp = createTimestamp();
  const cardId = createCardId();
  const initialStageId =
    (typeof input?.stageId === 'string' && input.stageId.trim()) ? input.stageId : board.stageOrder[0];
  const sourceLocale = board.languagePolicy.sourceLocale;
  const requiresReview = input?.requiresReview === true;
  const workflowReviewStageId =
    requiresReview && stageSupportsAction(board, initialStageId, 'card.review')
      ? initialStageId
      : null;

  assertValidColumnId(initialStageId, board);

  if (typeof input?.stageId === 'string' && input.stageId.trim() && !stageSupportsAction(board, initialStageId, 'card.create')) {
    throw new Error('Cards can only be created in create-enabled stages.');
  }

  board.cards[cardId] = {
    id: cardId,
    priority: normalizePriority(input?.priority ?? DEFAULT_PRIORITY),
    createdAt: timestamp,
    updatedAt: timestamp,
    workflowReview: createCardWorkflowReview({
      required: requiresReview,
      currentStageId: workflowReviewStageId
    }),
    localeRequests: {},
    contentByLocale: {
      [sourceLocale]: {
        title: normalizeCardTitle(input?.title),
        detailsMarkdown: normalizeDetailsMarkdown(input?.detailsMarkdown),
        provenance: createCardContentProvenance({
          actor: {
            type: 'system',
            id: 'browser-mutation'
          },
          timestamp,
          includesHumanInput: true
        }),
        review: createCardContentReview({
          origin: 'human'
        })
      }
    }
  };
  board.stages[initialStageId].cardIds = [...board.stages[initialStageId].cardIds, cardId];
  board.updatedAt = timestamp;

  return nextWorkspace;
}

export function updateCard(workspace, boardId, cardId, updates) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const card = getCard(board, cardId);
  const timestamp = createTimestamp();
  const sourceLocale = board.languagePolicy.sourceLocale;
  const currentVariant = getStoredCardContentVariant(card, sourceLocale);
  const nextTitle = hasOwn(updates, 'title')
    ? normalizeCardTitle(updates.title)
    : (currentVariant?.title ?? '');
  const nextDetailsMarkdown = hasOwn(updates, 'detailsMarkdown')
    ? normalizeDetailsMarkdown(updates.detailsMarkdown)
    : (currentVariant?.detailsMarkdown ?? '');
  const sourceContentChanged =
    currentVariant?.title !== nextTitle || currentVariant?.detailsMarkdown !== nextDetailsMarkdown;

  let nextCard = upsertCardContentVariant(
    {
      ...card,
      priority: hasOwn(updates, 'priority') ? normalizePriority(updates.priority) : card.priority,
      updatedAt: timestamp
    },
    sourceLocale,
    {
      title: nextTitle,
      detailsMarkdown: nextDetailsMarkdown
    },
    {
      actor: {
        type: 'system',
        id: 'browser-mutation'
      },
      timestamp,
      includesHumanInput: true
    }
  );

  if (sourceContentChanged && card.workflowReview?.required === true) {
    nextCard = {
      ...nextCard,
      workflowReview: resetCardWorkflowReview(card.workflowReview, {
        currentStageId: card.workflowReview.currentStageId
      })
    };
  }

  board.cards[cardId] = {
    ...nextCard,
    priority: hasOwn(updates, 'priority') ? normalizePriority(updates.priority) : card.priority
  };
  board.updatedAt = timestamp;

  return nextWorkspace;
}

export function deleteCard(workspace, boardId, cardId) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);

  getCard(board, cardId);
  delete board.cards[cardId];

  const sourceColumnId = findColumnIdByCardId(board, cardId);

  if (sourceColumnId) {
    board.stages[sourceColumnId].cardIds = board.stages[sourceColumnId].cardIds.filter(
      (currentCardId) => currentCardId !== cardId
    );
  }

  board.updatedAt = createTimestamp();

  return nextWorkspace;
}

export function moveCard(workspace, boardId, cardId, sourceColumnId, targetColumnId) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  assertValidColumnId(sourceColumnId, board);
  assertValidColumnId(targetColumnId, board);
  const card = getCard(board, cardId);
  const sourceColumn = board.stages[sourceColumnId];
  const sourceIndex = sourceColumn.cardIds.indexOf(cardId);

  if (sourceIndex === -1) {
    throw new Error('Card is not in the source column.');
  }

  if (sourceColumnId === targetColumnId) {
    return nextWorkspace;
  }

  sourceColumn.cardIds = sourceColumn.cardIds.filter((currentCardId) => currentCardId !== cardId);
  board.stages[targetColumnId].cardIds = [...board.stages[targetColumnId].cardIds, cardId];

  const timestamp = createTimestamp();
  let nextCard = {
    ...card,
    updatedAt: timestamp
  };

  if (
    card.workflowReview?.required === true &&
    stageSupportsAction(board, targetColumnId, 'card.review') &&
    card.workflowReview.currentStageId !== targetColumnId
  ) {
    nextCard = {
      ...nextCard,
      workflowReview: resetCardWorkflowReview(card.workflowReview, {
        currentStageId: targetColumnId
      })
    };
  }

  board.cards[cardId] = nextCard;
  board.updatedAt = timestamp;

  return nextWorkspace;
}

function createTimestamp() {
  return new Date().toISOString();
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function createClearedStages(board) {
  return Object.fromEntries(
    board.stageOrder.map((stageId) => [
      stageId,
      {
        ...structuredClone(board.stages[stageId]),
        cardIds: []
      }
    ])
  );
}
