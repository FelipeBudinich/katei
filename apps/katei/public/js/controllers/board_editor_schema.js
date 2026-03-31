import { createDefaultBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { normalizeBoardSchemaInput, assertBoardSchemaCompatibleWithBoard } from '../domain/board_schema.js';
import { createDefaultBoardStages } from '../domain/board_workflow.js';

export function createBoardEditorFormState(board = null) {
  const baseLanguagePolicy = board?.languagePolicy ?? createDefaultBoardLanguagePolicy();
  const stageDefinitions = board
    ? (board.stageOrder ?? []).map((stageId) => ({
        id: stageId,
        title: board.stages?.[stageId]?.title ?? '',
        allowedTransitionStageIds: [...(board.stages?.[stageId]?.allowedTransitionStageIds ?? [])]
      }))
    : createDefaultBoardStages().map((stage) => ({
        id: stage.id,
        title: stage.title,
        allowedTransitionStageIds: [...stage.allowedTransitionStageIds]
      }));
  const templates = Array.isArray(board?.templates?.default) ? board.templates.default : [];

  return {
    title: board?.title ?? '',
    sourceLocale: baseLanguagePolicy.sourceLocale,
    defaultLocale: baseLanguagePolicy.defaultLocale,
    supportedLocales: baseLanguagePolicy.supportedLocales.join(', '),
    requiredLocales: baseLanguagePolicy.requiredLocales.join(', '),
    stageDefinitions: stageDefinitions
      .map(
        (stage) =>
          `${stage.id} | ${stage.title} | ${stage.allowedTransitionStageIds.join(', ')}`
      )
      .join('\n'),
    templates: templates
      .map((template) => `${template.id} | ${template.title} | ${template.initialStageId}`)
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
    templates: parseTemplates(input?.templates)
  });

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  return {
    title,
    languagePolicy: normalizedSchema.languagePolicy,
    stageDefinitions: normalizedSchema.stageDefinitions,
    templates: normalizedSchema.templates
  };
}

function parseStageDefinitions(rawValue) {
  const lines = splitMultilineInput(rawValue);

  if (lines.length < 1) {
    throw new Error('Board must define at least one stage.');
  }

  return lines.map((line) => {
    const segments = splitPipeSegments(line);

    if (segments.length < 2 || segments.length > 3) {
      throw new Error('Each stage must use "stage-id | Title | target-a, target-b".');
    }

    return {
      id: segments[0],
      title: segments[1],
      allowedTransitionStageIds: splitInlineList(segments[2] ?? '')
    };
  });
}

function parseTemplates(rawValue) {
  const lines = splitMultilineInput(rawValue);
  const templates = [];
  const usedTemplateIds = new Set();

  for (const [index, line] of lines.entries()) {
    const segments = splitPipeSegments(line);

    if (segments.length < 2 || segments.length > 3) {
      throw new Error(
        'Each template must use "template-id | Title | initial-stage-id" or "Title | initial-stage-id".'
      );
    }

    let templateId = '';
    let title = '';
    let initialStageId = '';

    if (segments.length === 2) {
      [title, initialStageId] = segments;
      templateId = createTemplateIdFromTitle(title, usedTemplateIds, index);
    } else {
      [templateId, title, initialStageId] = segments;
    }

    usedTemplateIds.add(templateId);
    templates.push({
      id: templateId,
      title,
      initialStageId
    });
  }

  return templates;
}

function splitMultilineInput(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitPipeSegments(line) {
  return line.split('|').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

function splitInlineList(value) {
  return String(value ?? '')
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createTemplateIdFromTitle(title, usedTemplateIds, index) {
  const baseId =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `template-${index + 1}`;
  let nextId = baseId;
  let suffix = 2;

  while (usedTemplateIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}
