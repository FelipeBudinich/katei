import {
  BOARD_STAGE_PROMPT_RUN_ACTION_ID,
  createBoardStageActions,
  getDefaultBoardStageActionIds,
  isValidBoardStageActionId
} from './board_stage_actions.js';
import { normalizeBoardStagePromptAction } from './board_stage_prompt_action.js';
import { normalizeBoardStageReviewPolicy } from './board_stage_review_policy.js';

const DEFAULT_BOARD_STAGES = Object.freeze([
  Object.freeze({
    id: 'backlog',
    title: 'Backlog',
    allowedTransitionStageIds: Object.freeze(['doing', 'done']),
    templateIds: Object.freeze([]),
    actions: Object.freeze(createBoardStageActions(getDefaultBoardStageActionIds('backlog'))),
    actionIds: Object.freeze(getDefaultBoardStageActionIds('backlog'))
  }),
  Object.freeze({
    id: 'doing',
    title: 'Doing',
    allowedTransitionStageIds: Object.freeze(['backlog', 'done']),
    templateIds: Object.freeze([]),
    actions: Object.freeze(createBoardStageActions(getDefaultBoardStageActionIds('doing'))),
    actionIds: Object.freeze(getDefaultBoardStageActionIds('doing'))
  }),
  Object.freeze({
    id: 'done',
    title: 'Done',
    allowedTransitionStageIds: Object.freeze(['backlog', 'doing', 'archived']),
    templateIds: Object.freeze([]),
    actions: Object.freeze(createBoardStageActions(getDefaultBoardStageActionIds('done'))),
    actionIds: Object.freeze(getDefaultBoardStageActionIds('done'))
  }),
  Object.freeze({
    id: 'archived',
    title: 'Archived',
    allowedTransitionStageIds: Object.freeze(['backlog', 'doing', 'done']),
    templateIds: Object.freeze([]),
    actions: Object.freeze(createBoardStageActions(getDefaultBoardStageActionIds('archived'))),
    actionIds: Object.freeze(getDefaultBoardStageActionIds('archived'))
  })
]);

export const BOARD_STAGE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createDefaultBoardStages() {
  return DEFAULT_BOARD_STAGES.map(
    ({ id, title, allowedTransitionStageIds, templateIds, actions, actionIds }) => ({
      id,
      title,
      cardIds: [],
      allowedTransitionStageIds: [...allowedTransitionStageIds],
      templateIds: [...templateIds],
      actions: [...actions],
      actionIds: [...actionIds]
    })
  );
}

export function createDefaultBoardTemplates() {
  return {
    default: []
  };
}

export function isValidBoardStageId(value) {
  return typeof value === 'string' && BOARD_STAGE_ID_PATTERN.test(value.trim());
}

export function validateBoardStages(board) {
  if (!isPlainObject(board) || !Array.isArray(board.stageOrder) || !isPlainObject(board.stages)) {
    return false;
  }

  if (board.stageOrder.length < 1 || Object.keys(board.stages).length !== board.stageOrder.length) {
    return false;
  }

  const validStageIds = new Set();

  for (const stageId of board.stageOrder) {
    if (!isValidBoardStageId(stageId) || validStageIds.has(stageId)) {
      return false;
    }

    validStageIds.add(stageId);
  }

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];

    if (!isPlainObject(stage) || stage.id !== stageId) {
      return false;
    }

    if (
      !isNonEmptyString(stage.title)
      || !isStringArray(stage.cardIds)
      || !isUniqueStringArray(stage.allowedTransitionStageIds)
      || !isUniqueStringArray(stage.templateIds)
      || !isValidStageActionIds(stage.actionIds)
    ) {
      return false;
    }
  }

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];

    if (stage.allowedTransitionStageIds.some((targetStageId) => !validStageIds.has(targetStageId))) {
      return false;
    }

    const hasPromptRunAction = stage.actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID);
    const hasPromptAction = Object.prototype.hasOwnProperty.call(stage, 'promptAction');
    const hasReviewAction = stage.actionIds.includes('card.review');
    const hasReviewPolicy = Object.prototype.hasOwnProperty.call(stage, 'reviewPolicy');

    if (hasPromptRunAction !== hasPromptAction) {
      return false;
    }

    if (hasPromptAction) {
      try {
        normalizeBoardStagePromptAction(stage.promptAction, validStageIds);
      } catch (error) {
        return false;
      }
    }

    if (!hasReviewAction && hasReviewPolicy) {
      return false;
    }

    if (hasReviewPolicy) {
      try {
        normalizeBoardStageReviewPolicy(stage.reviewPolicy);
      } catch (error) {
        return false;
      }
    }
  }

  return true;
}

export function validateBoardTemplates(board) {
  if (!isPlainObject(board) || !Array.isArray(board.stageOrder) || !isPlainObject(board.stages)) {
    return false;
  }

  if (!isPlainObject(board.templates) || !Array.isArray(board.templates.default)) {
    return false;
  }

  const validStageIds = new Set(board.stageOrder);
  const seenTemplateIds = new Set();
  const templateById = new Map();

  for (const template of board.templates.default) {
    if (
      !isPlainObject(template) ||
      !isNonEmptyString(template.id) ||
      !isNonEmptyString(template.title) ||
      !isNonEmptyString(template.initialStageId)
    ) {
      return false;
    }

    if (seenTemplateIds.has(template.id)) {
      return false;
    }

    seenTemplateIds.add(template.id);
    templateById.set(template.id, template);

    if (!validStageIds.has(template.initialStageId)) {
      return false;
    }
  }

  for (const stageId of board.stageOrder) {
    const stage = board.stages[stageId];
    const seenStageTemplateIds = new Set();

    if (!isPlainObject(stage) || !Array.isArray(stage.templateIds)) {
      return false;
    }

    for (const templateId of stage.templateIds) {
      if (!isNonEmptyString(templateId) || seenStageTemplateIds.has(templateId)) {
        return false;
      }

      if (!templateById.has(templateId) || templateById.get(templateId).initialStageId !== stageId) {
        return false;
      }

      seenStageTemplateIds.add(templateId);
    }
  }

  return true;
}

export function stripLegacyColumnAliasesFromWorkspace(workspace) {
  if (!isPlainObject(workspace) || !isPlainObject(workspace.boards)) {
    return workspace;
  }

  const normalizedWorkspace = structuredClone(workspace);

  for (const board of Object.values(normalizedWorkspace.boards)) {
    if (!isPlainObject(board)) {
      continue;
    }

    delete board.columnOrder;
    delete board.columns;
  }

  return normalizedWorkspace;
}

export function stripLegacyColumnAliasesFromBoard(board) {
  if (!isPlainObject(board)) {
    return board;
  }

  const normalizedBoard = structuredClone(board);

  delete normalizedBoard.columnOrder;
  delete normalizedBoard.columns;

  return normalizedBoard;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isUniqueStringArray(value) {
  return isStringArray(value) && new Set(value).size === value.length && value.every(isNonEmptyString);
}

function isValidStageActionIds(value) {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((entry) => isNonEmptyString(entry) && isValidBoardStageActionId(entry))
  );
}
