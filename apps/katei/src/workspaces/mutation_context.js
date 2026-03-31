import { randomUUID } from 'node:crypto';

export function createMutationContext({
  actor = null,
  now = new Date().toISOString(),
  createBoardId = createDefaultBoardId,
  createCardId = createDefaultCardId
} = {}) {
  return {
    actor: normalizeMutationActor(actor),
    now: normalizeIsoTimestamp(now, 'now'),
    createBoardId: normalizeFactory(createBoardId, 'createBoardId'),
    createCardId: normalizeFactory(createCardId, 'createCardId')
  };
}

export function createDefaultMutationContext({ actor = null } = {}) {
  return createMutationContext({ actor });
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

  if (!['human', 'agent', 'system'].includes(normalizedType)) {
    throw new Error(`Unsupported mutation context actor.type: ${normalizedType}`);
  }

  return {
    type: normalizedType,
    id: normalizedId
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
