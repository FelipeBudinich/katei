import { normalizeBoardLanguagePolicy } from './board_language_policy.js';
import {
  BOARD_STAGE_PROMPT_RUN_ACTION_ID,
  getDefaultBoardStageActionIds,
  normalizeBoardStageActionIds
} from './board_stage_actions.js';
import {
  normalizeBoardStagePromptAction,
  serializeBoardStagePromptAction
} from './board_stage_prompt_action.js';
import { isValidBoardStageId } from './board_workflow.js';

export function normalizeBoardSchemaInput(input) {
  const languagePolicy = normalizeBoardLanguagePolicy(input?.languagePolicy);

  if (!languagePolicy) {
    throw new Error('Board language policy is invalid.');
  }

  const stageDefinitions = normalizeStageDefinitions(input?.stageDefinitions);
  const stageIds = new Set(stageDefinitions.map((stage) => stage.id));
  const templates = normalizeTemplates(input?.templates, stageIds);
  const stageOrder = stageDefinitions.map((stage) => stage.id);
  const stages = Object.fromEntries(
    stageDefinitions.map((stage) => [
      stage.id,
      {
        id: stage.id,
        title: stage.title,
        cardIds: [],
        allowedTransitionStageIds: [...stage.allowedTransitionStageIds],
        templateIds: [],
        actionIds: [...stage.actionIds],
        ...(stage.promptAction ? { promptAction: serializeBoardStagePromptAction(stage.promptAction, stageIds) } : {})
      }
    ])
  );

  for (const template of templates) {
    stages[template.initialStageId].templateIds.push(template.id);
  }

  return {
    languagePolicy,
    stageDefinitions,
    templates,
    stageOrder,
    stages,
    templatesByGroup: {
      default: templates.map((template) => ({
        id: template.id,
        title: template.title,
        initialStageId: template.initialStageId
      }))
    }
  };
}

export function serializeBoardSchemaInput(board) {
  return {
    languagePolicy: structuredClone(board?.languagePolicy ?? null),
    stageDefinitions: Array.isArray(board?.stageOrder)
      ? board.stageOrder.map((stageId) => ({
          id: stageId,
          title: board.stages?.[stageId]?.title ?? '',
          allowedTransitionStageIds: [...(board.stages?.[stageId]?.allowedTransitionStageIds ?? [])],
          actionIds: [...(board.stages?.[stageId]?.actionIds ?? [])],
          ...(board.stages?.[stageId]?.promptAction
            ? {
                promptAction: serializeBoardStagePromptAction(
                  board.stages[stageId].promptAction,
                  board.stageOrder
                )
              }
            : {})
        }))
      : [],
    templates: Array.isArray(board?.templates?.default)
      ? board.templates.default.map((template) => ({
          id: template.id,
          title: template.title,
          initialStageId: template.initialStageId
        }))
      : []
  };
}

export function assertBoardSchemaCompatibleWithBoard(board, normalizedSchema) {
  if (!isPlainObject(board) || !normalizedSchema) {
    return;
  }

  const nextStageIds = new Set(normalizedSchema.stageOrder);

  for (const stageId of board.stageOrder ?? []) {
    if (!nextStageIds.has(stageId) && (board.stages?.[stageId]?.cardIds?.length ?? 0) > 0) {
      throw new Error('Cannot remove a stage that still has cards.');
    }
  }

  const nextSourceLocale = normalizedSchema.languagePolicy.sourceLocale;

  if (board.languagePolicy?.sourceLocale === nextSourceLocale) {
    return;
  }

  for (const card of Object.values(board.cards ?? {})) {
    if (!isPlainObject(card?.contentByLocale) || !isPlainObject(card.contentByLocale[nextSourceLocale])) {
      throw new Error('Existing cards do not contain the new source locale.');
    }
  }
}

function normalizeStageDefinitions(value) {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('Board must define at least one stage.');
  }

  const stageDefinitions = [];
  const seenStageIds = new Set();

  for (const rawStage of value) {
    const stageId = String(rawStage?.id ?? '').trim();

    if (!isValidBoardStageId(stageId)) {
      throw new Error('Stage ids must be lowercase slugs like "in-review".');
    }

    if (seenStageIds.has(stageId)) {
      throw new Error('Stage ids must be unique.');
    }

    seenStageIds.add(stageId);
    const hasActionIds = isPlainObject(rawStage) && Object.prototype.hasOwnProperty.call(rawStage, 'actionIds');
    const hasPromptAction = isPlainObject(rawStage) && Object.prototype.hasOwnProperty.call(rawStage, 'promptAction');
    stageDefinitions.push({
      id: stageId,
      title: normalizeRequiredText(rawStage?.title, 'Stage titles are required.'),
      allowedTransitionStageIds: normalizeStringList(rawStage?.allowedTransitionStageIds, {
        allowEmpty: true,
        entryErrorMessage: 'Stage transitions must use stage ids.'
      }),
      actionIds: hasActionIds
        ? normalizeBoardStageActionIds(rawStage.actionIds)
        : getDefaultBoardStageActionIds(stageId),
      ...(hasPromptAction ? { promptAction: rawStage.promptAction } : {})
    });
  }

  const validStageIds = new Set(stageDefinitions.map((stage) => stage.id));

  for (const stage of stageDefinitions) {
    if (stage.allowedTransitionStageIds.some((targetStageId) => !validStageIds.has(targetStageId))) {
      throw new Error('Stage transitions must reference existing stages.');
    }

    const hasPromptRunAction = stage.actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID);
    const hasPromptAction = Object.prototype.hasOwnProperty.call(stage, 'promptAction');

    if (hasPromptRunAction && !hasPromptAction) {
      throw new Error('Stages with "card.prompt.run" must define a prompt action.');
    }

    if (!hasPromptRunAction && hasPromptAction) {
      throw new Error('Stage prompt actions require the "card.prompt.run" action id.');
    }

    if (hasPromptAction) {
      stage.promptAction = normalizeBoardStagePromptAction(stage.promptAction, validStageIds);
    }
  }

  return stageDefinitions;
}

function normalizeTemplates(value, validStageIds) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('Board templates are invalid.');
  }

  const templates = [];
  const seenTemplateIds = new Set();

  for (const rawTemplate of value) {
    const templateId = String(rawTemplate?.id ?? '').trim();

    if (!templateId) {
      throw new Error('Template ids are required.');
    }

    if (seenTemplateIds.has(templateId)) {
      throw new Error('Template ids must be unique.');
    }

    seenTemplateIds.add(templateId);

    const initialStageId = String(rawTemplate?.initialStageId ?? '').trim();

    if (!validStageIds.has(initialStageId)) {
      throw new Error('Template initial stage must reference an existing stage.');
    }

    templates.push({
      id: templateId,
      title: normalizeRequiredText(rawTemplate?.title, 'Template titles are required.'),
      initialStageId
    });
  }

  return templates;
}

function normalizeStringList(value, { allowEmpty = false, entryErrorMessage }) {
  if (value == null) {
    return allowEmpty ? [] : null;
  }

  if (!Array.isArray(value)) {
    throw new Error(entryErrorMessage);
  }

  const values = [];
  const seenValues = new Set();

  for (const entry of value) {
    const normalizedEntry = String(entry ?? '').trim();

    if (!normalizedEntry || seenValues.has(normalizedEntry)) {
      throw new Error(entryErrorMessage);
    }

    seenValues.add(normalizedEntry);
    values.push(normalizedEntry);
  }

  return values;
}

function normalizeRequiredText(value, errorMessage) {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
