import { validateBoardLanguagePolicy } from './board_language_policy.js';
import { validateBoardStages, validateBoardTemplates } from './board_workflow.js';
import { validateCardContentByLocale } from './card_localization.js';
import {
  COLUMN_ORDER,
  PRIORITY_ORDER,
  WORKSPACE_ID,
  WORKSPACE_VERSION
} from './workspace_read_model.js';

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

export function normalizeBoardTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error('Board title is required.');
  }

  return normalized;
}

export function normalizeCardTitle(value) {
  const normalized = String(value ?? '').trim();

  if (!normalized) {
    throw new Error('Card title is required.');
  }

  return normalized;
}

export function normalizeDetailsMarkdown(value) {
  return String(value ?? '').trim();
}

export function normalizePriority(value) {
  if (!isValidPriority(value)) {
    throw new Error(`Invalid priority: ${value}`);
  }

  return value;
}

export function isValidPriority(value) {
  return PRIORITY_ORDER.includes(value);
}

export function isValidColumnId(columnId, board = null) {
  const stageIds = Array.isArray(board?.stageOrder) ? board.stageOrder : COLUMN_ORDER;
  return Boolean(typeof columnId === 'string' && stageIds.includes(columnId));
}

export function assertValidColumnId(columnId, board = null) {
  if (!isValidColumnId(columnId, board)) {
    throw new Error(`Invalid column id: ${columnId}`);
  }
}

export function isValidBoardId(boardId, boards) {
  return Boolean(typeof boardId === 'string' && boards && typeof boards === 'object' && boards[boardId]);
}

export function assertValidBoardId(boardId, boards) {
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

  if (!validateBoardStages(board)) {
    return false;
  }

  if (!validateBoardTemplates(board) || !validateBoardLanguagePolicy(board.languagePolicy)) {
    return false;
  }

  if (!board.cards || typeof board.cards !== 'object') {
    return false;
  }

  const seenCardIds = new Set();

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];

    for (const cardId of stage.cardIds) {
      if (typeof cardId !== 'string' || seenCardIds.has(cardId)) {
        return false;
      }

      const card = board.cards[cardId];

      if (!isValidCard(card, cardId, board)) {
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

function isValidCard(card, cardId, board) {
  return Boolean(
    card &&
      typeof card === 'object' &&
      card.id === cardId &&
      typeof card.createdAt === 'string' &&
      typeof card.updatedAt === 'string' &&
      validateCardContentByLocale(card, board) &&
      isValidPriority(card.priority)
  );
}

function isValidCollapsedColumnsByBoard(value, boards) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const boardId of Object.keys(value)) {
    if (!boards[boardId] || !isValidCollapsedColumns(value[boardId], boards[boardId])) {
      return false;
    }
  }

  return true;
}

function isValidCollapsedColumns(value, board) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  for (const stageId of board.stageOrder) {
    if (value[stageId] != null && typeof value[stageId] !== 'boolean') {
      return false;
    }
  }

  return true;
}
