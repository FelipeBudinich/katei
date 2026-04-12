export const BOARD_STAGE_PROMPT_RUN_ACTION_ID = 'card.prompt.run';

export const BOARD_STAGE_ACTION_IDS = Object.freeze([
  'card.create',
  'card.delete',
  'card.review',
  BOARD_STAGE_PROMPT_RUN_ACTION_ID
]);

export function getDefaultBoardStageActionIds(stageId) {
  switch (stageId) {
    case 'backlog':
    case 'doing':
      return ['card.create'];
    case 'archived':
      return ['card.delete'];
    default:
      return [];
  }
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

export function createBoardStageActions(value) {
  return normalizeBoardStageActionIds(value);
}

export function getStageActions(board, stageId) {
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
    const stage = board.stages[stageId];

    if (Array.isArray(stage.actions)) {
      return createBoardStageActions(stage.actions);
    }

    return createBoardStageActions(stage.actionIds);
  } catch (error) {
    return [];
  }
}

export function getStageActionIds(board, stageId) {
  return getStageActions(board, stageId);
}

export function stageSupportsAction(board, stageId, actionId) {
  return getStageActions(board, stageId).includes(actionId);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
