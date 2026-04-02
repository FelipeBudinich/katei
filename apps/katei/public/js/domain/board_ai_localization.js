export const BOARD_AI_PROVIDER_OPENAI = 'openai';

export function createDefaultBoardAiLocalization() {
  return {
    provider: BOARD_AI_PROVIDER_OPENAI,
    hasApiKey: false,
    apiKeyLast4: null
  };
}

export function normalizeBoardAiLocalization(value) {
  if (!isPlainObject(value)) {
    return createDefaultBoardAiLocalization();
  }

  const provider = normalizeBoardAiProvider(value.provider) ?? BOARD_AI_PROVIDER_OPENAI;
  const hasApiKey = value.hasApiKey === true;
  const apiKeyLast4 = normalizeApiKeyLast4(value.apiKeyLast4);

  return {
    provider,
    hasApiKey,
    apiKeyLast4: hasApiKey ? apiKeyLast4 : null
  };
}

export function validateBoardAiLocalization(value) {
  if (value == null) {
    return true;
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (!normalizeBoardAiProvider(value.provider)) {
    return false;
  }

  if (typeof value.hasApiKey !== 'boolean') {
    return false;
  }

  if (value.apiKeyLast4 == null) {
    return true;
  }

  return normalizeApiKeyLast4(value.apiKeyLast4) === value.apiKeyLast4;
}

export function normalizeBoardAiProvider(value) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalizedValue === BOARD_AI_PROVIDER_OPENAI ? BOARD_AI_PROVIDER_OPENAI : null;
}

function normalizeApiKeyLast4(value) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    return null;
  }

  return /^[a-z0-9]{1,4}$/i.test(normalizedValue) ? normalizedValue : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
