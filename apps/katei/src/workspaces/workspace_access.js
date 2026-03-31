import { canonicalizeBoardRole, listPendingBoardInvites } from '../../public/js/domain/board_collaboration.js';

export function canViewerAccessWorkspace({ viewerSub, viewerEmail = null, ownerSub, workspace }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const normalizedOwnerSub = normalizeOptionalString(ownerSub);

  if (!normalizedViewerSub) {
    return false;
  }

  if (normalizedOwnerSub && normalizedOwnerSub === normalizedViewerSub) {
    return true;
  }

  if (!isPlainObject(workspace?.boards)) {
    return false;
  }

  for (const board of Object.values(workspace.boards)) {
    if (hasHumanBoardMembership(board, normalizedViewerSub) || hasPendingBoardInvite(board, normalizedViewerSub, normalizedViewerEmail)) {
      return true;
    }
  }

  return false;
}

function hasHumanBoardMembership(board, viewerSub) {
  for (const membership of readBoardMemberships(board)) {
    const actorType = normalizeOptionalString(membership?.actor?.type).toLowerCase();
    const actorId = normalizeOptionalString(membership?.actor?.id);

    if (actorType !== 'human' || actorId !== viewerSub) {
      continue;
    }

    if (canonicalizeBoardRole(membership?.role)) {
      return true;
    }
  }

  return false;
}

function hasPendingBoardInvite(board, viewerSub, viewerEmail) {
  for (const invite of listPendingBoardInvites(board)) {
    const inviteActorType = normalizeOptionalString(invite?.actor?.type).toLowerCase();
    const inviteActorId = normalizeOptionalString(invite?.actor?.id);
    const inviteEmail = normalizeOptionalEmail(invite?.email);

    if (inviteActorType === 'human' && inviteActorId === viewerSub) {
      return true;
    }

    if (viewerEmail && inviteEmail && inviteEmail === viewerEmail) {
      return true;
    }
  }

  return false;
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

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue.includes('@') ? normalizedValue : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
