import { canonicalizeBoardRole, normalizeBoardActor } from '../domain/board_collaboration.js';

export function createInviteMemberDetail({ boardId, email, role }) {
  return {
    boardId: normalizeRequiredString(boardId),
    email: normalizeRequiredString(email),
    role: canonicalizeBoardRole(role) ?? normalizeRequiredString(role).toLowerCase()
  };
}

export function createInviteDecisionDetail({ boardId, inviteId }) {
  return {
    boardId: normalizeRequiredString(boardId),
    inviteId: normalizeRequiredString(inviteId)
  };
}

export function createBoardMemberRoleChangeDetail({ boardId, targetActor, role }) {
  return {
    boardId: normalizeRequiredString(boardId),
    targetActor: normalizeRequiredActor(targetActor),
    role: canonicalizeBoardRole(role) ?? normalizeRequiredString(role).toLowerCase()
  };
}

export function createBoardMemberRemoveDetail({ boardId, targetActor }) {
  return {
    boardId: normalizeRequiredString(boardId),
    targetActor: normalizeRequiredActor(targetActor)
  };
}

export function createTargetActorFromDataset(dataset = {}) {
  return normalizeRequiredActor({
    type: dataset.actorType,
    id: dataset.actorId,
    email: dataset.actorEmail ?? null
  });
}

function normalizeRequiredActor(actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor) {
    throw new Error('Board collaborator target actor is required.');
  }

  return normalizedActor;
}

function normalizeRequiredString(value) {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';

  if (!normalizedValue) {
    throw new Error('Board collaborator detail is required.');
  }

  return normalizedValue;
}
