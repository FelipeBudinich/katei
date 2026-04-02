import { BOARD_AI_PROVIDER_OPENAI } from '../../public/js/domain/board_ai_localization.js';
import { canonicalizeContentLocale } from '../../public/js/domain/board_language_policy.js';
import { getStoredCardContentVariant } from '../../public/js/domain/card_localization.js';

export const DEFAULT_OPENAI_LOCALIZATION_MODEL = 'gpt-5.4-mini';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const LOCALIZATION_SCHEMA_NAME = 'card_localization';
const LOCALIZATION_ACTOR_ID = 'openai-localizer';

const LOCALIZATION_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    title: {
      type: 'string'
    },
    detailsMarkdown: {
      type: 'string'
    }
  },
  required: ['title', 'detailsMarkdown'],
  additionalProperties: false
});

export class OpenAiLocalizerError extends Error {
  constructor(message, { code = 'OPENAI_LOCALIZER_ERROR', status = 500, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OpenAiLocalizerError';
    this.code = code;
    this.status = status;
  }
}

export function createOpenAiLocalizer({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  model = DEFAULT_OPENAI_LOCALIZATION_MODEL
} = {}) {
  const resolvedFetch = resolveFetch(fetchImpl);
  const resolvedModel = normalizeRequiredString(model, 'OpenAI localization model is required.');

  return {
    async generateLocalization(options) {
      return generateLocalization(options, {
        fetchImpl: resolvedFetch,
        model: resolvedModel
      });
    }
  };
}

export async function generateLocalization(
  {
    apiKey,
    board,
    card,
    sourceLocale,
    targetLocale
  } = {},
  {
    fetchImpl = globalThis.fetch?.bind(globalThis),
    model = DEFAULT_OPENAI_LOCALIZATION_MODEL
  } = {}
) {
  const resolvedFetch = resolveFetch(fetchImpl);
  const normalizedModel = normalizeRequiredString(model, 'OpenAI localization model is required.');
  const request = normalizeLocalizationRequest({
    apiKey,
    board,
    card,
    sourceLocale,
    targetLocale
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
            name: LOCALIZATION_SCHEMA_NAME,
            schema: LOCALIZATION_RESPONSE_SCHEMA,
            strict: true
          }
        }
      })
    });
  } catch (error) {
    throw new OpenAiLocalizerError('Unable to reach OpenAI for localization.', {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502,
      cause: error
    });
  }

  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw new OpenAiLocalizerError(readOpenAiErrorMessage(payload), {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502
    });
  }

  const outputText = readOutputText(payload);
  let parsedOutput = null;

  try {
    parsedOutput = JSON.parse(outputText);
  } catch (error) {
    throw new OpenAiLocalizerError('OpenAI returned an invalid localization payload.', {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502,
      cause: error
    });
  }

  const title = normalizeRequiredString(
    parsedOutput?.title,
    'OpenAI returned an empty localized title.'
  );

  return {
    provider: BOARD_AI_PROVIDER_OPENAI,
    actor: {
      type: 'agent',
      id: LOCALIZATION_ACTOR_ID
    },
    sourceLocale: request.sourceLocale,
    targetLocale: request.targetLocale,
    title,
    detailsMarkdown: normalizeOptionalString(parsedOutput?.detailsMarkdown),
    model: normalizedModel
  };
}

function normalizeLocalizationRequest({
  apiKey,
  board,
  card,
  sourceLocale,
  targetLocale
} = {}) {
  const normalizedApiKey = normalizeRequiredString(apiKey, 'OpenAI API key is required.');
  const normalizedSourceLocale = canonicalizeRequiredLocale(sourceLocale, 'Source locale is invalid.');
  const normalizedTargetLocale = canonicalizeRequiredLocale(targetLocale, 'Target locale is invalid.');
  const sourceVariant = getStoredCardContentVariant(card, normalizedSourceLocale);

  if (!hasVariantContent(sourceVariant)) {
    throw new OpenAiLocalizerError('Source locale content is required before generating a localization.', {
      code: 'SOURCE_LOCALE_MISSING',
      status: 400
    });
  }

  return {
    apiKey: normalizedApiKey,
    boardTitle: normalizeOptionalString(board?.title),
    supportedLocales:
      Array.isArray(board?.languagePolicy?.supportedLocales)
        ? board.languagePolicy.supportedLocales
            .map((locale) => canonicalizeContentLocale(locale))
            .filter(Boolean)
        : [],
    priority: normalizeOptionalString(card?.priority),
    sourceLocale: normalizedSourceLocale,
    targetLocale: normalizedTargetLocale,
    sourceTitle: sourceVariant.title,
    sourceDetailsMarkdown: normalizeOptionalString(sourceVariant.detailsMarkdown)
  };
}

function createSystemPrompt() {
  return [
    'You localize kanban board card content.',
    'Translate faithfully into the requested target locale.',
    'Preserve markdown structure, list structure, links, and emphasis.',
    'Do not add explanations, notes, or code fences.',
    'Return only the JSON object that matches the provided schema.'
  ].join(' ');
}

function createUserPrompt(request) {
  return [
    'Localize the following board card content.',
    '',
    `Board title: ${request.boardTitle || '(untitled board)'}`,
    `Card priority: ${request.priority || '(none)'}`,
    `Source locale: ${request.sourceLocale}`,
    `Target locale: ${request.targetLocale}`,
    `Supported locales on this board: ${request.supportedLocales.join(', ') || '(unknown)'}`,
    '',
    'Requirements:',
    '- Translate only the provided card content.',
    '- Preserve markdown formatting and meaning.',
    '- Keep detailsMarkdown as an empty string when the source details are empty.',
    '- Do not invent metadata or commentary.',
    '',
    'Source title:',
    request.sourceTitle,
    '',
    'Source detailsMarkdown:',
    request.sourceDetailsMarkdown || '(empty)'
  ].join('\n');
}

async function parseJsonResponse(response) {
  if (!response || typeof response.json !== 'function') {
    throw new OpenAiLocalizerError('OpenAI returned an invalid HTTP response.', {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502
    });
  }

  try {
    return await response.json();
  } catch (error) {
    throw new OpenAiLocalizerError('OpenAI returned an unreadable JSON response.', {
      code: 'OPENAI_UPSTREAM_ERROR',
      status: 502,
      cause: error
    });
  }
}

function readOutputText(payload) {
  const directOutputText = normalizeOptionalString(payload?.output_text);

  if (directOutputText) {
    return directOutputText;
  }

  const outputItems = Array.isArray(payload?.output) ? payload.output : [];

  for (const outputItem of outputItems) {
    const contentItems = Array.isArray(outputItem?.content) ? outputItem.content : [];

    for (const contentItem of contentItems) {
      const contentText = normalizeOptionalString(contentItem?.text);

      if (contentText) {
        return contentText;
      }
    }
  }

  throw new OpenAiLocalizerError('OpenAI did not return a localization payload.', {
    code: 'OPENAI_UPSTREAM_ERROR',
    status: 502
  });
}

function readOpenAiErrorMessage(payload) {
  const message = normalizeOptionalString(payload?.error?.message);
  return message || 'OpenAI could not generate the localization.';
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for OpenAI localization.');
  }

  return fetchImpl;
}

function canonicalizeRequiredLocale(locale, errorMessage) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new OpenAiLocalizerError(errorMessage, {
      code: 'OPENAI_LOCALIZER_INPUT_INVALID',
      status: 400
    });
  }

  return normalizedLocale;
}

function hasVariantContent(variant) {
  const title = normalizeOptionalString(variant?.title);
  const detailsMarkdown = normalizeOptionalString(variant?.detailsMarkdown);
  return Boolean(title || detailsMarkdown);
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new OpenAiLocalizerError(errorMessage, {
      code: 'OPENAI_LOCALIZER_INPUT_INVALID',
      status: 400
    });
  }

  return normalizedValue;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
