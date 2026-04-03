import { createDefaultBoardLanguagePolicy } from '../domain/board_language_policy.js';
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
      allowedTransitionStageIds: splitInlineList(segments[2] ?? '')
    };

    if (segments.length === 4) {
      stageDefinition.actionIds = splitInlineList(segments[3] ?? '');
    }

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
