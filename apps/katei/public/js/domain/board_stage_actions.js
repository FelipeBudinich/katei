export const BOARD_STAGE_ACTION_IDS = Object.freeze(['card.delete']);

export function getDefaultBoardStageActionIds(stageId) {
  return stageId === 'archived' ? ['card.delete'] : [];
}

export function isValidBoardStageActionId(actionId) {
  return typeof actionId === 'string' && BOARD_STAGE_ACTION_IDS.includes(actionId.trim());
}

export function normalizeBoardStageActionIds(value) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('Stage actions must use known action ids.');
  }

  const actionIds = [];
  const seenActionIds = new Set();

  for (const rawActionId of value) {
    const actionId = String(rawActionId ?? '').trim();

    if (!isValidBoardStageActionId(actionId)) {
      throw new Error('Stage actions must use known action ids.');
    }

    if (seenActionIds.has(actionId)) {
      throw new Error('Stage action ids must be unique.');
    }

    seenActionIds.add(actionId);
    actionIds.push(actionId);
  }

  return actionIds;
}

export function getStageActionIds(board, stageId) {
  if (
    typeof stageId !== 'string' ||
    !Array.isArray(board?.stageOrder) ||
    !isPlainObject(board?.stages) ||
    !board.stageOrder.includes(stageId) ||
    !isPlainObject(board.stages[stageId])
  ) {
    return [];
  }

  try {
    return normalizeBoardStageActionIds(board.stages[stageId].actionIds);
  } catch (error) {
    return [];
  }
}

export function stageSupportsAction(board, stageId, actionId) {
  return getStageActionIds(board, stageId).includes(actionId);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
