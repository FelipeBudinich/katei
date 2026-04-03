import {
  BOARD_STAGE_PROMPT_RUN_ACTION_ID,
  stageSupportsAction
} from './board_stage_actions.js';

export function normalizeBoardStagePromptAction(value, validStageIds = null) {
  if (value == null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new Error('Stage prompt action is invalid.');
  }

  if (Object.prototype.hasOwnProperty.call(value, 'enabled') && value.enabled !== true) {
    throw new Error('Stage prompt action must be enabled when provided.');
  }

  const prompt = normalizeRequiredString(value.prompt, 'Stage prompt action prompt is required.');
  const targetStageId = normalizeRequiredString(
    value.targetStageId,
    'Stage prompt action target stage is required.'
  );
  const normalizedValidStageIds = normalizeValidStageIds(validStageIds);

  if (normalizedValidStageIds && !normalizedValidStageIds.has(targetStageId)) {
    throw new Error('Stage prompt actions must target an existing stage.');
  }

  return {
    enabled: true,
    prompt,
    targetStageId
  };
}

export function serializeBoardStagePromptAction(value, validStageIds = null) {
  const normalizedPromptAction = normalizeBoardStagePromptAction(value, validStageIds);
  return normalizedPromptAction ? structuredClone(normalizedPromptAction) : null;
}

export function getBoardStagePromptAction(board, stageId) {
  if (
    typeof stageId !== 'string'
    || !Array.isArray(board?.stageOrder)
    || !isPlainObject(board?.stages)
    || !board.stageOrder.includes(stageId)
    || !isPlainObject(board.stages[stageId])
    || !stageSupportsAction(board, stageId, BOARD_STAGE_PROMPT_RUN_ACTION_ID)
  ) {
    return null;
  }

  try {
    return normalizeBoardStagePromptAction(board.stages[stageId].promptAction, board.stageOrder);
  } catch (error) {
    return null;
  }
}

export function stageSupportsPromptRun(board, stageId) {
  return Boolean(
    stageSupportsAction(board, stageId, BOARD_STAGE_PROMPT_RUN_ACTION_ID)
    && getBoardStagePromptAction(board, stageId)
  );
}

function normalizeValidStageIds(validStageIds) {
  if (validStageIds == null) {
    return null;
  }

  if (validStageIds instanceof Set) {
    return validStageIds;
  }

  if (Array.isArray(validStageIds)) {
    return new Set(validStageIds.map((stageId) => String(stageId ?? '').trim()).filter(Boolean));
  }

  throw new Error('Stage prompt action validStageIds must be an array or Set when provided.');
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
