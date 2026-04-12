import { canonicalizeBoardRole, normalizeBoardActor } from './board_collaboration.js';

export const CARD_WORKFLOW_REVIEW_STATUSES = Object.freeze(['pending', 'approved', 'rejected']);

const CARD_WORKFLOW_REVIEW_FIELDS = Object.freeze([
  'required',
  'currentStageId',
  'status',
  'decidedAt',
  'decidedBy',
  'decidedByRole'
]);

export function createCardWorkflowReview({
  required = false,
  currentStageId = null,
  status = undefined,
  decidedAt = null,
  decidedBy = null,
  decidedByRole = null
} = {}) {
  const normalizedRequired = required === true;
  const normalizedCurrentStageId = normalizedRequired ? normalizeOptionalString(currentStageId) || null : null;
  const normalizedReview = normalizeCardWorkflowReview({
    required: normalizedRequired,
    currentStageId: normalizedCurrentStageId,
    status: normalizedRequired
      ? (status === undefined ? (normalizedCurrentStageId ? 'pending' : null) : status)
      : null,
    decidedAt: normalizedRequired ? decidedAt : null,
    decidedBy: normalizedRequired ? decidedBy : null,
    decidedByRole: normalizedRequired ? decidedByRole : null
  });

  if (normalizedReview) {
    return normalizedReview;
  }

  return {
    required: normalizedRequired,
    currentStageId: normalizedCurrentStageId,
    status: normalizedRequired && normalizedCurrentStageId ? 'pending' : null,
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  };
}

export function resetCardWorkflowReview(value, { currentStageId = null } = {}) {
  const normalizedValue = normalizeCardWorkflowReview(value);

  return createCardWorkflowReview({
    required: normalizedValue?.required === true,
    currentStageId: normalizedValue?.required === true ? currentStageId : null
  });
}

export function normalizeCardWorkflowReview(value, { validStageIds = null } = {}) {
  if (!isPlainObject(value) || !hasExpectedShape(value)) {
    return null;
  }

  const required = normalizeRequiredFlag(value.required);
  const currentStageId = normalizeOptionalString(value.currentStageId) || null;
  const status = canonicalizeCardWorkflowReviewStatus(value.status);
  const decidedAt = normalizeOptionalIsoTimestamp(value.decidedAt);
  const decidedBy = value.decidedBy == null ? null : normalizeBoardActor(value.decidedBy);
  const decidedByRole =
    value.decidedByRole == null ? null : canonicalizeCardWorkflowReviewDecisionRole(value.decidedByRole);

  if (
    required == null ||
    (value.currentStageId != null && !currentStageId) ||
    (value.status != null && !status) ||
    (value.decidedAt != null && !decidedAt) ||
    (value.decidedBy != null && !decidedBy) ||
    (value.decidedByRole != null && !decidedByRole)
  ) {
    return null;
  }

  if (!required) {
    if (currentStageId || status || decidedAt || decidedBy || decidedByRole) {
      return null;
    }

    return createBaseCardWorkflowReview(false);
  }

  if (currentStageId && validStageIds instanceof Set && !validStageIds.has(currentStageId)) {
    return null;
  }

  if (!currentStageId) {
    if (status || decidedAt || decidedBy || decidedByRole) {
      return null;
    }

    return createBaseCardWorkflowReview(true);
  }

  if (status == null || status === 'pending') {
    if (decidedAt || decidedBy || decidedByRole) {
      return null;
    }

    return {
      required: true,
      currentStageId,
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      decidedByRole: null
    };
  }

  if (!decidedAt || !decidedBy || !decidedByRole) {
    return null;
  }

  return {
    required: true,
    currentStageId,
    status,
    decidedAt,
    decidedBy,
    decidedByRole
  };
}

export function validateCardWorkflowReview(card, { validStageIds = null } = {}) {
  if (card?.workflowReview == null) {
    return true;
  }

  return normalizeCardWorkflowReview(card.workflowReview, { validStageIds }) !== null;
}

function createBaseCardWorkflowReview(required) {
  return {
    required,
    currentStageId: null,
    status: null,
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  };
}

function normalizeRequiredFlag(value) {
  if (value === true) {
    return true;
  }

  if (value === false) {
    return false;
  }

  return null;
}

function canonicalizeCardWorkflowReviewStatus(value) {
  const normalizedStatus = normalizeOptionalString(value).toLowerCase();
  return CARD_WORKFLOW_REVIEW_STATUSES.includes(normalizedStatus) ? normalizedStatus : null;
}

function canonicalizeCardWorkflowReviewDecisionRole(value) {
  const normalizedRole = canonicalizeBoardRole(value);
  return normalizedRole === 'admin' || normalizedRole === 'editor' ? normalizedRole : null;
}

function normalizeOptionalIsoTimestamp(value) {
  if (value == null) {
    return null;
  }

  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    return null;
  }

  const timestamp = new Date(normalizedValue);

  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function hasExpectedShape(value) {
  return CARD_WORKFLOW_REVIEW_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
