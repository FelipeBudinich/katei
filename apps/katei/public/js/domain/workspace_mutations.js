import { createBoardId, createCardId } from '../utils/id.js';
import {
  DEFAULT_PRIORITY,
  cloneWorkspace,
  createCollapsedColumns,
  createWorkspaceBoard
} from './workspace_read_model.js';
import {
  findColumnIdByCardId,
  getBoard,
  getCard,
  getCollapsedColumnsForBoard
} from './workspace_selectors.js';
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

  nextWorkspace.boards[boardId] = createWorkspaceBoard({
    id: board.id,
    title: board.title,
    createdAt: board.createdAt,
    updatedAt: timestamp
  });

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

  const sourceColumnId = findColumnIdByCardId(board, cardId);

  if (sourceColumnId) {
    board.columns[sourceColumnId].cardIds = board.columns[sourceColumnId].cardIds.filter(
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

function createTimestamp() {
  return new Date().toISOString();
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function ensureCollapsedColumnsByBoard(workspace) {
  if (!workspace.ui.collapsedColumnsByBoard || typeof workspace.ui.collapsedColumnsByBoard !== 'object') {
    workspace.ui.collapsedColumnsByBoard = {};
  }
}
