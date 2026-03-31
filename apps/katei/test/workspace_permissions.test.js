import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canActorAdminBoard,
  canActorEditBoard,
  canActorReadBoard
} from '../public/js/domain/board_permissions.js';

function createBoardWithMemberships() {
  return {
    collaboration: {
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
      ],
      invites: []
    }
  };
}

test('workspace permission helpers grant admin read, edit, and admin access', () => {
  const board = createBoardWithMemberships();
  const actor = { type: 'human', id: 'viewer_admin' };

  assert.equal(canActorReadBoard(board, actor), true);
  assert.equal(canActorEditBoard(board, actor), true);
  assert.equal(canActorAdminBoard(board, actor), true);
});

test('workspace permission helpers grant editor read and edit but not admin access', () => {
  const board = createBoardWithMemberships();
  const actor = { type: 'human', id: 'viewer_editor' };

  assert.equal(canActorReadBoard(board, actor), true);
  assert.equal(canActorEditBoard(board, actor), true);
  assert.equal(canActorAdminBoard(board, actor), false);
});

test('workspace permission helpers grant viewer read-only access', () => {
  const board = createBoardWithMemberships();
  const actor = { type: 'human', id: 'viewer_viewer' };

  assert.equal(canActorReadBoard(board, actor), true);
  assert.equal(canActorEditBoard(board, actor), false);
  assert.equal(canActorAdminBoard(board, actor), false);
});

test('workspace permission helpers deny non-members board access', () => {
  const board = createBoardWithMemberships();
  const actor = { type: 'human', id: 'viewer_missing' };

  assert.equal(canActorReadBoard(board, actor), false);
  assert.equal(canActorEditBoard(board, actor), false);
  assert.equal(canActorAdminBoard(board, actor), false);
});
