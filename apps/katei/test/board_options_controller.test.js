import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkspace,
  createWorkspaceBoard
} from '../public/js/domain/workspace_read_model.js';
import {
  createBoardOptionsState,
  getBoardRoleTranslationKey
} from '../public/js/controllers/board_collaboration_state.js';

test('board options state surfaces the active actor role and pending invite count', () => {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_admin',
    creator: adminActor
  });

  workspace.boards.main.collaboration.invites.push(createInvite('invite_1', 'invitee@example.com', 'editor', adminActor));

  const optionsState = createBoardOptionsState(workspace, adminActor);

  assert.equal(optionsState.activeBoardState.canAdmin, true);
  assert.equal(optionsState.activeBoardState.currentRoleStatus, 'admin');
  assert.equal(optionsState.activeBoardState.pendingInviteCount, 1);
  assert.equal(getBoardRoleTranslationKey(optionsState.activeBoardState.currentRoleStatus), 'collaborators.roles.admin');
});

test('board options state includes readable boards and invite-only boards without exposing inaccessible ones', () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared',
    creator: createActor('owner_main', 'owner-main@example.com', 'Main owner')
  });
  const mainBoard = workspace.boards.main;

  addMembership(mainBoard, viewerActor, 'viewer');
  workspace.ui.activeBoardId = 'main';

  const sharedBoard = createBoard({
    id: 'shared',
    title: 'Shared board',
    creator: createActor('owner_shared', 'owner-shared@example.com', 'Shared owner')
  });
  addMembership(sharedBoard, viewerActor, 'viewer');

  const inviteBoard = createBoard({
    id: 'invite',
    title: 'Invited board',
    creator: createActor('owner_invite', 'owner-invite@example.com', 'Invite owner')
  });
  inviteBoard.collaboration.invites.push(createInvite('invite_2', viewerActor.email, 'editor', inviteBoard.collaboration.memberships[0].actor));

  const secretBoard = createBoard({
    id: 'secret',
    title: 'Secret board',
    creator: createActor('owner_secret', 'owner-secret@example.com', 'Secret owner')
  });

  workspace.boardOrder = ['main', 'shared', 'invite', 'secret'];
  workspace.boards.shared = sharedBoard;
  workspace.boards.invite = inviteBoard;
  workspace.boards.secret = secretBoard;

  const optionsState = createBoardOptionsState(workspace, viewerActor);

  assert.deepEqual(
    optionsState.boardStates.map((boardState) => boardState.boardId),
    ['main', 'shared', 'invite']
  );
  assert.equal(optionsState.boardStates[0].isActive, true);
  assert.equal(optionsState.boardStates[0].canSwitch, false);
  assert.equal(optionsState.boardStates[1].canSwitch, true);
  assert.equal(optionsState.boardStates[1].currentRoleStatus, 'viewer');
  assert.equal(optionsState.boardStates[2].currentRoleStatus, 'invited');
  assert.equal(optionsState.boardStates[2].canSwitch, false);
});

test('board role translation keys stay stable for member and invite states', () => {
  assert.equal(getBoardRoleTranslationKey('admin'), 'collaborators.roles.admin');
  assert.equal(getBoardRoleTranslationKey('editor'), 'collaborators.roles.editor');
  assert.equal(getBoardRoleTranslationKey('viewer'), 'collaborators.roles.viewer');
  assert.equal(getBoardRoleTranslationKey('invited'), 'collaborators.roles.invited');
  assert.equal(getBoardRoleTranslationKey('missing'), 'collaborators.roles.none');
});

test('board options state stays stable when filtering removes every visible board', () => {
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_empty_projection',
    creator: createActor('owner_1', 'owner@example.com', 'Owner')
  });

  workspace.boardOrder = [];
  workspace.boards = {};
  workspace.ui.activeBoardId = null;

  const optionsState = createBoardOptionsState(workspace, createActor('viewer_1', 'viewer@example.com', 'Viewer'));

  assert.equal(optionsState.activeBoard, null);
  assert.equal(optionsState.activeBoardState, null);
  assert.deepEqual(optionsState.boardStates, []);
});

function createBoard({ id, title, creator }) {
  return createWorkspaceBoard({
    id,
    title,
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator
  });
}

function addMembership(board, actor, role) {
  board.collaboration.memberships.push({
    actor,
    role,
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
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
