import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardWorkflowReview,
  normalizeCardWorkflowReview,
  resetCardWorkflowReview,
  validateCardWorkflowReview
} from '../public/js/domain/card_workflow_review.js';

test('createCardWorkflowReview initializes optional and pending review states', () => {
  assert.deepEqual(createCardWorkflowReview(), {
    required: false,
    currentStageId: null,
    status: null,
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  });

  assert.deepEqual(createCardWorkflowReview({
    required: true,
    currentStageId: 'review'
  }), {
    required: true,
    currentStageId: 'review',
    status: 'pending',
    decidedAt: null,
    decidedBy: null,
    decidedByRole: null
  });
});

test('normalizeCardWorkflowReview accepts canonical pending and decided states', () => {
  assert.deepEqual(
    normalizeCardWorkflowReview(
      {
        required: true,
        currentStageId: 'review',
        status: 'pending',
        decidedAt: null,
        decidedBy: null,
        decidedByRole: null
      },
      {
        validStageIds: new Set(['review', 'done'])
      }
    ),
    {
      required: true,
      currentStageId: 'review',
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      decidedByRole: null
    }
  );

  assert.deepEqual(
    normalizeCardWorkflowReview(
      {
        required: true,
        currentStageId: 'review',
        status: 'approved',
        decidedAt: '2026-04-12T10:00:00.000Z',
        decidedBy: {
          type: 'human',
          id: 'viewer_123',
          email: 'viewer@example.com',
          displayName: 'Viewer'
        },
        decidedByRole: 'admin'
      },
      {
        validStageIds: new Set(['review', 'done'])
      }
    ),
    {
      required: true,
      currentStageId: 'review',
      status: 'approved',
      decidedAt: '2026-04-12T10:00:00.000Z',
      decidedBy: {
        type: 'human',
        id: 'viewer_123',
        email: 'viewer@example.com',
        displayName: 'Viewer'
      },
      decidedByRole: 'admin'
    }
  );
});

test('resetCardWorkflowReview clears decisions and validateCardWorkflowReview keeps the field optional', () => {
  assert.deepEqual(
    resetCardWorkflowReview({
      required: true,
      currentStageId: 'review',
      status: 'approved',
      decidedAt: '2026-04-12T10:00:00.000Z',
      decidedBy: {
        type: 'human',
        id: 'viewer_123'
      },
      decidedByRole: 'admin'
    }, {
      currentStageId: 'qa'
    }),
    {
      required: true,
      currentStageId: 'qa',
      status: 'pending',
      decidedAt: null,
      decidedBy: null,
      decidedByRole: null
    }
  );

  assert.equal(validateCardWorkflowReview({}, { validStageIds: new Set(['review']) }), true);
  assert.equal(
    validateCardWorkflowReview(
      {
        workflowReview: {
          required: true,
          currentStageId: 'missing',
          status: 'pending',
          decidedAt: null,
          decidedBy: null,
          decidedByRole: null
        }
      },
      { validStageIds: new Set(['review']) }
    ),
    false
  );
});
