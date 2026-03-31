import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import {
  createBoardMemberRemoveDetail,
  createBoardMemberRoleChangeDetail,
  createInviteDecisionDetail,
  createInviteMemberDetail,
  createTargetActorFromDataset
} from '../public/js/controllers/board_collaborators_actions.js';
import { getBoardCollaborationState } from '../public/js/controllers/board_collaboration_state.js';

test('collaboration state gives admins invite controls and member management actions', () => {
  const { board, adminActor } = createCollaboratorBoardFixture();

  const state = getBoardCollaborationState(board, adminActor);
  const protectedAdmin = state.members.find((member) => member.actor.id === adminActor.id);
  const editorMember = state.members.find((member) => member.actor.id === 'editor_1');
  const viewerMember = state.members.find((member) => member.actor.id === 'viewer_1');

  assert.equal(state.canAdmin, true);
  assert.equal(protectedAdmin.canChangeRole, false);
  assert.equal(protectedAdmin.canRemove, false);
  assert.equal(editorMember.canChangeRole, true);
  assert.equal(editorMember.canRemove, true);
  assert.equal(viewerMember.canChangeRole, true);
  assert.equal(viewerMember.canRemove, true);
  assert.equal(state.pendingInvites.length, 2);
  assert.ok(state.pendingInvites.every((invite) => invite.canRevoke));
  assert.ok(state.pendingInvites.every((invite) => !invite.canRespond));
});

test('non-admin members do not receive admin-only controls and matching invitees can respond', () => {
  const { board, editorActor, inviteeActor } = createCollaboratorBoardFixture();

  const editorState = getBoardCollaborationState(board, editorActor);
  const inviteeState = getBoardCollaborationState(board, inviteeActor);

  assert.equal(editorState.canAdmin, false);
  assert.ok(editorState.members.every((member) => !member.canChangeRole));
  assert.ok(editorState.members.every((member) => !member.canRemove));
  assert.equal(editorState.pendingInvites.length, 0);

  assert.equal(inviteeState.currentRoleStatus, 'invited');
  assert.equal(inviteeState.pendingInvites.length, 1);
  assert.equal(inviteeState.pendingInvites[0].email, inviteeActor.email);
  assert.equal(inviteeState.pendingInvites[0].canRespond, true);
  assert.equal(inviteeState.pendingInvites[0].canRevoke, false);
});

test('collaborator action helpers emit deterministic payload shapes', () => {
  const targetActor = createTargetActorFromDataset({
    actorType: 'human',
    actorId: 'viewer_1',
    actorEmail: 'viewer@example.com'
  });

  assert.deepEqual(targetActor, {
    type: 'human',
    id: 'viewer_1',
    email: 'viewer@example.com'
  });
  assert.deepEqual(
    createInviteMemberDetail({
      boardId: 'main',
      email: 'invitee@example.com',
      role: ' Editor '
    }),
    {
      boardId: 'main',
      email: 'invitee@example.com',
      role: 'editor'
    }
  );
  assert.deepEqual(
    createInviteDecisionDetail({
      boardId: 'main',
      inviteId: 'invite_1'
    }),
    {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  );
  assert.deepEqual(
    createBoardMemberRoleChangeDetail({
      boardId: 'main',
      targetActor,
      role: 'Admin'
    }),
    {
      boardId: 'main',
      targetActor,
      role: 'admin'
    }
  );
  assert.deepEqual(
    createBoardMemberRemoveDetail({
      boardId: 'main',
      targetActor
    }),
    {
      boardId: 'main',
      targetActor
    }
  );
});

function createCollaboratorBoardFixture() {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const editorActor = createActor('editor_1', 'editor@example.com', 'Editor');
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const inviteeActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const board = createWorkspaceBoard({
    id: 'board_collab',
    title: 'Collaboration board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator: adminActor
  });

  board.collaboration.memberships.push({
    actor: editorActor,
    role: 'editor',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  board.collaboration.memberships.push({
    actor: viewerActor,
    role: 'viewer',
    joinedAt: '2026-03-31T10:06:00.000Z'
  });
  board.collaboration.invites.push(createInvite('invite_1', inviteeActor.email, 'viewer', adminActor));
  board.collaboration.invites.push(createInvite('invite_2', 'future-editor@example.com', 'editor', adminActor));

  return {
    board,
    adminActor,
    editorActor,
    viewerActor,
    inviteeActor
  };
}

function createInvite(id, email, role, invitedBy) {
  return {
    id,
    email,
    role,
    status: 'pending',
    invitedBy,
    invitedAt: '2026-03-31T10:10:00.000Z'
  };
}

function createActor(id, email, displayName) {
  return {
    type: 'human',
    id,
    email,
    displayName
  };
}
