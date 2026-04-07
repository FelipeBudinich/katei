import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultBoardId,
  createDefaultCardId,
  createDefaultMutationContext,
  createMutationContext
} from '../src/workspaces/mutation_context.js';

test('createDefaultMutationContext returns the default server mutation context shape', () => {
  const context = createDefaultMutationContext({
    actor: {
      type: 'human',
      id: 'viewer_123',
      email: 'viewer@example.com',
      name: 'Viewer Name'
    },
    viewerIsSuperAdmin: true
  });

  assert.deepEqual(context.actor, {
    type: 'human',
    id: 'viewer_123',
    email: 'viewer@example.com',
    name: 'Viewer Name'
  });
  assert.equal(typeof context.now, 'string');
  assert.match(context.now, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof context.createBoardId, 'function');
  assert.equal(typeof context.createCardId, 'function');
  assert.equal(context.viewerIsSuperAdmin, true);
});

test('createMutationContext preserves an injected timestamp for one command application', () => {
  const context = createMutationContext({
    now: '2026-03-31T10:11:12.000Z'
  });

  assert.equal(context.now, '2026-03-31T10:11:12.000Z');
});

test('createMutationContext uses injected board and card id factories', () => {
  const context = createMutationContext({
    createBoardId: () => 'board_test123',
    createCardId: () => 'card_test456'
  });

  assert.equal(context.createBoardId(), 'board_test123');
  assert.equal(context.createCardId(), 'card_test456');
});

test('createMutationContext accepts null or populated actor values', () => {
  const nullActorContext = createMutationContext({
    actor: null
  });
  const systemActorContext = createMutationContext({
    actor: {
      type: 'system',
      id: 'seed-job',
      name: 'Seed Job'
    }
  });

  assert.equal(nullActorContext.actor, null);
  assert.equal(nullActorContext.viewerIsSuperAdmin, false);
  assert.deepEqual(systemActorContext.actor, {
    type: 'system',
    id: 'seed-job',
    name: 'Seed Job'
  });
});

test('default id factories follow current Katei id prefixes', () => {
  assert.match(createDefaultBoardId(), /^board_[a-f0-9]{12}$/);
  assert.match(createDefaultCardId(), /^card_[a-f0-9]{12}$/);
});

test('createMutationContext rejects unsupported actor types', () => {
  assert.throws(
    () =>
      createMutationContext({
        actor: {
          type: 'robot',
          id: 'r1'
        }
      }),
    /Unsupported mutation context actor\.type/
  );
});

test('createMutationContext rejects invalid optional actor email metadata', () => {
  assert.throws(
    () =>
      createMutationContext({
        actor: {
          type: 'human',
          id: 'viewer_123',
          email: 'not-an-email'
        }
      }),
    /Mutation context actor\.email must be a valid email when provided\./
  );
});
