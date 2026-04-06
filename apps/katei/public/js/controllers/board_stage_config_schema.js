import { createDefaultBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { BOARD_STAGE_PROMPT_RUN_ACTION_ID } from '../domain/board_stage_actions.js';
import {
  normalizeBoardStagePromptAction,
  serializeBoardStagePromptAction
} from '../domain/board_stage_prompt_action.js';
import { assertBoardSchemaCompatibleWithBoard, normalizeBoardSchemaInput } from '../domain/board_schema.js';

export function parseStageDefinitions(rawValue) {
  const lines = splitMultilineInput(rawValue);

  if (lines.length < 1) {
    throw new Error('Board must define at least one stage.');
  }

  return lines.map((line) => {
    const segments = splitStagePipeSegments(line);

    if (segments.length < 2 || segments.length > 4) {
      throw new Error(
        'Each stage must use "stage-id | Title", "stage-id | Title | target-a, target-b", or "stage-id | Title | target-a, target-b | action-a, action-b".'
      );
    }

    const stageDefinition = {
      id: segments[0],
      title: segments[1],
      allowedTransitionStageIds: splitInlineList(segments[2] ?? ''),
      // Omitted action segments are an explicit "no actions" signal for the editor flow.
      actionIds: segments.length === 4 ? splitInlineList(segments[3] ?? '') : []
    };

    return stageDefinition;
  });
}

export function serializeStageDefinitions(stageDefinitions) {
  if (!Array.isArray(stageDefinitions)) {
    return '';
  }

  return stageDefinitions.map((stageDefinition) => serializeStageDefinition(stageDefinition)).join('\n');
}

export function serializeStageDefinition(stageDefinition) {
  const transitions = Array.isArray(stageDefinition?.allowedTransitionStageIds)
    ? stageDefinition.allowedTransitionStageIds.join(', ')
    : '';
  const actionIds = Array.isArray(stageDefinition?.actionIds) ? stageDefinition.actionIds : [];

  if (actionIds.length > 0) {
    return `${stageDefinition?.id ?? ''} | ${stageDefinition?.title ?? ''} | ${transitions} | ${actionIds.join(', ')}`;
  }

  return `${stageDefinition?.id ?? ''} | ${stageDefinition?.title ?? ''} | ${transitions}`;
}

export function createStageDefinitionsSummary(rawValue) {
  return createStageDefinitionsSummaryFromDefinitions(parseStageDefinitions(rawValue));
}

export function createStageDefinitionsSummaryFromDefinitions(stageDefinitions) {
  const stageIds = Array.isArray(stageDefinitions)
    ? stageDefinitions
      .map((stageDefinition) => String(stageDefinition?.id ?? '').trim())
      .filter(Boolean)
    : [];

  return {
    count: stageIds.length,
    stages: stageIds.join(', ')
  };
}

export function parseStagePromptActions(rawValue) {
  const normalizedValue = String(rawValue ?? '').trim();

  if (!normalizedValue) {
    return {};
  }

  let parsedValue = null;

  try {
    parsedValue = JSON.parse(normalizedValue);
  } catch (error) {
    throw new Error('Stage prompt actions must use a JSON object.');
  }

  if (!isPlainObject(parsedValue)) {
    throw new Error('Stage prompt actions must use a JSON object.');
  }

  const promptActions = {};

  for (const [rawStageId, rawPromptAction] of Object.entries(parsedValue)) {
    const stageId = String(rawStageId ?? '').trim();

    if (!stageId || !isPlainObject(rawPromptAction)) {
      throw new Error('Stage prompt actions must use a JSON object.');
    }

    promptActions[stageId] = {
      enabled: rawPromptAction.enabled === true,
      prompt: typeof rawPromptAction.prompt === 'string' ? rawPromptAction.prompt : '',
      targetStageId:
        typeof rawPromptAction.targetStageId === 'string' ? rawPromptAction.targetStageId : ''
    };
  }

  return promptActions;
}

export function serializeStagePromptActions(promptActions) {
  if (!isPlainObject(promptActions) || Object.keys(promptActions).length < 1) {
    return '';
  }

  const serializedPromptActions = {};

  for (const stageId of Object.keys(promptActions).sort()) {
    const promptAction = promptActions[stageId];

    if (!isPlainObject(promptAction) || promptAction.enabled !== true) {
      continue;
    }

    serializedPromptActions[stageId] = serializeBoardStagePromptAction(promptAction);
  }

  return Object.keys(serializedPromptActions).length > 0
    ? JSON.stringify(serializedPromptActions, null, 2)
    : '';
}

export function mergeStageDefinitionsWithPromptActions(stageDefinitions, promptActions) {
  const normalizedPromptActions = isPlainObject(promptActions) ? promptActions : {};

  return Array.isArray(stageDefinitions)
    ? stageDefinitions.map((stageDefinition) => {
        const actionIds = Array.isArray(stageDefinition?.actionIds) ? [...stageDefinition.actionIds] : null;
        const nextStageDefinition = {
          ...stageDefinition,
          allowedTransitionStageIds: [...(stageDefinition?.allowedTransitionStageIds ?? [])]
        };
        const promptAction = normalizedPromptActions[nextStageDefinition.id];

        if (actionIds) {
          nextStageDefinition.actionIds = actionIds;
        }

        if (
          actionIds?.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID)
          && promptAction
        ) {
          nextStageDefinition.promptAction = serializeBoardStagePromptAction(promptAction);
        }

        return nextStageDefinition;
      })
    : [];
}

export function extractStagePromptActionsFromDefinitions(stageDefinitions) {
  if (!Array.isArray(stageDefinitions)) {
    return {};
  }

  const promptActions = {};

  for (const stageDefinition of stageDefinitions) {
    if (!stageDefinition?.promptAction) {
      continue;
    }

    promptActions[stageDefinition.id] = serializeBoardStagePromptAction(stageDefinition.promptAction);
  }

  return promptActions;
}

export function validateAndNormalizeStagePromptActions(rawValue, stageDefinitions) {
  const parsedPromptActions = parseStagePromptActions(rawValue);

  if (!Array.isArray(stageDefinitions)) {
    throw new Error('Board must define at least one stage.');
  }

  const stageDefinitionsById = new Map(stageDefinitions.map((stageDefinition) => [stageDefinition.id, stageDefinition]));
  const validStageIds = new Set(stageDefinitionsById.keys());
  const normalizedPromptActions = {};

  for (const [stageId, rawPromptAction] of Object.entries(parsedPromptActions)) {
    const stageDefinition = stageDefinitionsById.get(stageId);

    if (!stageDefinition) {
      throw new Error('Stage prompt actions must reference stages in the current draft.');
    }

    if (!Array.isArray(stageDefinition.actionIds) || !stageDefinition.actionIds.includes(BOARD_STAGE_PROMPT_RUN_ACTION_ID)) {
      throw new Error('Stage prompt actions require the "card.prompt.run" action id.');
    }

    normalizedPromptActions[stageId] = normalizeBoardStagePromptAction(rawPromptAction, validStageIds);
  }

  return normalizedPromptActions;
}

export function validateAndNormalizeStageDefinitions(
  rawValue,
  {
    currentBoard = null,
    languagePolicy = currentBoard?.languagePolicy ?? createDefaultBoardLanguagePolicy()
  } = {}
) {
  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy,
    stageDefinitions: parseStageDefinitions(rawValue),
    templates: []
  });

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  return normalizedSchema.stageDefinitions;
}

export function validateAndNormalizeStageDefinitionsWithPromptActions(
  rawDefinitionsValue,
  rawPromptActionsValue,
  {
    currentBoard = null,
    languagePolicy = currentBoard?.languagePolicy ?? createDefaultBoardLanguagePolicy()
  } = {}
) {
  const parsedStageDefinitions = parseStageDefinitions(rawDefinitionsValue);
  const promptActions = validateAndNormalizeStagePromptActions(rawPromptActionsValue, parsedStageDefinitions);
  const mergedStageDefinitions = mergeStageDefinitionsWithPromptActions(parsedStageDefinitions, promptActions);
  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy,
    stageDefinitions: mergedStageDefinitions,
    templates: []
  });

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  return normalizedSchema.stageDefinitions;
}

function splitMultilineInput(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitStagePipeSegments(line) {
  return line.split('|').map((segment) => segment.trim());
}

function splitInlineList(value) {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
