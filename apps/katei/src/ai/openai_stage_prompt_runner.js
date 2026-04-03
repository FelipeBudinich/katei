import { BOARD_AI_PROVIDER_OPENAI } from '../../public/js/domain/board_ai_localization.js';
import { normalizePriority } from '../../public/js/domain/workspace_validation.js';
import { getStoredCardContentVariant } from '../../public/js/domain/card_localization.js';

export const DEFAULT_OPENAI_STAGE_PROMPT_MODEL = 'gpt-5.4-mini';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const STAGE_PROMPT_SCHEMA_NAME = 'stage_prompt_card';
const STAGE_PROMPT_ACTOR_ID = 'openai-stage-prompt-runner';

const STAGE_PROMPT_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: {
      type: 'string'
    },
    detailsMarkdown: {
      type: 'string'
    },
    priority: {
      type: 'string'
    }
  },
  required: ['title', 'detailsMarkdown'],
  additionalProperties: false
});

export class OpenAiStagePromptRunnerError extends Error {
  constructor(message, { code = 'OPENAI_STAGE_PROMPT_ERROR', status = 500, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OpenAiStagePromptRunnerError';
    this.code = code;
    this.status = status;
  }
}

export function createOpenAiStagePromptRunner({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  model = DEFAULT_OPENAI_STAGE_PROMPT_MODEL
} = {}) {
  const resolvedFetch = resolveFetch(fetchImpl);
  const resolvedModel = normalizeRequiredString(model, 'OpenAI stage prompt model is required.');

  return {
    async runStagePrompt(options) {
      return runStagePrompt(options, {
        fetchImpl: resolvedFetch,
        model: resolvedModel
      });
    }
  };
}

export async function runStagePrompt(
  {
    apiKey,
    board,
    card,
    sourceLocale,
    stageId,
    promptAction
  } = {},
  {
    fetchImpl = globalThis.fetch?.bind(globalThis),
    model = DEFAULT_OPENAI_STAGE_PROMPT_MODEL
  } = {}
) {
  const resolvedFetch = resolveFetch(fetchImpl);
  const normalizedModel = normalizeRequiredString(model, 'OpenAI stage prompt model is required.');
  const request = normalizeStagePromptRequest({
    apiKey,
    board,
    card,
    sourceLocale,
    stageId,
    promptAction
  });

  let response = null;

  try {
    response = await resolvedFetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: normalizedModel,
        input: [
          {
            role: 'system',
            content: createSystemPrompt()
          },
          {
            role: 'user',
            content: createUserPrompt(request)
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: STAGE_PROMPT_SCHEMA_NAME,
            schema: STAGE_PROMPT_RESPONSE_SCHEMA,
            strict: true
          }
        }
      })
    });
  } catch (error) {
    throw new OpenAiStagePromptRunnerError('Unable to reach OpenAI for stage prompt generation.', {
      code: 'STAGE_PROMPT_RUN_FAILED',
      status: 502,
      cause: error
    });
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new OpenAiStagePromptRunnerError(readOpenAiErrorMessage(payload), {
      code: 'STAGE_PROMPT_RUN_FAILED',
      status: 502
    });
  }

  const outputText = readOutputText(payload);
  let parsedOutput = null;

  try {
    parsedOutput = JSON.parse(outputText);
  } catch (error) {
    throw new OpenAiStagePromptRunnerError('OpenAI returned an invalid stage prompt payload.', {
      code: 'STAGE_PROMPT_OUTPUT_INVALID',
      status: 502,
      cause: error
    });
  }

  const title = normalizeRequiredString(parsedOutput?.title, 'Generated card title is required.');
  const detailsMarkdown = normalizeOptionalString(parsedOutput?.detailsMarkdown);
  const priority = normalizeOptionalPriority(parsedOutput?.priority);

  return {
    provider: BOARD_AI_PROVIDER_OPENAI,
    actor: {
      type: 'agent',
      id: STAGE_PROMPT_ACTOR_ID
    },
    sourceLocale: request.sourceLocale,
    sourceStageId: request.sourceStageId,
    targetStageId: request.targetStageId,
    title,
    detailsMarkdown,
    ...(priority ? { priority } : {}),
    model: normalizedModel
  };
}

function normalizeStagePromptRequest({
  apiKey,
  board,
  card,
  sourceLocale,
  stageId,
  promptAction
} = {}) {
  const normalizedApiKey = normalizeRequiredString(apiKey, 'OpenAI API key is required.');
  const normalizedSourceLocale = normalizeRequiredString(sourceLocale, 'Source locale is required.');
  const sourceVariant = getStoredCardContentVariant(card, normalizedSourceLocale);
  const normalizedPromptAction = promptAction && typeof promptAction === 'object' ? promptAction : null;
  const sourceStageId = normalizeRequiredString(stageId, 'Source stage id is required.');
  const targetStageId = normalizeRequiredString(
    normalizedPromptAction?.targetStageId,
    'Stage prompt action target stage is required.'
  );

  if (!sourceVariant?.title?.trim()) {
    throw new OpenAiStagePromptRunnerError('Source locale content is required before running a stage prompt.', {
      code: 'SOURCE_LOCALE_MISSING',
      status: 400
    });
  }

  return {
    apiKey: normalizedApiKey,
    boardTitle: normalizeOptionalString(board?.title),
    boardSourceLocale: normalizedSourceLocale,
    sourceStageId,
    sourceStageTitle: normalizeOptionalString(board?.stages?.[sourceStageId]?.title),
    targetStageId,
    targetStageTitle: normalizeOptionalString(board?.stages?.[targetStageId]?.title),
    prompt: normalizeRequiredString(normalizedPromptAction?.prompt, 'Stage prompt action prompt is required.'),
    sourceCardTitle: sourceVariant.title,
    sourceCardDetailsMarkdown: normalizeOptionalString(sourceVariant.detailsMarkdown),
    sourceCardPriority: normalizeOptionalString(card?.priority)
  };
}

function createSystemPrompt() {
  return [
    'You transform one kanban card into exactly one new kanban card.',
    'Follow the provided stage-specific instructions.',
    'Return only the JSON object that matches the schema.',
    'Do not add commentary, markdown fences, or extra keys.',
    'The output card must be ready to place in the requested target stage.'
  ].join(' ');
}

function createUserPrompt(request) {
  return [
    'Create one new board card from this source card.',
    '',
    `Board title: ${request.boardTitle || '(untitled board)'}`,
    `Board source locale: ${request.boardSourceLocale}`,
    `Source stage: ${request.sourceStageTitle || request.sourceStageId} (${request.sourceStageId})`,
    `Target stage: ${request.targetStageTitle || request.targetStageId} (${request.targetStageId})`,
    `Source card priority: ${request.sourceCardPriority || '(none)'}`,
    '',
    'Stage instructions:',
    request.prompt,
    '',
    'Requirements:',
    '- Produce exactly one new card.',
    '- Keep detailsMarkdown as an empty string when no details are needed.',
    '- Use the same source locale as the provided source card.',
    '- If you provide priority, it must be one of: urgent, important, normal.',
    '- Do not mention that the card was generated by AI.',
    '',
    'Source card title:',
    request.sourceCardTitle,
    '',
    'Source card detailsMarkdown:',
    request.sourceCardDetailsMarkdown || '(empty)'
  ].join('\n');
}

function normalizeOptionalPriority(value) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    return '';
  }

  try {
    return normalizePriority(normalizedValue);
  } catch (error) {
    throw new OpenAiStagePromptRunnerError('OpenAI returned an invalid card priority.', {
      code: 'STAGE_PROMPT_OUTPUT_INVALID',
      status: 502,
      cause: error
    });
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new OpenAiStagePromptRunnerError(errorMessage, {
      code: 'STAGE_PROMPT_OUTPUT_INVALID',
      status: 502
    });
  }

  return normalizedValue;
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for OpenAI stage prompt generation.');
  }

  return fetchImpl;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function readOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  for (const output of payload?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        return content.text;
      }
    }
  }

  throw new OpenAiStagePromptRunnerError('OpenAI did not return a stage prompt payload.', {
    code: 'STAGE_PROMPT_OUTPUT_INVALID',
    status: 502
  });
}

function readOpenAiErrorMessage(payload) {
  const message = normalizeOptionalString(payload?.error?.message);
  return message || 'OpenAI could not generate the stage prompt result.';
}
