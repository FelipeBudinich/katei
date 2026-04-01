import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace.js';
import { buildInviteResponseDebugFields } from '../src/lib/invite_debug.js';

test('buildInviteResponseDebugFields summarizes projected workspace and pending workspace invite visibility', () => {
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared_invites',
    creator: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    }
  });

  workspace.boards.main.collaboration.invites.push({
    id: 'invite_main_1',
    actor: { type: 'human', id: 'sub_invited' },
    email: 'invitee@example.com',
    role: 'viewer',
    status: 'pending',
    invitedBy: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    },
    invitedAt: '2026-04-02T10:20:00.000Z'
  });

  const summary = buildInviteResponseDebugFields({
    route: 'GET /boards',
    viewer: {
      sub: 'sub_invited',
      email: 'invitee@example.com'
    },
    workspace,
    activeWorkspace: {
      workspaceId: 'workspace_shared_invites',
      isHomeWorkspace: false
    },
    pendingWorkspaceInvites: [
      {
        workspaceId: 'workspace_shared_invites',
        boardId: 'main',
        boardTitle: 'Main',
        inviteId: 'invite_main_1',
        role: 'viewer',
        invitedAt: '2026-04-02T10:20:00.000Z',
        invitedBy: {
          id: 'sub_owner',
          email: 'owner@example.com',
          displayName: null
        }
      },
      {
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        boardTitle: 'Casa',
        inviteId: 'invite_casa_1',
        role: 'editor',
        invitedAt: '2026-04-02T10:30:00.000Z',
        invitedBy: {
          id: 'sub_owner_casa',
          email: 'owner-casa@example.com',
          displayName: 'Casa owner'
        }
      }
    ]
  });

  assert.deepEqual(summary.pendingWorkspaceInviteIds, ['invite_main_1', 'invite_casa_1']);
  assert.deepEqual(summary.projectedBoardIds, ['main']);
  assert.deepEqual(summary.projectedBoardInviteIdsByBoard, {
    main: ['invite_main_1']
  });
  assert.deepEqual(summary.matchedWorkspaceInviteIds, [
    'workspace_shared_invites:main:invite_main_1'
  ]);
  assert.deepEqual(summary.matchedSummaryInviteIds, [
    'workspace_shared_invites:main:invite_main_1',
    'workspace_invited_casa:casa:invite_casa_1'
  ]);
  assert.equal(summary.matchedInvitePresentInWorkspace, true);
  assert.equal(summary.matchedInvitePresentInSummary, true);
});
