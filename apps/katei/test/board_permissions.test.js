import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canActorAdminBoard,
  canActorEditBoard,
  canActorReadBoard,
  getBoardMembershipForActor
} from '../public/js/domain/board_permissions.js';

test('board permission helpers derive admin, editor, and viewer capabilities from memberships', () => {
  const board = {
    memberships: [
      {
        actor: { type: 'human', id: 'viewer_admin' },
        role: 'admin'
      },
      {
        actor: { type: 'human', id: 'viewer_editor' },
        role: 'editor'
      },
      {
        actor: { type: 'human', id: 'viewer_viewer' },
        role: 'viewer'
      }
    ]
  };

  assert.deepEqual(
    getBoardMembershipForActor(board, { type: 'human', id: 'viewer_editor' }),
    {
      actor: { type: 'human', id: 'viewer_editor' },
      role: 'editor'
    }
  );

  assert.equal(canActorReadBoard(board, { type: 'human', id: 'viewer_admin' }), true);
  assert.equal(canActorEditBoard(board, { type: 'human', id: 'viewer_admin' }), true);
  assert.equal(canActorAdminBoard(board, { type: 'human', id: 'viewer_admin' }), true);

  assert.equal(canActorReadBoard(board, { type: 'human', id: 'viewer_editor' }), true);
  assert.equal(canActorEditBoard(board, { type: 'human', id: 'viewer_editor' }), true);
  assert.equal(canActorAdminBoard(board, { type: 'human', id: 'viewer_editor' }), false);

  assert.equal(canActorReadBoard(board, { type: 'human', id: 'viewer_viewer' }), true);
  assert.equal(canActorEditBoard(board, { type: 'human', id: 'viewer_viewer' }), false);
  assert.equal(canActorAdminBoard(board, { type: 'human', id: 'viewer_viewer' }), false);

  assert.equal(canActorReadBoard(board, { type: 'human', id: 'viewer_missing' }), false);
  assert.equal(canActorEditBoard(board, { type: 'human', id: 'viewer_missing' }), false);
  assert.equal(canActorAdminBoard(board, { type: 'human', id: 'viewer_missing' }), false);
});
