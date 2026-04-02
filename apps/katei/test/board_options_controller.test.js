import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator } from '../public/js/i18n/translate.js';
import {
  createEmptyWorkspace,
  createWorkspaceBoard
} from '../public/js/domain/workspace_read_model.js';
import { createHomeWorkspaceId } from '../src/workspaces/workspace_record.js';
import BoardOptionsController from '../public/js/controllers/board_options_controller.js';
import {
  createBoardListActionState,
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
  const { optionsState } = createSharedBoardOptionsFixture();

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

test('board options state keeps same-workspace invite rows separate from cross-workspace incoming invites', () => {
  const { workspace, viewerActor } = createSharedBoardOptionsFixture();
  const optionsState = createBoardOptionsState(workspace, viewerActor, {
    activeWorkspaceId: workspace.workspaceId,
    pendingWorkspaceInvites: [
      createPendingWorkspaceInvite({
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        boardTitle: 'Casa',
        inviteId: 'invite_casa_1',
        role: 'editor',
        invitedBy: {
          id: 'sub_owner_casa',
          email: 'owner-casa@example.com',
          displayName: 'Casa owner'
        }
      }),
      createPendingWorkspaceInvite({
        workspaceId: workspace.workspaceId,
        boardId: 'invite',
        boardTitle: 'Invited board',
        inviteId: 'invite_2'
      })
    ]
  });

  assert.deepEqual(
    optionsState.incomingInvites.map((invite) => ({
      workspaceId: invite.workspaceId,
      workspaceLabel: invite.workspaceLabel,
      boardId: invite.boardId,
      inviteId: invite.inviteId
    })),
    [
      {
        workspaceId: 'workspace_invited_casa',
        workspaceLabel: 'workspace_invited_casa',
        boardId: 'casa',
        inviteId: 'invite_casa_1'
      }
    ]
  );
  assert.equal(optionsState.boardStates[2].boardId, 'invite');
  assert.equal(optionsState.boardStates[2].currentRoleStatus, 'invited');
  assert.equal(optionsState.boardStates[2].pendingInvite?.id, 'invite_2');
});

test('board options state groups accessible boards from other workspaces separately', () => {
  const { workspace, viewerActor } = createSharedBoardOptionsFixture();
  const optionsState = createBoardOptionsState(workspace, viewerActor, {
    activeWorkspaceId: workspace.workspaceId,
    accessibleWorkspaces: [
      createAccessibleWorkspaceSummary({
        workspaceId: createHomeWorkspaceId('sub_home'),
        isHomeWorkspace: true,
        boards: [
          {
            boardId: 'main',
            boardTitle: 'Home board',
            role: 'admin'
          }
        ]
      }),
      createAccessibleWorkspaceSummary({
        workspaceId: 'workspace_other',
        boards: [
          {
            boardId: 'roadmap',
            boardTitle: 'Roadmap',
            role: 'viewer'
          }
        ]
      })
    ]
  });

  assert.deepEqual(
    optionsState.workspaceSections.map((section) => ({
      workspaceId: section.workspaceId,
      isHomeWorkspace: section.isHomeWorkspace,
      boardIds: section.boardStates.map((boardState) => boardState.boardId)
    })),
    [
      {
        workspaceId: 'workspace_shared',
        isHomeWorkspace: false,
        boardIds: ['main', 'shared', 'invite']
      },
      {
        workspaceId: createHomeWorkspaceId('sub_home'),
        isHomeWorkspace: true,
        boardIds: ['main']
      },
      {
        workspaceId: 'workspace_other',
        isHomeWorkspace: false,
        boardIds: ['roadmap']
      }
    ]
  );
});

test('board list action state keeps switch and invite responses mutually exclusive', () => {
  const { optionsState } = createSharedBoardOptionsFixture();
  const activeBoardActions = createBoardListActionState(optionsState.boardStates[0]);
  const switchableBoardActions = createBoardListActionState(optionsState.boardStates[1]);
  const invitedBoardActions = createBoardListActionState(optionsState.boardStates[2]);

  assert.deepEqual(activeBoardActions, {
    canRespondToInvite: false,
    canOpenCollaborators: true,
    canEditBoard: false,
    inviteId: '',
    collaboratorsHidden: false,
    editHidden: true,
    switchHidden: true,
    inviteAcceptHidden: true,
    inviteDeclineHidden: true
  });
  assert.deepEqual(switchableBoardActions, {
    canRespondToInvite: false,
    canOpenCollaborators: false,
    canEditBoard: false,
    inviteId: '',
    collaboratorsHidden: true,
    editHidden: true,
    switchHidden: false,
    inviteAcceptHidden: true,
    inviteDeclineHidden: true
  });
  assert.deepEqual(invitedBoardActions, {
    canRespondToInvite: true,
    canOpenCollaborators: false,
    canEditBoard: false,
    inviteId: 'invite_2',
    collaboratorsHidden: true,
    editHidden: true,
    switchHidden: true,
    inviteAcceptHidden: false,
    inviteDeclineHidden: false
  });
});

test('board list action state shows collaborators and edit only for the active admin board', () => {
  const { optionsState } = createAdminBoardOptionsFixture();
  const activeBoardActions = createBoardListActionState(optionsState.boardStates[0]);
  const inactiveBoardActions = createBoardListActionState(optionsState.boardStates[1]);

  assert.equal(activeBoardActions.canOpenCollaborators, true);
  assert.equal(activeBoardActions.canEditBoard, true);
  assert.equal(activeBoardActions.collaboratorsHidden, false);
  assert.equal(activeBoardActions.editHidden, false);
  assert.equal(inactiveBoardActions.canOpenCollaborators, false);
  assert.equal(inactiveBoardActions.canEditBoard, false);
  assert.equal(inactiveBoardActions.collaboratorsHidden, true);
  assert.equal(inactiveBoardActions.editHidden, true);
});

test('board list action state still shows collaborators and edit for the last remaining admin board', () => {
  const { optionsState } = createSingleBoardAdminBoardOptionsFixture();
  const activeBoardActions = createBoardListActionState(optionsState.boardStates[0]);

  assert.equal(activeBoardActions.canOpenCollaborators, true);
  assert.equal(activeBoardActions.collaboratorsHidden, false);
  assert.equal(activeBoardActions.canEditBoard, true);
  assert.equal(activeBoardActions.editHidden, false);
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

test('board options controller hides the invite section when there are no off-workspace invites', () => {
  const { workspace, viewerActor } = createSharedBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();

  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor, {
    activeWorkspaceId: workspace.workspaceId,
    pendingWorkspaceInvites: [
      createPendingWorkspaceInvite({ workspaceId: workspace.workspaceId })
    ]
  });

  assert.equal(controller.inviteSectionTarget.hidden, true);
  assert.deepEqual(controller.inviteListTarget.children, []);
});

test('board options controller renders incoming invite rows from multiple workspaces and keeps board rows unchanged', () => {
  const { workspace, viewerActor, optionsState } = createSharedBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();

  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor, {
    activeWorkspaceId: workspace.workspaceId,
    pendingWorkspaceInvites: [
      createPendingWorkspaceInvite({
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        boardTitle: 'Casa',
        inviteId: 'invite_casa_1',
        role: 'editor',
        invitedBy: {
          id: 'sub_owner_casa',
          email: 'owner-casa@example.com',
          displayName: 'Casa owner'
        }
      }),
      createPendingWorkspaceInvite({
        workspaceId: 'workspace_invited_prueba',
        boardId: 'prueba',
        boardTitle: 'Prueba',
        inviteId: 'invite_prueba_1',
        role: 'viewer',
        invitedBy: {
          id: 'sub_owner_prueba',
          email: 'owner-prueba@example.com',
          displayName: 'Prueba owner'
        }
      }),
      createPendingWorkspaceInvite({
        workspaceId: workspace.workspaceId,
        boardId: 'main',
        boardTitle: 'Should be hidden',
        inviteId: 'invite_same_workspace'
      })
    ]
  });

  assert.equal(controller.inviteSectionTarget.hidden, false);
  assert.equal(controller.inviteListTarget.children.length, 2);
  assert.equal(controller.boardListTarget.children.length, 1);
  assert.equal(controller.boardListTarget.children[0].fields.workspaceTitle.textContent, 'workspace_shared');
  assert.equal(controller.inviteListTarget.children[0].fields.inviteTitle.textContent, 'Casa');
  assert.equal(
    controller.inviteListTarget.children[0].fields.inviteMeta.textContent,
    'Workspace: workspace_invited_casa. From Casa owner'
  );
  assert.equal(controller.inviteListTarget.children[0].fields.inviteRole.textContent, 'Role: Editor');
  assert.equal(controller.inviteListTarget.children[1].fields.inviteTitle.textContent, 'Prueba');
  assert.equal(
    controller.inviteListTarget.children[1].fields.inviteMeta.textContent,
    'Workspace: workspace_invited_prueba. From Prueba owner'
  );
  assert.equal(controller.inviteListTarget.children[1].fields.inviteRole.textContent, 'Role: Viewer');
  assert.deepEqual(
    flattenRenderedBoardRows(controller.boardListTarget).map((item) => item.fields.title.textContent),
    optionsState.boardStates.map((boardState) => boardState.title)
  );
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[1].fields.switchButton.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.editButton.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[2].fields.inviteAcceptButton.hidden, false);
});

test('board options controller shows Collaborators and Edit Board only on the active admin row', () => {
  const { workspace, viewerActor, optionsState } = createAdminBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();

  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor);

  assert.deepEqual(
    flattenRenderedBoardRows(controller.boardListTarget).map((item) => item.fields.title.textContent),
    optionsState.boardStates.map((boardState) => boardState.title)
  );
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorsButton.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorBadge.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorBadge.textContent, '0');
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.editButton.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.switchButton.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[1].fields.collaboratorsButton.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[1].fields.collaboratorBadge.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[1].fields.editButton.hidden, true);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[1].fields.switchButton.hidden, false);
});

test('board options controller shows the collaborator badge count on the active row', () => {
  const { workspace, viewerActor } = createAdminBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();

  workspace.boards.main.collaboration.invites.push(createInvite('invite_1', 'invitee@example.com', 'editor', viewerActor));

  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor);

  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorsButton.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorBadge.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorBadge.textContent, '1');
});

test('board options controller still shows Collaborators and Edit Board when only one board remains', () => {
  const { workspace, viewerActor } = createSingleBoardAdminBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();

  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor);

  assert.equal(flattenRenderedBoardRows(controller.boardListTarget).length, 1);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.collaboratorsButton.hidden, false);
  assert.equal(flattenRenderedBoardRows(controller.boardListTarget)[0].fields.editButton.hidden, false);
});

test('board options controller editBoard dispatches the active board id from a row action', () => {
  const { workspace, viewerActor } = createAdminBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();
  const dispatched = [];

  controller.dispatch = (name, options) => dispatched.push({ name, detail: options?.detail ?? null });
  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor);
  BoardOptionsController.prototype.editBoard.call(controller, {
    currentTarget: {
      dataset: {
        boardId: 'shared'
      }
    }
  });

  assert.deepEqual(dispatched, [
    {
      name: 'edit-board',
      detail: {
        boardId: 'main'
      }
    }
  ]);
  assert.deepEqual(controller.closeDialogCalls, [{ restoreFocus: false }]);
});

test('board options controller openCollaborators dispatches the active board id from a row action', () => {
  const { workspace, viewerActor } = createAdminBoardOptionsFixture();
  const controller = createBoardOptionsControllerDouble();
  const dispatched = [];

  controller.dispatch = (name, options) => dispatched.push({ name, detail: options?.detail ?? null });
  BoardOptionsController.prototype.syncWorkspace.call(controller, workspace, viewerActor);
  BoardOptionsController.prototype.openCollaborators.call(controller, {
    currentTarget: {
      dataset: {
        boardId: 'shared'
      }
    }
  });

  assert.deepEqual(dispatched, [
    {
      name: 'open-collaborators',
      detail: {
        boardId: 'main'
      }
    }
  ]);
  assert.deepEqual(controller.closeDialogCalls, [{ restoreFocus: false }]);
});

test('board options controller acceptInvite dispatches workspaceId, boardId, and inviteId', () => {
  const controller = createBoardOptionsControllerDouble();
  const dispatched = [];

  controller.dispatch = (name, options) => dispatched.push({ name, detail: options?.detail ?? null });

  BoardOptionsController.prototype.acceptInvite.call(controller, {
    currentTarget: {
      dataset: {
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        inviteId: 'invite_casa_1'
      }
    }
  });

  assert.deepEqual(dispatched, [
    {
      name: 'accept-invite',
      detail: {
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        inviteId: 'invite_casa_1'
      }
    }
  ]);
  assert.deepEqual(controller.closeDialogCalls, [{ restoreFocus: false }]);
});

test('board options controller declineInvite dispatches workspaceId, boardId, and inviteId', () => {
  const controller = createBoardOptionsControllerDouble();
  const dispatched = [];

  controller.dispatch = (name, options) => dispatched.push({ name, detail: options?.detail ?? null });

  BoardOptionsController.prototype.declineInvite.call(controller, {
    currentTarget: {
      dataset: {
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        inviteId: 'invite_casa_1'
      }
    }
  });

  assert.deepEqual(dispatched, [
    {
      name: 'decline-invite',
      detail: {
        workspaceId: 'workspace_invited_casa',
        boardId: 'casa',
        inviteId: 'invite_casa_1'
      }
    }
  ]);
  assert.deepEqual(controller.closeDialogCalls, [{ restoreFocus: false }]);
});

test('board options controller switchBoard dispatches workspace-aware detail for another workspace', () => {
  const controller = createBoardOptionsControllerDouble();
  const dispatched = [];

  controller.dispatch = (name, options) => dispatched.push({ name, detail: options?.detail ?? null });
  controller.activeWorkspaceId = 'workspace_shared';

  BoardOptionsController.prototype.switchBoard.call(controller, {
    currentTarget: {
      dataset: {
        workspaceId: createHomeWorkspaceId('sub_home'),
        isHomeWorkspace: 'true',
        boardId: 'main',
        boardTitle: 'Home board'
      }
    }
  });

  assert.deepEqual(dispatched, [
    {
      name: 'switch-board',
      detail: {
        workspaceId: createHomeWorkspaceId('sub_home'),
        isHomeWorkspace: true,
        boardId: 'main',
        boardTitle: 'Home board'
      }
    }
  ]);
  assert.deepEqual(controller.closeDialogCalls, [{ restoreFocus: false }]);
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

function createSharedBoardOptionsFixture() {
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

  return {
    viewerActor,
    workspace,
    optionsState: createBoardOptionsState(workspace, viewerActor)
  };
}

function createAdminBoardOptionsFixture() {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_admin',
    creator: adminActor
  });

  const sharedBoard = createBoard({
    id: 'shared',
    title: 'Shared board',
    creator: adminActor
  });
  addMembership(sharedBoard, adminActor, 'admin');

  workspace.boardOrder = ['main', 'shared'];
  workspace.boards.shared = sharedBoard;
  workspace.ui.activeBoardId = 'main';

  return {
    viewerActor: adminActor,
    workspace,
    optionsState: createBoardOptionsState(workspace, adminActor)
  };
}

function createSingleBoardAdminBoardOptionsFixture() {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_single_admin',
    creator: adminActor
  });

  workspace.boardOrder = ['main'];
  workspace.ui.activeBoardId = 'main';

  return {
    viewerActor: adminActor,
    workspace,
    optionsState: createBoardOptionsState(workspace, adminActor)
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

function createPendingWorkspaceInvite({
  workspaceId = 'workspace_invited_casa',
  boardId = 'casa',
  boardTitle = 'Casa',
  inviteId = 'invite_casa_1',
  role = 'editor',
  invitedBy = {
    id: 'sub_owner_casa',
    email: 'owner-casa@example.com',
    displayName: 'Casa owner'
  }
} = {}) {
  return {
    workspaceId,
    boardId,
    boardTitle,
    inviteId,
    role,
    invitedAt: '2026-04-01T10:20:00.000Z',
    invitedBy
  };
}

function createAccessibleWorkspaceSummary({
  workspaceId = 'workspace_shared_other',
  isHomeWorkspace = false,
  boards = [
    {
      boardId: 'main',
      boardTitle: 'Shared board',
      role: 'viewer'
    }
  ]
} = {}) {
  return {
    workspaceId,
    isHomeWorkspace,
    boards
  };
}

function createBoardOptionsControllerDouble() {
  const controller = Object.create(BoardOptionsController.prototype);

  controller.t = createTranslator('en');
  controller.workspace = null;
  controller.viewerActor = null;
  controller.optionsState = null;
  controller.pendingWorkspaceInvites = [];
  controller.activeWorkspaceId = null;
  controller.activeWorkspaceIsHome = false;
  controller.accessibleWorkspaces = [];
  controller.restoreFocusElement = null;
  controller.closeDialogCalls = [];
  controller.dispatch = () => {};
  controller.closeDialog = (options = {}) => {
    controller.closeDialogCalls.push(options);
  };
  controller.summaryTarget = createTextTarget();
  controller.roleSummaryTarget = createTextTarget();
  controller.pendingSummaryTarget = createTextTarget({ hidden: true });
  controller.boardListTarget = createListTarget();
  controller.workspaceSectionTemplateTarget = createTemplateDouble([
    'workspaceTitle',
    'workspaceBoards'
  ]);
  controller.boardItemTemplateTarget = createTemplateDouble([
    'title',
    'state',
    'switchButton',
    'collaboratorsButton',
    'collaboratorBadge',
    'editButton',
    'inviteAcceptButton',
    'inviteDeclineButton'
  ]);
  controller.inviteSectionTarget = createToggleTarget();
  controller.inviteListTarget = createListTarget();
  controller.inviteItemTemplateTarget = createTemplateDouble([
    'inviteTitle',
    'inviteMeta',
    'inviteRole',
    'inviteAcceptButton',
    'inviteDeclineButton'
  ]);
  controller.dialogTarget = {
    open: false,
    close() {
      this.open = false;
    }
  };

  return controller;
}

function createTextTarget({ hidden = false } = {}) {
  return {
    hidden,
    textContent: ''
  };
}

function createToggleTarget(hidden = false) {
  return {
    hidden
  };
}

function createListTarget() {
  return {
    children: [],
    replaceChildren(...nodes) {
      this.children = nodes;
    }
  };
}

function createTemplateDouble(fieldNames) {
  return {
    content: {
      firstElementChild: createTemplateNode(fieldNames)
    }
  };
}

function createTemplateNode(fieldNames) {
  const fields = Object.fromEntries(fieldNames.map((fieldName) => [fieldName, createFieldTarget()]));

  return {
    fields,
    querySelector(selector) {
      const match = selector.match(/data-board-options-field="([^"]+)"/);
      return match ? fields[match[1]] ?? null : null;
    },
    cloneNode() {
      return createTemplateNode(fieldNames);
    }
  };
}

function createFieldTarget() {
  return {
    children: [],
    textContent: '',
    hidden: false,
    dataset: {},
    replaceChildren(...nodes) {
      this.children = nodes;
    }
  };
}

function flattenRenderedBoardRows(boardListTarget) {
  return boardListTarget.children.flatMap((section) => section.fields.workspaceBoards.children);
}
