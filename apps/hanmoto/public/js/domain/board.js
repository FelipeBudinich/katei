import { createCardId } from '../utils/id.js';

export const STORAGE_KEY = 'hanmoto.board.v1';
export const BOARD_VERSION = 1;
export const BOARD_ID = 'main';
export const APP_TITLE = '過程 (katei)';
export const BOARD_TITLE = '過程';
export const COLUMN_ORDER = Object.freeze(['backlog', 'doing', 'done', 'archived']);
export const COLUMN_TITLES = Object.freeze({
  backlog: 'Backlog',
  doing: 'Doing',
  done: 'Done',
  archived: 'Archived'
});
export const COLUMN_DEFINITIONS = Object.freeze(
  COLUMN_ORDER.map((id) => ({ id, title: COLUMN_TITLES[id] }))
);
export const PRIORITY_ORDER = Object.freeze(['urgent', 'important', 'when_possible']);
export const PRIORITY_LABELS = Object.freeze({
  urgent: 'Urgent',
  important: 'Important',
  when_possible: 'When possible'
});
export const PRIORITY_DEFINITIONS = Object.freeze(
  PRIORITY_ORDER.map((id) => ({ id, label: PRIORITY_LABELS[id] }))
);
export const DEFAULT_PRIORITY = 'important';

export const DEFAULT_BOARD_STATE = createEmptyBoard();

export function createEmptyBoard() {
  const columns = {};

  for (const column of COLUMN_DEFINITIONS) {
    columns[column.id] = {
      id: column.id,
      title: column.title,
      cardIds: []
    };
  }

  return {
    version: BOARD_VERSION,
    boardId: BOARD_ID,
    title: BOARD_TITLE,
    ui: {
      activeColumnId: COLUMN_ORDER[0]
    },
    columnOrder: [...COLUMN_ORDER],
    columns,
    cards: {}
  };
}

export function cloneBoard(board) {
  return structuredClone(board);
}

export function validateBoardShape(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (value.version !== BOARD_VERSION || value.boardId !== BOARD_ID || value.title !== BOARD_TITLE) {
    return false;
  }

  if (!value.ui || value.ui.activeColumnId == null || !isValidColumnId(value.ui.activeColumnId)) {
    return false;
  }

  if (!Array.isArray(value.columnOrder) || value.columnOrder.length !== COLUMN_ORDER.length) {
    return false;
  }

  if (value.columnOrder.join('|') !== COLUMN_ORDER.join('|')) {
    return false;
  }

  if (!value.columns || typeof value.columns !== 'object') {
    return false;
  }

  if (!value.cards || typeof value.cards !== 'object') {
    return false;
  }

  const seenCardIds = new Set();

  for (const columnId of COLUMN_ORDER) {
    const column = value.columns[columnId];

    if (!column || column.id !== columnId || column.title !== COLUMN_TITLES[columnId]) {
      return false;
    }

    if (!Array.isArray(column.cardIds)) {
      return false;
    }

    for (const cardId of column.cardIds) {
      if (typeof cardId !== 'string' || seenCardIds.has(cardId)) {
        return false;
      }

      const card = value.cards[cardId];

      if (!isValidCard(card, cardId)) {
        return false;
      }

      seenCardIds.add(cardId);
    }
  }

  if (Object.keys(value.cards).length !== seenCardIds.size) {
    return false;
  }

  return true;
}

export function setActiveColumn(board, columnId) {
  assertValidColumnId(columnId);
  const nextBoard = cloneBoard(board);
  nextBoard.ui.activeColumnId = columnId;
  return nextBoard;
}

export function createCard(board, input) {
  const nextBoard = cloneBoard(board);
  const columnId = 'backlog';
  const title = normalizeRequiredTitle(input?.title);
  const priority = normalizePriority(input?.priority ?? DEFAULT_PRIORITY);
  const timestamp = createTimestamp();
  const cardId = createCardId();

  nextBoard.cards[cardId] = {
    id: cardId,
    title,
    priority,
    description: normalizeDescription(input?.description),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  nextBoard.columns[columnId].cardIds = [...nextBoard.columns[columnId].cardIds, cardId];

  return nextBoard;
}

export function updateCard(board, cardId, updates) {
  const nextBoard = cloneBoard(board);
  const existingCard = nextBoard.cards[cardId];

  if (!existingCard) {
    throw new Error('Card not found.');
  }

  const nextTitle =
    updates && Object.prototype.hasOwnProperty.call(updates, 'title')
      ? normalizeRequiredTitle(updates.title)
      : existingCard.title;
  const nextDescription =
    updates && Object.prototype.hasOwnProperty.call(updates, 'description')
      ? normalizeDescription(updates.description)
      : existingCard.description;
  const nextPriority =
    updates && Object.prototype.hasOwnProperty.call(updates, 'priority')
      ? normalizePriority(updates.priority)
      : existingCard.priority;

  nextBoard.cards[cardId] = {
    ...existingCard,
    title: nextTitle,
    priority: nextPriority,
    description: nextDescription,
    updatedAt: createTimestamp()
  };

  return nextBoard;
}

export function deleteCard(board, cardId) {
  const nextBoard = cloneBoard(board);

  if (!nextBoard.cards[cardId]) {
    throw new Error('Card not found.');
  }

  delete nextBoard.cards[cardId];

  for (const columnId of COLUMN_ORDER) {
    nextBoard.columns[columnId].cardIds = nextBoard.columns[columnId].cardIds.filter(
      (currentCardId) => currentCardId !== cardId
    );
  }

  return nextBoard;
}

export function moveCard(board, cardId, sourceColumnId, targetColumnId) {
  assertValidColumnId(sourceColumnId);
  assertValidColumnId(targetColumnId);

  const nextBoard = cloneBoard(board);
  const card = nextBoard.cards[cardId];

  if (!card) {
    throw new Error('Card not found.');
  }

  const sourceColumn = nextBoard.columns[sourceColumnId];
  const sourceIndex = sourceColumn.cardIds.indexOf(cardId);

  if (sourceIndex === -1) {
    throw new Error('Card is not in the source column.');
  }

  if (sourceColumnId === targetColumnId) {
    return cloneBoard(board);
  }

  sourceColumn.cardIds = sourceColumn.cardIds.filter((currentCardId) => currentCardId !== cardId);

  const targetColumn = nextBoard.columns[targetColumnId];
  targetColumn.cardIds = [...targetColumn.cardIds, cardId];

  nextBoard.cards[cardId] = {
    ...card,
    updatedAt: createTimestamp()
  };

  return nextBoard;
}

export function findColumnIdByCardId(board, cardId) {
  for (const columnId of COLUMN_ORDER) {
    if (board.columns[columnId].cardIds.includes(cardId)) {
      return columnId;
    }
  }

  return null;
}

export function getColumnTitle(columnId) {
  assertValidColumnId(columnId);
  return COLUMN_TITLES[columnId];
}

export function sortCardIdsForColumn(board, columnId) {
  assertValidColumnId(columnId);

  return [...board.columns[columnId].cardIds].sort((leftCardId, rightCardId) => {
    const leftCard = board.cards[leftCardId];
    const rightCard = board.cards[rightCardId];
    const priorityDifference = PRIORITY_ORDER.indexOf(leftCard.priority) - PRIORITY_ORDER.indexOf(rightCard.priority);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (leftCard.createdAt !== rightCard.createdAt) {
      return leftCard.createdAt.localeCompare(rightCard.createdAt);
    }

    return leftCard.id.localeCompare(rightCard.id);
  });
}

function createTimestamp() {
  return new Date().toISOString();
}

function normalizeRequiredTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error('Card title is required.');
  }

  return normalized;
}

function normalizeDescription(value) {
  return String(value ?? '').trim();
}

function isValidColumnId(columnId) {
  return COLUMN_ORDER.includes(columnId);
}

function assertValidColumnId(columnId) {
  if (!isValidColumnId(columnId)) {
    throw new Error(`Invalid column id: ${columnId}`);
  }
}

function isValidCard(card, cardId) {
  return Boolean(
    card &&
      typeof card === 'object' &&
      card.id === cardId &&
      typeof card.title === 'string' &&
      card.title.trim() &&
      isValidPriority(card.priority) &&
      typeof card.description === 'string' &&
      typeof card.createdAt === 'string' &&
      typeof card.updatedAt === 'string'
  );
}

function normalizePriority(value) {
  if (!isValidPriority(value)) {
    throw new Error(`Invalid priority: ${value}`);
  }

  return value;
}

function isValidPriority(value) {
  return PRIORITY_ORDER.includes(value);
}
