import { randomUUID } from 'node:crypto';

export function createMutationContext({
  actor = null,
  viewerIsSuperAdmin = false,
  now = new Date().toISOString(),
  createBoardId = createDefaultBoardId,
  createCardId = createDefaultCardId,
  boardSecretEncryptionKey = null,
  debugLog = null,
  acceptDebugLog = null
} = {}) {
  return {
    actor: normalizeMutationActor(actor),
    viewerIsSuperAdmin: normalizeOptionalBoolean(viewerIsSuperAdmin),
    now: normalizeIsoTimestamp(now, 'now'),
    createBoardId: normalizeFactory(createBoardId, 'createBoardId'),
    createCardId: normalizeFactory(createCardId, 'createCardId'),
    boardSecretEncryptionKey: normalizeOptionalStringValue(
      boardSecretEncryptionKey,
      'Mutation context boardSecretEncryptionKey'
    ),
    debugLog: normalizeOptionalDebugLog(debugLog),
    acceptDebugLog: normalizeOptionalDebugLog(acceptDebugLog)
  };
}

export function createDefaultMutationContext({
  actor = null,
  viewerIsSuperAdmin = false,
  boardSecretEncryptionKey = null,
  debugLog = null,
  acceptDebugLog = null
} = {}) {
  return createMutationContext({
    actor,
    viewerIsSuperAdmin,
    boardSecretEncryptionKey,
    debugLog,
    acceptDebugLog
  });
}

export function createDefaultBoardId() {
  return `board_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function createDefaultCardId() {
  return `card_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function normalizeMutationActor(actor) {
  if (actor == null) {
    return null;
  }

  if (typeof actor !== 'object' || Array.isArray(actor)) {
    throw new Error('Mutation context actor must be an object or null.');
  }

  const normalizedType = normalizeRequiredString(actor.type, 'Mutation context actor.type is required.');
  const normalizedId = normalizeRequiredString(actor.id, 'Mutation context actor.id is required.');
  const normalizedEmail = normalizeOptionalEmail(actor.email);
  const normalizedName = normalizeOptionalMetadataField(actor.name, 'Mutation context actor.name');

  if (!['human', 'agent', 'system'].includes(normalizedType)) {
    throw new Error(`Unsupported mutation context actor.type: ${normalizedType}`);
  }

  return {
    type: normalizedType,
    id: normalizedId,
    ...(normalizedEmail ? { email: normalizedEmail } : {}),
    ...(normalizedName ? { name: normalizedName } : {})
  };
}

function normalizeFactory(factory, fieldName) {
  if (typeof factory !== 'function') {
    throw new Error(`Mutation context ${fieldName} must be a function.`);
  }

  return factory;
}

function normalizeIsoTimestamp(value, fieldName) {
  const normalizedValue = normalizeRequiredString(value, `Mutation context ${fieldName} is required.`);
  const timestamp = new Date(normalizedValue);

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error(`Mutation context ${fieldName} must be an ISO timestamp.`);
  }

  return timestamp.toISOString();
}

function normalizeRequiredString(value, errorMessage) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function normalizeOptionalMetadataField(value, fieldName) {
  if (value == null) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string when provided.`);
  }

  return value.trim();
}

function normalizeOptionalStringValue(value, fieldName) {
  if (value == null) {
    return '';
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string when provided.`);
  }

  return value.trim();
}

function normalizeOptionalEmail(value) {
  const normalizedEmail = normalizeOptionalMetadataField(value, 'Mutation context actor.email');

  if (!normalizedEmail) {
    return '';
  }

  if (!normalizedEmail.includes('@')) {
    throw new Error('Mutation context actor.email must be a valid email when provided.');
  }

  return normalizedEmail;
}

function normalizeOptionalDebugLog(value) {
  if (value == null) {
    return null;
  }

  if (typeof value !== 'function') {
    throw new Error('Mutation context debugLog must be a function when provided.');
  }

  return value;
}

function normalizeOptionalBoolean(value) {
  return value === true;
}
