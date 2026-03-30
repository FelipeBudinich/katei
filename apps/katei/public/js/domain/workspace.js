import { createBoardId, createCardId } from '../utils/id.js';

export const WORKSPACE_VERSION = 4;
export const WORKSPACE_ID = 'main';
export const STORAGE_KEY = 'katei.workspace.v4';
export const APP_TITLE = '過程 (katei)';
export const DEFAULT_BOARD_ID = 'main';
export const DEFAULT_BOARD_TITLE = '過程';
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
export const PRIORITY_ORDER = Object.freeze(['urgent', 'important', 'normal']);
export const PRIORITY_LABELS = Object.freeze({
  urgent: 'Urgent',
  important: 'Important',
  normal: 'Normal'
});
export const PRIORITY_DEFINITIONS = Object.freeze(
  PRIORITY_ORDER.map((id) => ({ id, label: PRIORITY_LABELS[id] }))
);
export const DEFAULT_PRIORITY = 'important';
export const DEFAULT_WORKSPACE_STATE = Object.freeze(createEmptyWorkspace());

export function createEmptyWorkspace() {
  const timestamp = createTimestamp();
  const board = createEmptyBoard({
    id: DEFAULT_BOARD_ID,
    title: DEFAULT_BOARD_TITLE,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return {
    version: WORKSPACE_VERSION,
    workspaceId: WORKSPACE_ID,
    ui: {
      activeBoardId: board.id,
      collapsedColumnsByBoard: {
        [board.id]: createCollapsedColumns()
      }
    },
    boardOrder: [board.id],
    boards: {
      [board.id]: board
    }
  };
}

export function createEmptyBoard(input) {
  const title = normalizeBoardTitle(input?.title);
  const id = String(input?.id ?? createBoardId());
  const createdAt = input?.createdAt ?? createTimestamp();
  const updatedAt = input?.updatedAt ?? createdAt;
  const columns = {};

  for (const column of COLUMN_DEFINITIONS) {
    columns[column.id] = {
      id: column.id,
      title: column.title,
      cardIds: []
    };
  }

  return {
    id,
    title,
    createdAt,
    updatedAt,
    columnOrder: [...COLUMN_ORDER],
    columns,
    cards: {}
  };
}

export function cloneWorkspace(workspace) {
  return structuredClone(workspace);
}

export function validateWorkspaceShape(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  if (value.version !== WORKSPACE_VERSION || value.workspaceId !== WORKSPACE_ID) {
    return false;
  }

  if (!value.ui || !isValidBoardId(value.ui.activeBoardId, value.boards)) {
    return false;
  }

  if (
    value.ui.collapsedColumnsByBoard != null &&
    !isValidCollapsedColumnsByBoard(value.ui.collapsedColumnsByBoard, value.boards)
  ) {
    return false;
  }

  if (!Array.isArray(value.boardOrder) || value.boardOrder.length < 1) {
    return false;
  }

  if (!value.boards || typeof value.boards !== 'object') {
    return false;
  }

  if (Object.keys(value.boards).length !== value.boardOrder.length) {
    return false;
  }

  for (const boardId of value.boardOrder) {
    const board = value.boards[boardId];

    if (!isValidBoard(board, boardId)) {
      return false;
    }
  }

  return true;
}

export function createBoard(workspace, input) {
  const nextWorkspace = cloneWorkspace(workspace);
  const timestamp = createTimestamp();
  const board = createEmptyBoard({
    title: input?.title,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  nextWorkspace.boards[board.id] = board;
  nextWorkspace.boardOrder = [...nextWorkspace.boardOrder, board.id];
  nextWorkspace.ui.activeBoardId = board.id;
  ensureCollapsedColumnsByBoard(nextWorkspace);
  nextWorkspace.ui.collapsedColumnsByBoard[board.id] = createCollapsedColumns();

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
  ensureCollapsedColumnsByBoard(nextWorkspace);
  delete nextWorkspace.ui.collapsedColumnsByBoard[boardId];

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

export function setColumnCollapsed(workspace, boardId, columnId, isCollapsed) {
  assertValidColumnId(columnId);

  const nextWorkspace = cloneWorkspace(workspace);
  getBoard(nextWorkspace, boardId);
  ensureCollapsedColumnsByBoard(nextWorkspace);
  nextWorkspace.ui.collapsedColumnsByBoard[boardId] = getCollapsedColumnsForBoard(nextWorkspace, boardId);
  nextWorkspace.ui.collapsedColumnsByBoard[boardId][columnId] = Boolean(isCollapsed);

  return nextWorkspace;
}

export function resetBoard(workspace, boardId) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const timestamp = createTimestamp();

  nextWorkspace.boards[boardId] = {
    ...createEmptyBoard({
      id: board.id,
      title: board.title,
      createdAt: board.createdAt,
      updatedAt: timestamp
    })
  };

  return nextWorkspace;
}

export function createCard(workspace, boardId, input) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const timestamp = createTimestamp();
  const cardId = createCardId();

  board.cards[cardId] = {
    id: cardId,
    title: normalizeCardTitle(input?.title),
    detailsMarkdown: normalizeDetailsMarkdown(input?.detailsMarkdown),
    priority: normalizePriority(input?.priority ?? DEFAULT_PRIORITY),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  board.columns.backlog.cardIds = [...board.columns.backlog.cardIds, cardId];
  board.updatedAt = timestamp;

  return nextWorkspace;
}

export function updateCard(workspace, boardId, cardId, updates) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const card = getCard(board, cardId);
  const timestamp = createTimestamp();

  board.cards[cardId] = {
    ...card,
    title: hasOwn(updates, 'title') ? normalizeCardTitle(updates.title) : card.title,
    detailsMarkdown: hasOwn(updates, 'detailsMarkdown')
      ? normalizeDetailsMarkdown(updates.detailsMarkdown)
      : card.detailsMarkdown,
    priority: hasOwn(updates, 'priority') ? normalizePriority(updates.priority) : card.priority,
    updatedAt: timestamp
  };
  board.updatedAt = timestamp;

  return nextWorkspace;
}

export function deleteCard(workspace, boardId, cardId) {
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);

  getCard(board, cardId);
  delete board.cards[cardId];

  for (const columnId of COLUMN_ORDER) {
    board.columns[columnId].cardIds = board.columns[columnId].cardIds.filter(
      (currentCardId) => currentCardId !== cardId
    );
  }

  board.updatedAt = createTimestamp();

  return nextWorkspace;
}

export function moveCard(workspace, boardId, cardId, sourceColumnId, targetColumnId) {
  assertValidColumnId(sourceColumnId);
  assertValidColumnId(targetColumnId);

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const card = getCard(board, cardId);
  const sourceColumn = board.columns[sourceColumnId];
  const sourceIndex = sourceColumn.cardIds.indexOf(cardId);

  if (sourceIndex === -1) {
    throw new Error('Card is not in the source column.');
  }

  if (sourceColumnId === targetColumnId) {
    return nextWorkspace;
  }

  sourceColumn.cardIds = sourceColumn.cardIds.filter((currentCardId) => currentCardId !== cardId);
  board.columns[targetColumnId].cardIds = [...board.columns[targetColumnId].cardIds, cardId];

  const timestamp = createTimestamp();
  board.cards[cardId] = {
    ...card,
    updatedAt: timestamp
  };
  board.updatedAt = timestamp;

  return nextWorkspace;
}

export function sortCardIdsForColumn(board, columnId) {
  assertValidColumnId(columnId);

  return [...board.columns[columnId].cardIds].sort((leftCardId, rightCardId) => {
    const leftCard = board.cards[leftCardId];
    const rightCard = board.cards[rightCardId];
    const priorityDifference =
      PRIORITY_ORDER.indexOf(leftCard.priority) - PRIORITY_ORDER.indexOf(rightCard.priority);

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (leftCard.createdAt !== rightCard.createdAt) {
      return leftCard.createdAt.localeCompare(rightCard.createdAt);
    }

    return leftCard.id.localeCompare(rightCard.id);
  });
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

export function getBoard(workspace, boardId) {
  assertValidBoardId(boardId, workspace.boards);
  return workspace.boards[boardId];
}

export function getActiveBoard(workspace) {
  return getBoard(workspace, workspace.ui.activeBoardId);
}

export function getCollapsedColumnsForBoard(workspace, boardId) {
  const storedState = workspace?.ui?.collapsedColumnsByBoard?.[boardId] ?? {};
  const collapsedColumns = createCollapsedColumns();

  for (const columnId of COLUMN_ORDER) {
    collapsedColumns[columnId] = Boolean(storedState[columnId]);
  }

  return collapsedColumns;
}

export function createCollapsedColumns() {
  const collapsedColumns = {};

  for (const columnId of COLUMN_ORDER) {
    collapsedColumns[columnId] = false;
  }

  return collapsedColumns;
}

function createTimestamp() {
  return new Date().toISOString();
}

function normalizeBoardTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error('Board title is required.');
  }

  return normalized;
}

function normalizeCardTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error('Card title is required.');
  }

  return normalized;
}

function normalizeDetailsMarkdown(value) {
  return String(value ?? '').trim();
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

function isValidColumnId(columnId) {
  return COLUMN_ORDER.includes(columnId);
}

function assertValidColumnId(columnId) {
  if (!isValidColumnId(columnId)) {
    throw new Error(`Invalid column id: ${columnId}`);
  }
}

function isValidBoardId(boardId, boards) {
  return Boolean(typeof boardId === 'string' && boards && typeof boards === 'object' && boards[boardId]);
}

function assertValidBoardId(boardId, boards) {
  if (!isValidBoardId(boardId, boards)) {
    throw new Error('Board not found.');
  }
}

function isValidBoard(board, boardId) {
  if (!board || typeof board !== 'object' || board.id !== boardId) {
    return false;
  }

  if (typeof board.title !== 'string' || !board.title.trim()) {
    return false;
  }

  if (typeof board.createdAt !== 'string' || typeof board.updatedAt !== 'string') {
    return false;
  }

  if (!Array.isArray(board.columnOrder) || board.columnOrder.join('|') !== COLUMN_ORDER.join('|')) {
    return false;
  }

  if (!board.columns || typeof board.columns !== 'object' || !board.cards || typeof board.cards !== 'object') {
    return false;
  }

  const seenCardIds = new Set();

  for (const columnId of COLUMN_ORDER) {
    const column = board.columns[columnId];

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

      const card = board.cards[cardId];

      if (!isValidCard(card, cardId)) {
        return false;
      }

      seenCardIds.add(cardId);
    }
  }

  if (Object.keys(board.cards).length !== seenCardIds.size) {
    return false;
  }

  return true;
}

function isValidCard(card, cardId) {
  return Boolean(
    card &&
      typeof card === 'object' &&
      card.id === cardId &&
      typeof card.title === 'string' &&
      card.title.trim() &&
      typeof card.detailsMarkdown === 'string' &&
      typeof card.createdAt === 'string' &&
      typeof card.updatedAt === 'string' &&
      isValidPriority(card.priority)
  );
}

function getCard(board, cardId) {
  const card = board.cards[cardId];

  if (!card) {
    throw new Error('Card not found.');
  }

  return card;
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function ensureCollapsedColumnsByBoard(workspace) {
  if (!workspace.ui.collapsedColumnsByBoard || typeof workspace.ui.collapsedColumnsByBoard !== 'object') {
    workspace.ui.collapsedColumnsByBoard = {};
  }
}

function isValidCollapsedColumnsByBoard(value, boards) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const boardId of Object.keys(value)) {
    if (!boards[boardId] || !isValidCollapsedColumns(value[boardId])) {
      return false;
    }
  }

  return true;
}

function isValidCollapsedColumns(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const columnId of COLUMN_ORDER) {
    if (value[columnId] != null && typeof value[columnId] !== 'boolean') {
      return false;
    }
  }

  return true;
}
