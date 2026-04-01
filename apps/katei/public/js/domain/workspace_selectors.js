import { COLUMN_ORDER, COLUMN_TITLES, PRIORITY_ORDER } from './workspace_read_model.js';
import { assertValidBoardId, assertValidColumnId } from './workspace_validation.js';

export function sortCardIdsForColumn(board, columnId) {
  assertValidColumnId(columnId, board);

  return [...board.stages[columnId].cardIds].sort((leftCardId, rightCardId) => {
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
  for (const stageId of board.stageOrder) {
    if (board.stages[stageId].cardIds.includes(cardId)) {
      return stageId;
    }
  }

  return null;
}

export function getColumnTitle(columnId, board = null) {
  assertValidColumnId(columnId, board);
  return board?.stages?.[columnId]?.title ?? COLUMN_TITLES[columnId];
}

export function getBoard(workspace, boardId) {
  assertValidBoardId(boardId, workspace.boards);
  return workspace.boards[boardId];
}

export function getActiveBoard(workspace) {
  return getBoard(workspace, workspace.ui.activeBoardId);
}

export function getCard(board, cardId) {
  const card = board.cards[cardId];

  if (!card) {
    throw new Error('Card not found.');
  }

  return card;
}
