import {
  COLUMN_ORDER,
  COLUMN_TITLES,
  PRIORITY_ORDER,
  createCollapsedColumns
} from './workspace_read_model.js';
import { assertValidBoardId, assertValidColumnId } from './workspace_validation.js';

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

export function getCard(board, cardId) {
  const card = board.cards[cardId];

  if (!card) {
    throw new Error('Card not found.');
  }

  return card;
}
