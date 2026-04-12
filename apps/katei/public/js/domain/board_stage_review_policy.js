import { canonicalizeBoardRole } from './board_collaboration.js';
import { stageSupportsAction } from './board_stage_actions.js';

export const BOARD_STAGE_REVIEW_APPROVER_ROLES = Object.freeze(['editor', 'admin']);
export const DEFAULT_BOARD_STAGE_REVIEW_APPROVER_ROLE = 'editor';

export function normalizeBoardStageReviewPolicy(value) {
  if (value == null) {
    return null;
  }

  if (!isPlainObject(value)) {
    throw new Error('Stage review policy is invalid.');
  }

  const approverRole = canonicalizeBoardRole(value.approverRole);

  if (!BOARD_STAGE_REVIEW_APPROVER_ROLES.includes(approverRole)) {
    throw new Error('Stage review approver role must be "editor" or "admin".');
  }

  return {
    approverRole
  };
}

export function serializeBoardStageReviewPolicy(value) {
  const normalizedReviewPolicy = normalizeBoardStageReviewPolicy(value);
  return normalizedReviewPolicy ? structuredClone(normalizedReviewPolicy) : null;
}

export function getBoardStageReviewPolicy(board, stageId) {
  if (
    typeof stageId !== 'string'
    || !Array.isArray(board?.stageOrder)
    || !isPlainObject(board?.stages)
    || !board.stageOrder.includes(stageId)
    || !isPlainObject(board.stages[stageId])
    || !stageSupportsAction(board, stageId, 'card.review')
    || !Object.prototype.hasOwnProperty.call(board.stages[stageId], 'reviewPolicy')
  ) {
    return null;
  }

  try {
    return normalizeBoardStageReviewPolicy(board.stages[stageId].reviewPolicy);
  } catch (error) {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
