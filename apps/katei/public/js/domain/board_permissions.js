import { canonicalizeBoardRole } from './board_collaboration.js';

export function getBoardMembershipForActor(board, actor) {
  const actorKey = createActorKey(actor);

  if (!actorKey) {
    return null;
  }

  for (const membership of readBoardMemberships(board)) {
    const normalizedMembership = normalizeBoardMembership(membership);

    if (normalizedMembership?.actorKey === actorKey) {
      return stripActorKey(normalizedMembership);
    }
  }

  return null;
}

export function canActorReadBoard(board, actor) {
  const membership = getBoardMembershipForActor(board, actor);
  return membership != null;
}

export function canActorEditBoard(board, actor) {
  const role = getBoardMembershipForActor(board, actor)?.role ?? null;
  return role === 'admin' || role === 'editor';
}

export function canActorAdminBoard(board, actor) {
  return getBoardMembershipForActor(board, actor)?.role === 'admin';
}

function normalizeBoardMembership(membership) {
  if (!isPlainObject(membership)) {
    return null;
  }

  const actor = normalizeActor(membership.actor);
  const role = canonicalizeBoardRole(membership.role);

  if (!actor || !role) {
    return null;
  }

  return {
    ...structuredClone(membership),
    actor,
    role,
    actorKey: createActorKey(actor)
  };
}

function stripActorKey(membership) {
  const normalizedMembership = {
    ...membership
  };

  delete normalizedMembership.actorKey;

  return normalizedMembership;
}

function readBoardMemberships(board) {
  if (Array.isArray(board?.memberships)) {
    return board.memberships;
  }

  if (Array.isArray(board?.collaboration?.memberships)) {
    return board.collaboration.memberships;
  }

  return [];
}

function normalizeActor(actor) {
  if (!isPlainObject(actor)) {
    return null;
  }

  const type = normalizeOptionalString(actor.type).toLowerCase();
  const id = normalizeOptionalString(actor.id);

  if (!['human', 'agent', 'system'].includes(type) || !id) {
    return null;
  }

  return { type, id };
}

function createActorKey(actor) {
  const normalizedActor = normalizeActor(actor);
  return normalizedActor ? `${normalizedActor.type}:${normalizedActor.id}` : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
