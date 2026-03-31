import { stageSupportsAction } from '../domain/board_stage_actions.js';

export function getDefaultBoardStageId(board, fallbackStageId = 'backlog') {
  if (Array.isArray(board?.stageOrder) && board.stageOrder.length > 0) {
    return board.stageOrder[0];
  }

  return fallbackStageId;
}

export function getBoardStage(board, stageId) {
  if (!isValidStageId(board, stageId)) {
    return null;
  }

  return board.stages[stageId];
}

export function getBoardStageTitle(board, stageId) {
  return getBoardStage(board, stageId)?.title ?? String(stageId ?? '');
}

export function resolveBoardStageId(board, { stageId = null, columnId = null, cardId = null } = {}) {
  if (isValidStageId(board, stageId)) {
    return stageId;
  }

  if (isValidStageId(board, columnId)) {
    return columnId;
  }

  if (typeof cardId === 'string' && Array.isArray(board?.stageOrder) && isPlainObject(board?.stages)) {
    for (const candidateStageId of board.stageOrder) {
      const stage = board.stages[candidateStageId];

      if (Array.isArray(stage?.cardIds) && stage.cardIds.includes(cardId)) {
        return candidateStageId;
      }
    }
  }

  return null;
}

export function getStageMoveOptions(board, currentStageId, { includeCurrentStage = true } = {}) {
  const currentStage = getBoardStage(board, currentStageId);

  if (!currentStage) {
    return [];
  }

  const optionStageIds = includeCurrentStage ? [currentStageId] : [];

  for (const targetStageId of currentStage.allowedTransitionStageIds ?? []) {
    if (isValidStageId(board, targetStageId) && !optionStageIds.includes(targetStageId)) {
      optionStageIds.push(targetStageId);
    }
  }

  return optionStageIds.map((stageId) => ({
    id: stageId,
    title: getBoardStageTitle(board, stageId)
  }));
}

export function shouldShowPriorityForStage(stageId) {
  return stageId !== 'done' && stageId !== 'archived';
}

export function shouldShowDeleteForStage(board, stageId) {
  return stageSupportsAction(board, stageId, 'card.delete');
}

function isValidStageId(board, stageId) {
  return Boolean(
    typeof stageId === 'string' &&
      Array.isArray(board?.stageOrder) &&
      isPlainObject(board?.stages) &&
      board.stageOrder.includes(stageId) &&
      isPlainObject(board.stages[stageId])
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
