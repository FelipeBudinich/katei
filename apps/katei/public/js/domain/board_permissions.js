import {
  canonicalizeBoardRole,
  createBoardActorKey,
  normalizeBoardMembership
} from './board_collaboration.js';

export function getBoardMembershipForActor(board, actor) {
  const actorKey = createBoardActorKey(actor);

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

export function requireBoardMembershipForActor(board, actor) {
  const membership = getBoardMembershipForActor(board, actor);

  if (!membership) {
    throw new Error('Board access denied.');
  }

  return membership;
}

export function canActorReadBoard(board, actor) {
  const membership = getBoardMembershipForActor(board, actor);
  return membership != null;
}

export function canActorEditBoard(board, actor) {
  return isBoardEditorLikeRole(getBoardMembershipForActor(board, actor));
}

export function canActorAdminBoard(board, actor) {
  return isBoardAdminMembership(getBoardMembershipForActor(board, actor));
}

export function isBoardAdminMembership(membership) {
  return canonicalizeBoardRole(membership?.role) === 'admin';
}

export function isBoardEditorLikeRole(roleOrMembership) {
  const role = canonicalizeBoardRole(
    typeof roleOrMembership === 'string' ? roleOrMembership : roleOrMembership?.role
  );

  return role === 'admin' || role === 'editor';
}

function stripActorKey(membership) {
  const normalizedMembership = {
    ...membership
  };

  delete normalizedMembership.actorKey;

  return normalizedMembership;
}

function readBoardMemberships(board) {
  if (Array.isArray(board?.collaboration?.memberships)) {
    return board.collaboration.memberships;
  }

  if (Array.isArray(board?.memberships)) {
    return board.memberships;
  }

  return [];
}
