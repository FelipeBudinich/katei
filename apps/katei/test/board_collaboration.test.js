import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeBoardRole,
  listPendingBoardInvites,
  validateBoardInvites,
  validateBoardMemberships
} from '../public/js/domain/board_collaboration.js';

test('canonicalizeBoardRole accepts supported board roles and rejects unknown roles', () => {
  assert.equal(canonicalizeBoardRole(' Admin '), 'admin');
  assert.equal(canonicalizeBoardRole('EDITOR'), 'editor');
  assert.equal(canonicalizeBoardRole('viewer'), 'viewer');
  assert.equal(canonicalizeBoardRole('owner'), null);
});

test('validateBoardMemberships accepts valid memberships and rejects invalid roles or duplicate actors', () => {
  assert.equal(
    validateBoardMemberships({
      memberships: [
        {
          actor: { type: 'human', id: 'viewer_admin' },
          role: 'admin',
          joinedAt: '2026-03-31T09:00:00.000Z'
        },
        {
          actor: { type: 'human', id: 'viewer_editor' },
          role: 'editor'
        },
        {
          actor: { type: 'agent', id: 'agent_viewer' },
          role: 'viewer'
        }
      ]
    }),
    true
  );

  assert.equal(
    validateBoardMemberships({
      memberships: [
        {
          actor: { type: 'human', id: 'viewer_admin' },
          role: 'owner'
        }
      ]
    }),
    false
  );

  assert.equal(
    validateBoardMemberships({
      memberships: [
        {
          actor: { type: 'human', id: 'viewer_admin' },
          role: 'admin'
        },
        {
          actor: { type: 'human', id: 'viewer_admin' },
          role: 'viewer'
        }
      ]
    }),
    false
  );
});

test('validateBoardInvites accepts valid invites and rejects invalid invite status or targets', () => {
  const board = {
    invites: [
      {
        id: 'invite_1',
        email: 'editor@example.com',
        role: 'editor',
        status: 'pending',
        invitedBy: { type: 'human', id: 'viewer_admin' },
        invitedAt: '2026-03-31T10:00:00.000Z'
      },
      {
        id: 'invite_2',
        actor: { type: 'human', id: 'viewer_viewer' },
        role: 'viewer',
        status: 'accepted'
      }
    ]
  };

  assert.equal(validateBoardInvites(board), true);
  assert.deepEqual(
    listPendingBoardInvites(board).map((invite) => invite.id),
    ['invite_1']
  );

  assert.equal(
    validateBoardInvites({
      invites: [
        {
          id: 'invite_1',
          email: 'editor@example.com',
          role: 'editor',
          status: 'open'
        }
      ]
    }),
    false
  );

  assert.equal(
    validateBoardInvites({
      invites: [
        {
          id: 'invite_1',
          role: 'viewer',
          status: 'pending'
        }
      ]
    }),
    false
  );
});
