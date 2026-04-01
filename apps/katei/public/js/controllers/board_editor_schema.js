import { createDefaultBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { normalizeBoardSchemaInput, assertBoardSchemaCompatibleWithBoard } from '../domain/board_schema.js';
import { createDefaultBoardStages } from '../domain/board_workflow.js';

export function createBoardEditorFormState(board = null) {
  const baseLanguagePolicy = board?.languagePolicy ?? createDefaultBoardLanguagePolicy();
  const stageDefinitions = board
    ? (board.stageOrder ?? []).map((stageId) => ({
        id: stageId,
        title: board.stages?.[stageId]?.title ?? '',
        allowedTransitionStageIds: [...(board.stages?.[stageId]?.allowedTransitionStageIds ?? [])],
        actionIds: [...(board.stages?.[stageId]?.actionIds ?? [])]
      }))
    : createDefaultBoardStages().map((stage) => ({
        id: stage.id,
        title: stage.title,
        allowedTransitionStageIds: [...stage.allowedTransitionStageIds],
        actionIds: [...stage.actionIds]
      }));

  return {
    title: board?.title ?? '',
    sourceLocale: baseLanguagePolicy.sourceLocale,
    defaultLocale: baseLanguagePolicy.defaultLocale,
    supportedLocales: baseLanguagePolicy.supportedLocales.join(', '),
    requiredLocales: baseLanguagePolicy.requiredLocales.join(', '),
    stageDefinitions: stageDefinitions
      .map((stage) => serializeStageDefinition(stage))
      .join('\n')
  };
}

export function parseBoardEditorFormInput(input, { currentBoard = null } = {}) {
  const title = String(input?.title ?? '').trim();

  if (!title) {
    throw new Error('Board title is required.');
  }

  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy: {
      sourceLocale: input?.sourceLocale,
      defaultLocale: input?.defaultLocale,
      supportedLocales: splitInlineList(input?.supportedLocales),
      requiredLocales: splitInlineList(input?.requiredLocales)
    },
    stageDefinitions: parseStageDefinitions(input?.stageDefinitions),
    templates: []
  });

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  return {
    title,
    languagePolicy: normalizedSchema.languagePolicy,
    stageDefinitions: normalizedSchema.stageDefinitions,
    templates: []
  };
}

function parseStageDefinitions(rawValue) {
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

function serializeStageDefinition(stage) {
  const transitions = stage.allowedTransitionStageIds.join(', ');
  const actionIds = Array.isArray(stage.actionIds) ? stage.actionIds : [];

  if (actionIds.length > 0) {
    return `${stage.id} | ${stage.title} | ${transitions} | ${actionIds.join(', ')}`;
  }

  return `${stage.id} | ${stage.title} | ${transitions}`;
}
