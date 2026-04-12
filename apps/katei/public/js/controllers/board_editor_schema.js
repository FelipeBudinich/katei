import {
  BOARD_AI_PROVIDER_OPENAI,
  normalizeBoardAiLocalization,
  normalizeBoardAiProvider
} from '../domain/board_ai_localization.js';
import { createDefaultBoardLanguagePolicy } from '../domain/board_language_policy.js';
import { normalizeBoardLocalizationGlossary } from '../domain/board_localization_glossary.js';
import { getStageActions } from '../domain/board_stage_actions.js';
import { serializeBoardStagePromptAction } from '../domain/board_stage_prompt_action.js';
import { serializeBoardStageReviewPolicy } from '../domain/board_stage_review_policy.js';
import { normalizeBoardSchemaInput, assertBoardSchemaCompatibleWithBoard } from '../domain/board_schema.js';
import { createDefaultBoardStages } from '../domain/board_workflow.js';
import {
  extractStagePromptActionsFromDefinitions,
  extractStageReviewPoliciesFromDefinitions,
  mergeStageDefinitionsWithPromptActions,
  mergeStageDefinitionsWithReviewPolicies,
  parseStageDefinitions,
  serializeStageDefinitions,
  serializeStagePromptActions,
  serializeStageReviewPolicies,
  validateAndNormalizeStagePromptActions,
  validateAndNormalizeStageReviewPolicies
} from './board_stage_config_schema.js';

export function createBoardEditorFormState(board = null) {
  const baseLanguagePolicy = board?.languagePolicy ?? createDefaultBoardLanguagePolicy();
  const stageDefinitions = board
    ? (board.stageOrder ?? []).map((stageId) => ({
        id: stageId,
        title: board.stages?.[stageId]?.title ?? '',
        allowedTransitionStageIds: [...(board.stages?.[stageId]?.allowedTransitionStageIds ?? [])],
        actionIds: getStageActions(board, stageId),
        ...(board.stages?.[stageId]?.promptAction
          ? {
              promptAction: serializeBoardStagePromptAction(
                board.stages[stageId].promptAction,
                board.stageOrder
              )
            }
          : {}),
        ...(board.stages?.[stageId]?.reviewPolicy
          ? {
              reviewPolicy: serializeBoardStageReviewPolicy(board.stages[stageId].reviewPolicy)
            }
          : {})
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
    aiProvider: normalizeBoardAiLocalization(board?.aiLocalization).provider,
    hasOpenAiApiKey: normalizeBoardAiLocalization(board?.aiLocalization).hasApiKey,
    openAiApiKeyLast4: normalizeBoardAiLocalization(board?.aiLocalization).apiKeyLast4,
    localizationGlossary: serializeLocalizationGlossary(
      normalizeBoardLocalizationGlossary(board?.localizationGlossary, {
        supportedLocales: baseLanguagePolicy.supportedLocales
      })
    ),
    stageDefinitions: serializeStageDefinitions(stageDefinitions),
    stagePromptActions: serializeStagePromptActions(extractStagePromptActionsFromDefinitions(stageDefinitions)),
    stageReviewPolicies: serializeStageReviewPolicies(extractStageReviewPoliciesFromDefinitions(stageDefinitions))
  };
}

export function parseBoardEditorFormInput(input, { currentBoard = null } = {}) {
  const title = String(input?.title ?? '').trim();

  if (!title) {
    throw new Error('Board title is required.');
  }

  const parsedStageDefinitions = parseStageDefinitions(input?.stageDefinitions);
  const stagePromptActions = validateAndNormalizeStagePromptActions(
    input?.stagePromptActions,
    parsedStageDefinitions
  );
  const stageReviewPolicies = validateAndNormalizeStageReviewPolicies(
    input?.stageReviewPolicies,
    parsedStageDefinitions
  );
  const mergedStageDefinitions = mergeStageDefinitionsWithPromptActions(
    parsedStageDefinitions,
    stagePromptActions
  );
  const mergedStageDefinitionsWithPolicies = mergeStageDefinitionsWithReviewPolicies(
    mergedStageDefinitions,
    stageReviewPolicies
  );
  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy: {
      sourceLocale: input?.sourceLocale,
      defaultLocale: input?.defaultLocale,
      supportedLocales: splitInlineList(input?.supportedLocales),
      requiredLocales: splitInlineList(input?.requiredLocales)
    },
    stageDefinitions: mergedStageDefinitionsWithPolicies,
    templates: []
  });

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  const aiProvider = normalizeBoardAiProvider(input?.aiProvider) ?? BOARD_AI_PROVIDER_OPENAI;
  const openAiApiKey = normalizeOptionalSecret(input?.openAiApiKey);
  const clearOpenAiApiKey = input?.clearOpenAiApiKey === true;
  const localizationGlossary = normalizeBoardLocalizationGlossary(
    parseLocalizationGlossary(input?.localizationGlossary),
    {
      supportedLocales: normalizedSchema.languagePolicy.supportedLocales
    }
  );

  return {
    title,
    languagePolicy: normalizedSchema.languagePolicy,
    stageDefinitions: normalizedSchema.stageDefinitions,
    templates: [],
    localizationGlossary,
    aiProvider,
    ...(openAiApiKey ? { openAiApiKey } : {}),
    clearOpenAiApiKey
  };
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

function normalizeOptionalSecret(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function parseLocalizationGlossary(rawValue) {
  const lines = splitMultilineInput(rawValue);

  if (lines.length < 1) {
    return [];
  }

  return lines.map((line) => {
    const segments = splitStagePipeSegments(line);

    if (segments.length < 2) {
      throw new Error('Each glossary line must use "Source term | locale=value | locale=value".');
    }

    const translations = {};

    for (const translationSegment of segments.slice(1)) {
      const separatorIndex = translationSegment.indexOf('=');

      if (separatorIndex <= 0 || separatorIndex === translationSegment.length - 1) {
        throw new Error('Each glossary line must use "Source term | locale=value | locale=value".');
      }

      const locale = translationSegment.slice(0, separatorIndex).trim();
      const translation = translationSegment.slice(separatorIndex + 1).trim();

      if (!locale || !translation || Object.prototype.hasOwnProperty.call(translations, locale)) {
        throw new Error('Each glossary line must use "Source term | locale=value | locale=value".');
      }

      translations[locale] = translation;
    }

    return {
      source: segments[0],
      translations
    };
  });
}

function serializeLocalizationGlossary(localizationGlossary) {
  return localizationGlossary
    .map((entry) => {
      const translations = Object.entries(entry.translations)
        .map(([locale, value]) => `${locale}=${value}`)
        .join(' | ');

      return `${entry.source} | ${translations}`;
    })
    .join('\n');
}
