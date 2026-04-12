import {
  canonicalizeBoardRole,
  createBoardActorKey,
  normalizeBoardMembership
} from './board_collaboration.js';
import { stageSupportsAction } from './board_stage_actions.js';
import { getBoardStageReviewPolicy } from './board_stage_review_policy.js';

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

export function canActorApproveCardReview(board, actor, stageId) {
  const membership = getBoardMembershipForActor(board, actor);

  if (!membership) {
    return false;
  }

  return canBoardRoleApproveCardReview(board, membership, stageId);
}

export function canBoardRoleApproveCardReview(board, roleOrMembership, stageId) {
  const reviewerThreshold = resolveCardReviewReviewerThreshold(board, stageId);

  if (!reviewerThreshold) {
    return false;
  }

  switch (reviewerThreshold) {
    case 'admin':
      return isBoardAdminMembership(roleOrMembership);
    case 'editor':
      return isBoardEditorLikeRole(roleOrMembership);
    default:
      return false;
  }
}

export function isBoardAdminMembership(roleOrMembership) {
  return canonicalizeBoardRole(
    typeof roleOrMembership === 'string' ? roleOrMembership : roleOrMembership?.role
  ) === 'admin';
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

function resolveCardReviewReviewerThreshold(board, stageId) {
  const normalizedStageId = typeof stageId === 'string' ? stageId.trim() : '';
  const hasExplicitReviewPolicy = Boolean(
    normalizedStageId &&
      board?.stages?.[normalizedStageId] &&
      board.stages[normalizedStageId].reviewPolicy != null
  );

  if (!normalizedStageId || !board?.stages?.[normalizedStageId]) {
    return null;
  }

  if (!stageSupportsAction(board, normalizedStageId, 'card.review')) {
    return null;
  }

  const reviewPolicy = getBoardStageReviewPolicy(board, normalizedStageId);

  if (hasExplicitReviewPolicy && !reviewPolicy) {
    return null;
  }

  return reviewPolicy?.approverRole ?? 'editor';
}
