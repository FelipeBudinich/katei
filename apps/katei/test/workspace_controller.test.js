import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkspace,
  createWorkspaceBoard
} from '../public/js/domain/workspace_read_model.js';
import WorkspaceController from '../public/js/controllers/workspace_controller.js';
import { createHomeWorkspaceId } from '../src/workspaces/workspace_record.js';
import {
  getBoardCollaborationState,
  hasVisibleWorkspaceAccess
} from '../public/js/controllers/board_collaboration_state.js';
import {
  getDefaultBoardStageId,
  getBoardStageTitle,
  getStageMoveOptions,
  resolveBoardStageId
} from '../public/js/controllers/stage_ui.js';
import {
  performWorkspaceCollaboratorAction,
  performWorkspaceInviteDecision
} from '../public/js/controllers/workspace_collaboration_actions.js';
import {
  buildCardEditorMutationPlan,
  createCardLocaleRequestAction,
  createRuntimeCardDialogState
} from '../public/js/controllers/workspace_card_dialog.js';
import { createTranslator } from '../public/js/i18n/translate.js';

test('resolveBoardStageId accepts stage ids and legacy column ids for the active board flow', () => {
  const board = createBoardWithCustomStages();
  board.stages.review.cardIds = ['card_1'];

  assert.equal(resolveBoardStageId(board, { stageId: 'review' }), 'review');
  assert.equal(resolveBoardStageId(board, { columnId: 'review' }), 'review');
  assert.equal(resolveBoardStageId(board, { cardId: 'card_1' }), 'review');
});

test('getStageMoveOptions derives editor move targets from allowedTransitionStageIds', () => {
  const board = createBoardWithCustomStages();

  assert.deepEqual(getStageMoveOptions(board, 'review'), [
    { id: 'review', title: 'Ready for Review' },
    { id: 'qa', title: 'QA Sweep' },
    { id: 'published', title: 'Published' }
  ]);
  assert.equal(getBoardStageTitle(board, 'qa'), 'QA Sweep');
});

test('getDefaultBoardStageId follows the board-defined stage order for create flows', () => {
  const board = createBoardWithCustomStages();

  assert.equal(getDefaultBoardStageId(board), 'review');
});

test('performWorkspaceCollaboratorAction routes collaborator UI actions through WorkspaceService', async () => {
  const workspace = createEmptyWorkspace();
  const scenarios = [
    {
      action: 'invite-member',
      detail: { boardId: 'main', email: 'invitee@example.com', role: 'editor' },
      expectedMethod: 'inviteBoardMember',
      expectedArgs: ['main', 'invitee@example.com', 'editor']
    },
    {
      action: 'revoke-invite',
      detail: { boardId: 'main', inviteId: 'invite_1' },
      expectedMethod: 'revokeBoardInvite',
      expectedArgs: ['main', 'invite_1']
    },
    {
      action: 'change-member-role',
      detail: {
        boardId: 'main',
        targetActor: { type: 'human', id: 'viewer_1', email: 'viewer@example.com' },
        role: 'admin'
      },
      expectedMethod: 'setBoardMemberRole',
      expectedArgs: ['main', { type: 'human', id: 'viewer_1', email: 'viewer@example.com' }, 'admin']
    },
    {
      action: 'remove-member',
      detail: {
        boardId: 'main',
        targetActor: { type: 'human', id: 'viewer_1' }
      },
      expectedMethod: 'removeBoardMember',
      expectedArgs: ['main', { type: 'human', id: 'viewer_1' }]
    }
  ];

  for (const scenario of scenarios) {
    const service = createCollaborationServiceDouble({ workspace });
    const result = await performWorkspaceCollaboratorAction({
      service,
      action: scenario.action,
      detail: scenario.detail
    });

    assert.deepEqual(result, workspace);
    assert.deepEqual(service.calls, [
      {
        method: scenario.expectedMethod,
        args: scenario.expectedArgs
      }
    ]);
  }
});

test('workspace controller includes pendingWorkspaceInvites and activeWorkspaceId when opening board options', () => {
  const workspace = createViewerWorkspace('workspace_home', createActor('viewer_1', 'viewer@example.com', 'Viewer'));
  const accessibleWorkspaces = [
    createAccessibleWorkspaceSummary({
      workspaceId: 'workspace_shared',
      boards: [
        {
          boardId: 'notes',
          boardTitle: 'Notes',
          role: 'editor'
        }
      ]
    })
  ];
  const pendingWorkspaceInvites = [
    {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      boardTitle: 'Casa',
      inviteId: 'invite_casa_1',
      role: 'editor',
      invitedAt: '2026-03-31T10:20:00.000Z',
      invitedBy: {
        id: 'sub_owner_casa',
        email: 'owner-casa@example.com',
        displayName: 'Casa owner'
      }
    }
  ];
  const controller = Object.create(WorkspaceController.prototype);
  const dispatchedEvents = [];
  const triggerElement = { id: 'open-board-options-button' };

  controller.workspace = workspace;
  controller.viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  controller.service = {
    getActiveWorkspaceId() {
      return 'workspace_home';
    },
    getIsHomeWorkspace() {
      return true;
    },
    getPendingWorkspaceInvites() {
      return pendingWorkspaceInvites;
    },
    getAccessibleWorkspaces() {
      return accessibleWorkspaces;
    }
  };
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  WorkspaceController.prototype.openBoardOptions.call(controller, {
    currentTarget: triggerElement
  });

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'open-board-options',
      detail: {
        workspace,
        viewerActor: controller.viewerActor,
        triggerElement,
        activeWorkspaceId: 'workspace_home',
        activeWorkspaceIsHome: true,
        pendingWorkspaceInvites,
        accessibleWorkspaces
      }
    }
  ]);
});

test('workspace controller sync-board-options payload includes pendingWorkspaceInvites and activeWorkspaceId during render', () => {
  const controller = Object.create(WorkspaceController.prototype);
  const dispatchedEvents = [];
  const accessibleWorkspaces = [
    createAccessibleWorkspaceSummary({
      workspaceId: 'workspace_shared',
      boards: [
        {
          boardId: 'notes',
          boardTitle: 'Notes',
          role: 'viewer'
        }
      ]
    })
  ];

  controller.workspace = createEmptyWorkspace();
  controller.workspace.boardOrder = [];
  controller.workspace.boards = {};
  controller.workspace.ui.activeBoardId = null;
  controller.viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  controller.service = {
    getActiveWorkspaceId() {
      return 'workspace_home';
    },
    getIsHomeWorkspace() {
      return true;
    },
    getPendingWorkspaceInvites() {
      return [
        {
          workspaceId: 'workspace_invited_casa',
          boardId: 'casa',
          boardTitle: 'Casa',
          inviteId: 'invite_casa_1',
          role: 'editor',
          invitedAt: '2026-03-31T10:20:00.000Z',
          invitedBy: {
            id: 'sub_owner_casa',
            email: 'owner-casa@example.com',
            displayName: 'Casa owner'
          }
        }
      ];
    },
    getAccessibleWorkspaces() {
      return accessibleWorkspaces;
    }
  };
  controller.t = (key) => key;
  controller.hasCreateCardButtonTarget = true;
  controller.createCardButtonTarget = {
    hidden: false,
    disabled: false,
    setAttribute() {}
  };
  controller.hasBoardAccessNoticeTarget = true;
  controller.boardAccessNoticeTarget = {
    hidden: true,
    textContent: ''
  };
  controller.hasBoardTitleTarget = true;
  controller.boardTitleTarget = {
    textContent: ''
  };
  controller.hasDesktopColumnsTarget = true;
  controller.desktopColumnsTarget = {
    hidden: false,
    replaceChildren() {}
  };
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  WorkspaceController.prototype.render.call(controller);

  assert.deepEqual(dispatchedEvents[0], {
    name: 'sync-board-options',
    detail: {
      workspace: controller.workspace,
      viewerActor: controller.viewerActor,
      triggerElement: null,
      activeWorkspaceId: 'workspace_home',
      activeWorkspaceIsHome: true,
      pendingWorkspaceInvites: controller.service.getPendingWorkspaceInvites(),
      accessibleWorkspaces
    }
  });
});

test('handleBoardSwitch switches workspaces before selecting a board in another workspace', async () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const currentWorkspace = createViewerWorkspace('workspace_home', viewerActor);
  const sharedWorkspace = createViewerWorkspace('workspace_shared', viewerActor);
  const selectedBoardWorkspace = structuredClone(sharedWorkspace);
  const notesBoard = createWorkspaceBoard({
    id: 'notes',
    title: 'Notes',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator: createActor('owner_1', 'owner@example.com', 'Owner')
  });
  const controller = Object.create(WorkspaceController.prototype);
  const announcements = [];
  const queuedHistoryActions = [];
  let renderCalls = 0;

  notesBoard.collaboration.memberships.push({
    actor: viewerActor,
    role: 'editor',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  sharedWorkspace.boards.notes = notesBoard;
  sharedWorkspace.boardOrder = ['main', 'notes'];
  sharedWorkspace.ui.activeBoardId = 'main';
  selectedBoardWorkspace.boards.notes = structuredClone(notesBoard);
  selectedBoardWorkspace.boardOrder = ['main', 'notes'];
  selectedBoardWorkspace.ui.activeBoardId = 'notes';

  controller.workspace = currentWorkspace;
  controller.service = createWorkspaceNavigationServiceDouble({
    activeWorkspaceId: 'workspace_home',
    isHomeWorkspace: true,
    switchWorkspaceResult: sharedWorkspace,
    setActiveBoardResult: selectedBoardWorkspace
  });
  controller.render = () => {
    renderCalls += 1;
  };
  controller.queueWorkspaceHistoryAction = (action) => {
    queuedHistoryActions.push(action);
  };
  controller.announce = (message) => {
    announcements.push(message);
  };
  controller.t = (key, values = {}) => (values.title ? `${key}:${values.title}` : key);

  await WorkspaceController.prototype.handleBoardSwitch.call(controller, {
    detail: {
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false,
      boardId: 'notes',
      boardTitle: 'Notes'
    }
  });

  assert.deepEqual(controller.service.calls, [
    {
      method: 'switchWorkspace',
      args: ['workspace_shared']
    },
    {
      method: 'setActiveBoard',
      args: ['notes']
    }
  ]);
  assert.equal(controller.workspace.workspaceId, 'workspace_shared');
  assert.equal(controller.workspace.ui.activeBoardId, 'notes');
  assert.deepEqual(queuedHistoryActions, ['push']);
  assert.equal(renderCalls, 1);
  assert.deepEqual(announcements, [
    'workspace.announcements.switchedBoard:Notes'
  ]);
});

test('handleBoardSwitch keeps another viewer home workspace explicit instead of routing through the current home workspace', async () => {
  const controller = Object.create(WorkspaceController.prototype);
  const currentWorkspace = createViewerWorkspace(
    'workspace_home',
    createActor('viewer_1', 'viewer@example.com', 'Viewer')
  );
  const foreignHomeWorkspaceId = createHomeWorkspaceId('sub_owner_casa');
  const foreignHomeWorkspace = createViewerWorkspace(
    foreignHomeWorkspaceId,
    createActor('sub_owner_casa', 'owner-casa@example.com', 'Casa Owner')
  );
  const casaBoard = structuredClone(foreignHomeWorkspace.boards.main);
  const selectedCasaWorkspace = structuredClone(foreignHomeWorkspace);
  const queuedHistoryActions = [];

  casaBoard.title = 'Casa';
  casaBoard.collaboration.memberships.push({
    actor: createActor('viewer_1', 'viewer@example.com', 'Viewer'),
    role: 'viewer',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  foreignHomeWorkspace.boards.main = casaBoard;
  foreignHomeWorkspace.ui.activeBoardId = 'main';
  selectedCasaWorkspace.boards.main = structuredClone(casaBoard);
  selectedCasaWorkspace.ui.activeBoardId = 'main';

  controller.workspace = currentWorkspace;
  controller.service = createWorkspaceNavigationServiceDouble({
    activeWorkspaceId: 'workspace_home',
    isHomeWorkspace: true,
    switchWorkspaceResult: foreignHomeWorkspace,
    setActiveBoardResult: selectedCasaWorkspace
  });
  controller.render = () => {};
  controller.queueWorkspaceHistoryAction = (action) => {
    queuedHistoryActions.push(action);
  };
  controller.announce = () => {};
  controller.t = (key, values = {}) => (values.title ? `${key}:${values.title}` : key);

  await WorkspaceController.prototype.handleBoardSwitch.call(controller, {
    detail: {
      workspaceId: foreignHomeWorkspaceId,
      isHomeWorkspace: false,
      boardId: 'main',
      boardTitle: 'Casa'
    }
  });

  assert.deepEqual(controller.service.calls, [
    {
      method: 'switchWorkspace',
      args: [foreignHomeWorkspaceId]
    }
  ]);
  assert.equal(controller.workspace.workspaceId, foreignHomeWorkspaceId);
  assert.deepEqual(queuedHistoryActions, ['push']);
});

test('handlePopState reloads the workspace from the workspaceId in browser location', async () => {
  const controller = Object.create(WorkspaceController.prototype);
  const sharedWorkspace = createViewerWorkspace(
    'workspace_shared',
    createActor('viewer_1', 'viewer@example.com', 'Viewer')
  );
  const queuedHistoryActions = [];

  controller.browserLocation = {
    href: 'http://localhost/boards?workspaceId=workspace_shared'
  };
  controller.service = createWorkspaceNavigationServiceDouble({
    activeWorkspaceId: 'workspace_home',
    isHomeWorkspace: true,
    loadResult: sharedWorkspace
  });
  controller.runAction = async (action) => {
    controller.workspace = await action();
    return true;
  };
  controller.queueWorkspaceHistoryAction = (action) => {
    queuedHistoryActions.push(action);
  };
  controller.nextWorkspaceHistoryAction = 'push';

  await WorkspaceController.prototype.handlePopState.call(controller);

  assert.deepEqual(controller.service.calls, [
    {
      method: 'setActiveWorkspace',
      args: ['workspace_shared']
    },
    {
      method: 'load',
      args: []
    }
  ]);
  assert.equal(controller.workspace.workspaceId, 'workspace_shared');
  assert.deepEqual(queuedHistoryActions, ['skip']);
});

test('openCreateBoard opens the board editor without delete access', () => {
  const controller = Object.create(WorkspaceController.prototype);
  const dispatchedEvents = [];

  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  WorkspaceController.prototype.openCreateBoard.call(controller);

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'open-board-editor',
      detail: {
        mode: 'create',
        canDeleteBoard: false
      }
    }
  ]);
});

test('openEditBoard opens the board editor with delete access when another board exists', () => {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_admin',
    creator: adminActor
  });
  const controller = Object.create(WorkspaceController.prototype);
  const dispatchedEvents = [];

  workspace.boards.shared = createWorkspaceBoard({
    id: 'shared',
    title: 'Shared board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator: adminActor
  });
  workspace.boards.shared.collaboration.memberships.push({
    actor: adminActor,
    role: 'admin',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  workspace.boardOrder = ['main', 'shared'];
  workspace.ui.activeBoardId = 'main';

  controller.workspace = workspace;
  controller.viewerActor = adminActor;
  controller.announce = () => {};
  controller.t = (key) => key;
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  WorkspaceController.prototype.openEditBoard.call(controller);

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'open-board-editor',
      detail: {
        mode: 'edit',
        board: workspace.boards.main,
        canDeleteBoard: true
      }
    }
  ]);
});

test('confirmDeleteBoard opens the delete confirmation for the requested board', () => {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_admin',
    creator: adminActor
  });
  const controller = Object.create(WorkspaceController.prototype);
  const confirmations = [];
  const announcements = [];
  const triggerElement = { id: 'delete-board-row-action' };

  controller.workspace = workspace;
  controller.viewerActor = adminActor;
  controller.t = (key, values = {}) => (values.title ? `${key}:${values.title}` : key);
  controller.openConfirmDialog = (options) => {
    confirmations.push(options);
  };
  controller.announce = (message) => {
    announcements.push(message);
  };

  WorkspaceController.prototype.confirmDeleteBoard.call(controller, {
    detail: {
      boardId: 'main'
    },
    currentTarget: triggerElement
  });

  assert.deepEqual(confirmations, [
    {
      triggerElement,
      confirmation: {
        type: 'delete-board',
        boardId: 'main',
        title: 'workspace.confirmations.deleteBoardTitle',
        message: `workspace.confirmations.deleteBoardMessage:${workspace.boards.main.title}`,
        confirmLabel: 'workspace.confirmations.deleteBoardConfirm'
      }
    }
  ]);
  assert.deepEqual(announcements, []);
});

test('confirmDeleteBoard accepts a board id from a board editor delete button dataset', () => {
  const adminActor = createActor('admin_1', 'admin@example.com', 'Admin');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_admin',
    creator: adminActor
  });
  const sharedBoard = createWorkspaceBoard({
    id: 'shared',
    title: 'Shared board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator: adminActor
  });
  const controller = Object.create(WorkspaceController.prototype);
  const confirmations = [];
  const announcements = [];
  const triggerElement = {
    id: 'board-editor-delete-button',
    dataset: {
      boardId: 'shared'
    }
  };

  sharedBoard.collaboration.memberships.push({
    actor: adminActor,
    role: 'admin',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  workspace.boards.shared = sharedBoard;
  workspace.boardOrder = ['main', 'shared'];
  controller.workspace = workspace;
  controller.viewerActor = adminActor;
  controller.t = (key, values = {}) => (values.title ? `${key}:${values.title}` : key);
  controller.openConfirmDialog = (options) => {
    confirmations.push(options);
  };
  controller.announce = (message) => {
    announcements.push(message);
  };

  WorkspaceController.prototype.confirmDeleteBoard.call(controller, {
    currentTarget: triggerElement
  });

  assert.deepEqual(confirmations, [
    {
      triggerElement,
      confirmation: {
        type: 'delete-board',
        boardId: 'shared',
        title: 'workspace.confirmations.deleteBoardTitle',
        message: `workspace.confirmations.deleteBoardMessage:${sharedBoard.title}`,
        confirmLabel: 'workspace.confirmations.deleteBoardConfirm'
      }
    }
  ]);
  assert.deepEqual(announcements, []);
});

test('handleDiscardCardLocale opens a discard confirmation for the selected locale', () => {
  const workspace = createEmptyWorkspace();
  const controller = Object.create(WorkspaceController.prototype);
  const confirmations = [];
  const triggerElement = { id: 'discard-locale-button' };

  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  workspace.boards.main.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: null
      },
      ja: {
        title: '手動の日本語タイトル',
        detailsMarkdown: '人が編集しました。',
        provenance: null
      }
    },
    localeRequests: {}
  };
  controller.workspace = workspace;
  controller.t = (key, values = {}) => {
    if (values.title && values.locale) {
      return `${key}:${values.locale}:${values.title}`;
    }

    return key;
  };
  controller.openConfirmDialog = (options) => {
    confirmations.push(options);
  };

  WorkspaceController.prototype.handleDiscardCardLocale.call(controller, {
    detail: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja',
      triggerElement
    }
  });

  assert.deepEqual(confirmations, [
    {
      triggerElement,
      confirmation: {
        type: 'discard-card-locale',
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        title: 'workspace.confirmations.discardLocaleTitle',
        message: 'workspace.confirmations.discardLocaleMessage:ja:手動の日本語タイトル',
        confirmLabel: 'workspace.confirmations.discardLocaleConfirm'
      }
    }
  ]);
});

test('openBoardCollaborators dispatches the collaborators sheet event for the requested board', () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const workspace = createViewerWorkspace('workspace_home', viewerActor);
  const controller = Object.create(WorkspaceController.prototype);
  const dispatchedEvents = [];
  const triggerElement = { id: 'open-collaborators-row-action' };

  controller.workspace = workspace;
  controller.viewerActor = viewerActor;
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  WorkspaceController.prototype.openBoardCollaborators.call(controller, {
    detail: {
      boardId: 'main'
    },
    target: triggerElement
  });

  assert.deepEqual(dispatchedEvents, [
    {
      name: 'open-board-collaborators',
      detail: {
        workspace,
        viewerActor,
        boardId: 'main',
        triggerElement
      }
    }
  ]);
});

test('toggleColumn keeps collapse state client-local and updates the DOM without mutating workspace state', () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const workspace = createViewerWorkspace('workspace_local_columns', viewerActor);
  const controller = Object.create(WorkspaceController.prototype);
  const panel = createColumnPanelDouble({
    stageId: 'backlog',
    columnId: 'backlog',
    cardCount: 2
  });
  const service = {
    calls: 0,
    setColumnCollapsed() {
      this.calls += 1;
    }
  };
  const announcements = [];

  controller.workspace = workspace;
  controller.viewerActor = viewerActor;
  controller.service = service;
  controller.t = (key, values = {}) => (values.column ? `${key}:${values.column}` : key);
  controller.announce = (message) => announcements.push(message);

  WorkspaceController.prototype.toggleColumn.call(controller, {
    currentTarget: panel.toggleElement
  });

  assert.strictEqual(controller.workspace, workspace);
  assert.equal(service.calls, 0);
  assert.equal(panel.element.dataset.collapsed, 'true');
  assert.equal(panel.toggleElement.attributes['aria-expanded'], 'false');
  assert.equal(panel.bodyElement.hidden, true);
  assert.equal(controller.getCollapsedColumnsForBoard(workspace.boards.main).backlog, true);
  assert.equal(announcements.length, 1);
});

test('workspace controller scopes transient collapse state by workspace id and preserves per-column independence', () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const workspaceA = createViewerWorkspace('workspace_alpha', viewerActor);
  const workspaceB = createViewerWorkspace('workspace_beta', viewerActor);
  const controller = Object.create(WorkspaceController.prototype);

  controller.workspace = workspaceA;
  controller.setColumnCollapsed(workspaceA.boards.main, 'backlog', true);
  controller.setColumnCollapsed(workspaceA.boards.main, 'doing', false);

  assert.deepEqual(controller.getCollapsedColumnsForBoard(workspaceA.boards.main), {
    backlog: true,
    doing: false,
    done: false,
    archived: false
  });

  controller.workspace = workspaceB;

  assert.deepEqual(controller.getCollapsedColumnsForBoard(workspaceB.boards.main), {
    backlog: false,
    doing: false,
    done: false,
    archived: false
  });

  controller.setColumnCollapsed(workspaceB.boards.main, 'doing', true);

  assert.deepEqual(controller.getCollapsedColumnsForBoard(workspaceB.boards.main), {
    backlog: false,
    doing: true,
    done: false,
    archived: false
  });

  controller.workspace = workspaceA;

  assert.deepEqual(controller.getCollapsedColumnsForBoard(workspaceA.boards.main), {
    backlog: true,
    doing: false,
    done: false,
    archived: false
  });
});

test('performWorkspaceInviteDecision keeps the active workspace when accepting an invite', async () => {
  const viewerActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const sharedWorkspace = createViewerWorkspace('workspace_shared', viewerActor);
  const service = createCollaborationServiceDouble({
    acceptWorkspace: sharedWorkspace,
    switchWorkspace: createViewerWorkspace('workspace_home', viewerActor)
  });

  const result = await performWorkspaceInviteDecision({
    service,
    decision: 'accept',
    detail: {
      boardId: 'main',
      inviteId: 'invite_1'
    },
    viewerActor,
    activeWorkspaceId: 'workspace_shared'
  });

  assert.deepEqual(result, {
    workspace: sharedWorkspace,
    leftWorkspace: false
  });
  assert.deepEqual(service.calls, [
    {
      method: 'acceptBoardInvite',
      args: ['main', 'invite_1', 'workspace_shared']
    }
  ]);
});

test('performWorkspaceInviteDecision lands in the invited workspace for cross-workspace acceptance', async () => {
  const viewerActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const invitedWorkspace = createViewerWorkspace('workspace_invited_casa', viewerActor);
  const activeCasaWorkspace = structuredClone(invitedWorkspace);
  activeCasaWorkspace.boards.casa = {
    ...activeCasaWorkspace.boards.main,
    id: 'casa',
    title: 'Casa'
  };
  activeCasaWorkspace.boardOrder = ['main', 'casa'];
  activeCasaWorkspace.ui.activeBoardId = 'casa';
  const service = createCollaborationServiceDouble({
    acceptWorkspace: {
      ...invitedWorkspace,
      boards: {
        ...invitedWorkspace.boards,
        casa: {
          ...invitedWorkspace.boards.main,
          id: 'casa',
          title: 'Casa'
        }
      },
      boardOrder: ['main', 'casa'],
      ui: {
        ...invitedWorkspace.ui,
        activeBoardId: 'main'
      }
    },
    setActiveBoardWorkspace: activeCasaWorkspace
  });

  const result = await performWorkspaceInviteDecision({
    service,
    decision: 'accept',
    detail: {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      inviteId: 'invite_casa_1'
    },
    viewerActor,
    activeWorkspaceId: 'workspace_home'
  });

  assert.deepEqual(result, {
    workspace: activeCasaWorkspace,
    leftWorkspace: false
  });
  assert.deepEqual(service.calls, [
    {
      method: 'setActiveWorkspace',
      args: ['workspace_invited_casa']
    },
    {
      method: 'acceptBoardInvite',
      args: ['casa', 'invite_casa_1', 'workspace_invited_casa']
    },
    {
      method: 'setActiveBoard',
      args: ['casa']
    }
  ]);
});

test('performWorkspaceInviteDecision skips the extra board activation when the accepted board is already active', async () => {
  const viewerActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const invitedWorkspace = createViewerWorkspace('workspace_invited_casa', viewerActor);

  invitedWorkspace.boards.casa = {
    ...invitedWorkspace.boards.main,
    id: 'casa',
    title: 'Casa'
  };
  invitedWorkspace.boardOrder = ['main', 'casa'];
  invitedWorkspace.ui.activeBoardId = 'casa';

  const service = createCollaborationServiceDouble({
    acceptWorkspace: invitedWorkspace
  });

  const result = await performWorkspaceInviteDecision({
    service,
    decision: 'accept',
    detail: {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      inviteId: 'invite_casa_1'
    },
    viewerActor,
    activeWorkspaceId: 'workspace_home'
  });

  assert.deepEqual(result, {
    workspace: invitedWorkspace,
    leftWorkspace: false
  });
  assert.deepEqual(service.calls, [
    {
      method: 'setActiveWorkspace',
      args: ['workspace_invited_casa']
    },
    {
      method: 'acceptBoardInvite',
      args: ['casa', 'invite_casa_1', 'workspace_invited_casa']
    }
  ]);
});

test('performWorkspaceInviteDecision returns to the home workspace when declining the last visible invite in a shared workspace', async () => {
  const viewerActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const noAccessWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared',
    creator: createActor('owner_1', 'owner@example.com', 'Owner')
  });
  const homeWorkspace = createViewerWorkspace('workspace_home', viewerActor);
  const service = createCollaborationServiceDouble({
    declineWorkspace: noAccessWorkspace,
    switchWorkspace: homeWorkspace
  });

  const result = await performWorkspaceInviteDecision({
    service,
    decision: 'decline',
    detail: {
      boardId: 'main',
      inviteId: 'invite_1'
    },
    viewerActor,
    activeWorkspaceId: 'workspace_shared'
  });

  assert.deepEqual(result, {
    workspace: homeWorkspace,
    leftWorkspace: true
  });
  assert.deepEqual(service.calls, [
    {
      method: 'declineBoardInvite',
      args: ['main', 'invite_1', 'workspace_shared']
    },
    {
      method: 'switchWorkspace',
      args: [null]
    }
  ]);
});

test('performWorkspaceInviteDecision restores the previous workspace after cross-workspace decline', async () => {
  const viewerActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');
  const homeWorkspace = createViewerWorkspace('workspace_home', viewerActor);
  const service = createCollaborationServiceDouble({
    declineWorkspace: createEmptyWorkspace({ workspaceId: 'workspace_invited_casa' }),
    switchWorkspace: homeWorkspace
  });

  const result = await performWorkspaceInviteDecision({
    service,
    decision: 'decline',
    detail: {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      inviteId: 'invite_casa_1'
    },
    viewerActor,
    activeWorkspaceId: 'workspace_home'
  });

  assert.deepEqual(result, {
    workspace: homeWorkspace,
    leftWorkspace: false
  });
  assert.deepEqual(service.calls, [
    {
      method: 'setActiveWorkspace',
      args: ['workspace_invited_casa']
    },
    {
      method: 'declineBoardInvite',
      args: ['casa', 'invite_casa_1', 'workspace_invited_casa']
    },
    {
      method: 'switchWorkspace',
      args: ['workspace_home']
    }
  ]);
});

test('viewer and invite-only actors stay read-only in collaboration state', () => {
  const board = createWorkspaceBoard({
    id: 'board_read_only',
    title: 'Read only board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z',
    creator: createActor('owner_1', 'owner@example.com', 'Owner')
  });
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const inviteeActor = createActor('invitee_sub', 'invitee@example.com', 'Invitee');

  board.collaboration.memberships.push({
    actor: viewerActor,
    role: 'viewer',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });
  board.collaboration.invites.push({
    id: 'invite_1',
    email: inviteeActor.email,
    role: 'viewer',
    status: 'pending',
    invitedBy: board.collaboration.memberships[0].actor,
    invitedAt: '2026-03-31T10:10:00.000Z'
  });

  const viewerState = getBoardCollaborationState(board, viewerActor);
  const inviteeState = getBoardCollaborationState(board, inviteeActor);

  assert.equal(viewerState.canRead, true);
  assert.equal(viewerState.canEdit, false);
  assert.equal(viewerState.canAdmin, false);
  assert.equal(inviteeState.canRead, false);
  assert.equal(inviteeState.canEdit, false);
  assert.equal(inviteeState.canAdmin, false);
  assert.equal(inviteeState.accessible, true);
  assert.equal(inviteeState.pendingInvites.length, 1);
});

test('empty filtered workspaces report no visible access and keep invite-exit flows safe', () => {
  const viewerActor = createActor('viewer_1', 'viewer@example.com', 'Viewer');
  const workspace = createEmptyWorkspace({
    workspaceId: 'workspace_filtered_empty',
    creator: createActor('owner_1', 'owner@example.com', 'Owner')
  });

  workspace.boardOrder = [];
  workspace.boards = {};
  workspace.ui.activeBoardId = null;

  assert.equal(hasVisibleWorkspaceAccess(workspace, viewerActor), false);
});

test('openEdit and openView card dialog state preserves raw localized card data and resolves the requested locale', () => {
  const board = createBoardWithCustomStages();
  const card = {
    id: 'card_localized',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: null
      },
      'es-CL': {
        title: 'Titulo por defecto',
        detailsMarkdown: 'Detalles por defecto',
        provenance: null
      }
    },
    localeRequests: {
      ja: {
        locale: 'ja',
        status: 'open',
        requestedBy: { type: 'human', id: 'viewer_123' },
        requestedAt: '2026-03-31T12:00:00.000Z'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'es-CL',
    supportedLocales: ['en', 'es-CL', 'ja'],
    requiredLocales: ['en', 'ja']
  };

  const editState = createRuntimeCardDialogState(card, board, {
    requestedLocale: 'ja',
    uiLocale: 'en',
    currentActorRole: 'editor',
    canEditLocalizedContent: true
  });
  const viewState = createRuntimeCardDialogState(card, board, {
    uiLocale: 'en',
    currentActorRole: 'viewer',
    canEditLocalizedContent: false
  });

  assert.equal(editState.card, card);
  assert.deepEqual(editState.card.contentByLocale, card.contentByLocale);
  assert.deepEqual(editState.card.localeRequests, card.localeRequests);
  assert.equal(editState.requestedLocale, 'ja');
  assert.equal(editState.currentActorRole, 'editor');
  assert.equal(editState.canEditLocalizedContent, true);
  assert.deepEqual(editState.displayVariant, {
    locale: 'es-CL',
    title: 'Titulo por defecto',
    detailsMarkdown: 'Detalles por defecto',
    provenance: null,
    review: {
      origin: 'human',
      verificationRequestedBy: null,
      verificationRequestedAt: null,
      verifiedBy: null,
      verifiedAt: null
    },
    isFallback: true,
    source: 'localized'
  });

  assert.equal(viewState.card, card);
  assert.equal(viewState.requestedLocale, null);
  assert.equal(viewState.currentActorRole, 'viewer');
  assert.equal(viewState.canEditLocalizedContent, false);
  assert.deepEqual(viewState.displayVariant, {
    locale: 'en',
    title: 'English source',
    detailsMarkdown: 'English details',
    provenance: null,
    review: {
      origin: 'human',
      verificationRequestedBy: null,
      verificationRequestedAt: null,
      verifiedBy: null,
      verifiedAt: null
    },
    isFallback: true,
    source: 'localized'
  });
});

test('createRuntimeCardDialogState defaults to the ui locale when no explicit locale is requested', () => {
  const board = createBoardWithCustomStages();
  const card = {
    id: 'card_localized',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: null
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文',
        provenance: null
      }
    },
    localeRequests: {}
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const editState = createRuntimeCardDialogState(card, board, {
    uiLocale: 'ja',
    currentActorRole: 'editor',
    canEditLocalizedContent: true
  });
  const viewState = createRuntimeCardDialogState(card, board, {
    uiLocale: 'ja',
    currentActorRole: 'viewer',
    canEditLocalizedContent: false
  });

  assert.equal(editState.requestedLocale, null);
  assert.equal(editState.displayVariant?.locale, 'ja');
  assert.equal(editState.displayVariant?.title, '日本語タイトル');
  assert.equal(viewState.requestedLocale, null);
  assert.equal(viewState.displayVariant?.locale, 'ja');
  assert.equal(viewState.displayVariant?.title, '日本語タイトル');
});

test('openView defaults to ui-locale content when that locale exists for the card', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController({
      uiLocale: 'ja',
      contentByLocale: {
        en: {
          title: 'English source',
          detailsMarkdown: 'English details',
          provenance: null
        },
        ja: {
          title: '日本語タイトル',
          detailsMarkdown: '日本語本文',
          provenance: null
        }
      },
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en', 'ja'],
        requiredLocales: ['en']
      }
    });

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: createViewTriggerDouble(card.id, 'review')
    });

    assert.deepEqual(
      controller.viewLocaleSelectTarget.options.map((option) => option.value),
      ['en', 'ja']
    );
    assert.equal(controller.viewLocaleSelectTarget.value, 'ja');
    assert.equal(controller.viewDialogState.selectedLocale, 'ja');
    assert.equal(controller.viewCardTitleTarget.textContent, '日本語タイトル');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>日本語本文</p>');
  } finally {
    restoreDom();
  }
});

test('openView falls back from a regional ui locale to same-language content when present', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController({
      uiLocale: 'es-CL',
      contentByLocale: {
        en: {
          title: 'English source',
          detailsMarkdown: 'English details',
          provenance: null
        },
        es: {
          title: 'Titulo en español',
          detailsMarkdown: 'Detalles en español',
          provenance: null
        }
      },
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en', 'es'],
        requiredLocales: ['en']
      }
    });

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: createViewTriggerDouble(card.id, 'review')
    });

    assert.deepEqual(
      controller.viewLocaleSelectTarget.options.map((option) => option.value),
      ['en', 'es']
    );
    assert.equal(controller.viewLocaleSelectTarget.value, 'es');
    assert.equal(controller.viewDialogState.selectedLocale, 'es');
    assert.equal(controller.viewCardTitleTarget.textContent, 'Titulo en español');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>Detalles en español</p>');
  } finally {
    restoreDom();
  }
});

test('openView resolves legacy jp content as ja when bootstrapped data is legacy-shaped', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController({
      uiLocale: 'ja',
      contentByLocale: {
        en: {
          title: 'English source',
          detailsMarkdown: 'English details',
          provenance: null
        },
        jp: {
          title: '旧日本語タイトル',
          detailsMarkdown: '旧日本語本文',
          provenance: null
        }
      },
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'jp',
        supportedLocales: ['en', 'jp'],
        requiredLocales: ['en']
      }
    });

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: createViewTriggerDouble(card.id, 'review')
    });

    assert.equal(controller.viewLocaleSelectTarget.value, 'ja');
    assert.equal(controller.viewDialogState.selectedLocale, 'ja');
    assert.equal(controller.viewCardTitleTarget.textContent, '旧日本語タイトル');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>旧日本語本文</p>');
  } finally {
    restoreDom();
  }
});

test('openView uses the dedicated view dialog and limits locales to present localized variants', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController({ uiLocale: 'ja' });
    const trigger = createViewTriggerDouble(card.id, 'review');

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: trigger
    });

    assert.equal(controller.viewDialogTarget.open, true);
    assert.equal(controller.viewTriggerElement, trigger);
    assert.deepEqual(
      controller.viewLocaleSelectTarget.options.map((option) => option.value),
      ['en', 'es-CL']
    );
    assert.equal(controller.viewLocaleSelectTarget.value, 'es-CL');
    assert.equal(controller.viewDialogState.selectedLocale, 'es-CL');
    assert.equal(controller.viewCardTitleTarget.textContent, 'Titulo por defecto');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>Detalles por defecto</p>');
    assert.equal(controller.viewCardPrioritySectionTarget.hidden, false);
    assert.equal(controller.viewCardUpdatedTarget.textContent, 'Apr 1, 2026, 8:00 AM');
  } finally {
    restoreDom();
  }
});

test('openView preserves an explicit requested locale from the trigger', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController({ uiLocale: 'ja' });
    const trigger = createViewTriggerDouble(card.id, 'review', { requestedLocale: 'ja' });

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: trigger
    });

    assert.equal(controller.viewDialogTarget.open, true);
    assert.equal(controller.viewTriggerElement, trigger);
    assert.deepEqual(
      controller.viewLocaleSelectTarget.options.map((option) => option.value),
      ['en', 'es-CL']
    );
    assert.equal(controller.viewLocaleSelectTarget.value, 'es-CL');
    assert.equal(controller.viewDialogState.selectedLocale, 'es-CL');
    assert.equal(controller.viewCardTitleTarget.textContent, 'Titulo por defecto');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>Detalles por defecto</p>');
    assert.equal(controller.viewCardPrioritySectionTarget.hidden, false);
    assert.equal(controller.viewCardUpdatedTarget.textContent, 'Apr 1, 2026, 8:00 AM');
  } finally {
    restoreDom();
  }
});

test('changeViewLocale rerenders the localized reader content', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, card } = createViewDialogController();

    WorkspaceController.prototype.openView.call(controller, {
      currentTarget: createViewTriggerDouble(card.id, 'review', { requestedLocale: 'es-CL' })
    });

    WorkspaceController.prototype.changeViewLocale.call(controller, {
      preventDefault() {},
      currentTarget: {
        value: 'en'
      }
    });

    assert.equal(controller.viewDialogState.selectedLocale, 'en');
    assert.equal(controller.viewLocaleSelectTarget.value, 'en');
    assert.equal(controller.viewCardTitleTarget.textContent, 'English source');
    assert.equal(controller.viewCardBodyTarget.innerHTML, '<p>English details</p>');
  } finally {
    restoreDom();
  }
});

test('syncViewDialog uses the empty-details fallback when the selected locale has no markdown body', () => {
  const restoreDom = installViewDialogDomStubs();

  try {
    const { controller, board, card } = createViewDialogController({
      contentByLocale: {
        en: {
          title: 'English source',
          detailsMarkdown: ''
        }
      },
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en', 'ja'],
        requiredLocales: ['en']
      }
    });

    controller.viewDialogState = {
      board,
      card,
      stageId: 'review',
      selectedLocale: 'en'
    };

    WorkspaceController.prototype.syncViewDialog.call(controller);

    assert.equal(controller.viewLocaleSectionTarget.hidden, false);
    assert.deepEqual(
      controller.viewLocaleSelectTarget.options.map((option) => option.value),
      ['en']
    );
    assert.equal(controller.viewCardTitleTarget.textContent, 'English source');
    assert.equal(controller.viewCardBodyTarget.textContent, 'No details added.');
  } finally {
    restoreDom();
  }
});

test('localized save planning calls upsertCardLocale first and keeps priority and stage updates alongside it', () => {
  const board = createBoardWithCustomStages();
  const card = {
    id: 'card_localized',
    priority: 'important',
    updatedAt: '2026-03-31T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: null
      }
    },
    localeRequests: {
      ja: {
        locale: 'ja',
        status: 'open',
        requestedBy: { type: 'human', id: 'viewer_123' },
        requestedAt: '2026-03-31T12:00:00.000Z'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const plan = buildCardEditorMutationPlan({
    mode: 'edit',
    board,
    card,
    boardId: 'main',
    cardId: 'card_localized',
    locale: 'ja',
    input: {
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文',
      priority: 'urgent'
    },
    sourceStageId: 'review',
    targetStageId: 'qa'
  });

  assert.equal(plan.includesLocalizedUpsert, true);
  assert.deepEqual(plan.operations, [
    {
      method: 'upsertCardLocale',
      args: [
        'main',
        'card_localized',
        'ja',
        {
          title: '日本語タイトル',
          detailsMarkdown: '日本語本文'
        }
      ]
    },
    {
      method: 'updateCard',
      args: [
        'main',
        'card_localized',
        {
          priority: 'urgent'
        }
      ]
    },
    {
      method: 'moveCard',
      args: ['main', 'card_localized', 'review', 'qa']
    }
  ]);
});

test('admin can manually edit an existing locale through the localized save plan', () => {
  const board = createBoardWithCustomStages();
  const card = {
    id: 'card_localized_admin',
    priority: 'important',
    updatedAt: '2026-03-31T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: null
      },
      ja: {
        title: '旧日本語タイトル',
        detailsMarkdown: '旧日本語本文',
        provenance: null
      }
    },
    localeRequests: {}
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const plan = buildCardEditorMutationPlan({
    mode: 'edit',
    board,
    card,
    boardId: 'main',
    cardId: 'card_localized_admin',
    locale: 'ja',
    input: {
      title: '新しい日本語タイトル',
      detailsMarkdown: '更新された日本語本文',
      priority: 'important'
    },
    sourceStageId: 'review',
    targetStageId: 'review'
  });

  assert.equal(plan.includesLocalizedUpsert, true);
  assert.deepEqual(plan.operations, [
    {
      method: 'upsertCardLocale',
      args: [
        'main',
        'card_localized_admin',
        'ja',
        {
          title: '新しい日本語タイトル',
          detailsMarkdown: '更新された日本語本文'
        }
      ]
    }
  ]);
});

test('create mode planning still uses createCard without regressing the old flow', () => {
  const plan = buildCardEditorMutationPlan({
    mode: 'create',
    boardId: 'main',
    input: {
      title: 'Create me',
      detailsMarkdown: 'Still source-locale pinned for now',
      priority: 'important'
    }
  });

  assert.equal(plan.includesLocalizedUpsert, false);
  assert.deepEqual(plan.operations, [
    {
      method: 'createCard',
      args: [
        'main',
        {
          title: 'Create me',
          detailsMarkdown: 'Still source-locale pinned for now',
          priority: 'important'
        }
      ]
    }
  ]);
});

test('locale request and clear flows call the matching service methods', () => {
  assert.deepEqual(
    createCardLocaleRequestAction({
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }),
    {
      method: 'requestCardLocale',
      args: ['main', 'card_1', 'ja']
    }
  );

  assert.deepEqual(
    createCardLocaleRequestAction({
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja',
      clear: true
    }),
    {
      method: 'clearCardLocaleRequest',
      args: ['main', 'card_1', 'ja']
    }
  );
});

test('handleGenerateCardLocalization calls the service, applies workspace state, and refreshes the editor when it is still open', async () => {
  const initialWorkspace = createEmptyWorkspace();
  const updatedWorkspace = createEmptyWorkspace();
  const controller = Object.create(WorkspaceController.prototype);
  const refreshCalls = [];
  const announcements = [];
  const dispatchedEvents = [];
  const serviceCalls = [];
  let renderCalls = 0;

  updatedWorkspace.workspaceId = initialWorkspace.workspaceId;

  controller.workspace = initialWorkspace;
  controller.service = {
    async generateCardLocalization(...args) {
      serviceCalls.push(args);
      return updatedWorkspace;
    }
  };
  controller.t = createTranslator('en');
  controller.render = () => {
    renderCalls += 1;
  };
  controller.announce = (message) => {
    announcements.push(message);
  };
  controller.refreshCardEditor = (detail) => {
    refreshCalls.push(detail);
  };
  controller.isCardEditorOpenFor = () => true;
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  await WorkspaceController.prototype.handleGenerateCardLocalization.call(controller, {
    detail: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  });

  assert.deepEqual(serviceCalls, [['main', 'card_1', 'ja']]);
  assert.equal(controller.workspace, updatedWorkspace);
  assert.equal(renderCalls, 1);
  assert.deepEqual(announcements, ['Localization generated.']);
  assert.deepEqual(refreshCalls, [
    {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja',
      mode: 'edit'
    }
  ]);
  assert.deepEqual(dispatchedEvents, [
    {
      name: 'card-localization-generation-finished',
      detail: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        success: true
      }
    }
  ]);
});

test('handleGenerateCardLocalization ignores repeated clicks while the same localization is already pending', async () => {
  const controller = Object.create(WorkspaceController.prototype);
  const serviceCalls = [];
  let resolveWorkspace;

  controller.workspace = createEmptyWorkspace();
  controller.service = {
    async generateCardLocalization(...args) {
      serviceCalls.push(args);
      return new Promise((resolve) => {
        resolveWorkspace = () => resolve(createEmptyWorkspace());
      });
    }
  };
  controller.t = createTranslator('en');
  controller.render = () => {};
  controller.announce = () => {};
  controller.refreshCardEditor = () => {};
  controller.isCardEditorOpenFor = () => false;
  controller.dispatchWorkspaceEvent = () => {};

  const detail = {
    detail: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  };
  const firstCall = WorkspaceController.prototype.handleGenerateCardLocalization.call(controller, detail);
  const secondCall = WorkspaceController.prototype.handleGenerateCardLocalization.call(controller, detail);

  resolveWorkspace();
  await Promise.all([firstCall, secondCall]);

  assert.deepEqual(serviceCalls, [['main', 'card_1', 'ja']]);
});

test('handleGenerateCardLocalization reports localized failures and skips refresh when generation fails', async () => {
  const controller = Object.create(WorkspaceController.prototype);
  const refreshCalls = [];
  const announcements = [];
  const dispatchedEvents = [];
  const error = new Error('This workspace changed elsewhere. Refresh to continue.');
  const originalConsoleError = console.error;

  error.data = {
    errorCode: 'LOCALIZATION_HUMAN_AUTHORED_CONFLICT'
  };

  controller.workspace = createEmptyWorkspace();
  controller.service = {
    async generateCardLocalization() {
      throw error;
    }
  };
  controller.t = createTranslator('en');
  controller.render = () => {
    throw new Error('render should not be called on failed generation');
  };
  controller.announce = (message) => {
    announcements.push(message);
  };
  controller.refreshCardEditor = (detail) => {
    refreshCalls.push(detail);
  };
  controller.isCardEditorOpenFor = () => true;
  controller.dispatchWorkspaceEvent = (name, detail) => {
    dispatchedEvents.push({ name, detail });
  };

  console.error = () => {};

  try {
    await WorkspaceController.prototype.handleGenerateCardLocalization.call(controller, {
      detail: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(announcements, [
    'Cannot overwrite human-authored localization with AI-generated content.'
  ]);
  assert.deepEqual(refreshCalls, []);
  assert.deepEqual(dispatchedEvents, [
    {
      name: 'card-localization-generation-finished',
      detail: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        success: false
      }
    }
  ]);
});

test('confirmPendingAction discards localized content and refreshes the editor on the same locale', async () => {
  const controller = Object.create(WorkspaceController.prototype);
  const serviceCalls = [];
  const refreshCalls = [];

  controller.pendingConfirmation = {
    type: 'discard-card-locale',
    boardId: 'main',
    cardId: 'card_1',
    locale: 'ja'
  };
  controller.confirmButtonTarget = {
    disabled: false
  };
  controller.service = {
    async discardCardLocale(...args) {
      serviceCalls.push(args);
      return createEmptyWorkspace();
    }
  };
  controller.t = createTranslator('en');
  controller.runAction = async (action) => {
    await action();
    return true;
  };
  controller.isCardEditorOpenFor = () => true;
  controller.refreshCardEditor = (detail) => {
    refreshCalls.push(detail);
  };
  controller.closeConfirmDialog = () => {
    controller.closed = true;
  };

  await WorkspaceController.prototype.confirmPendingAction.call(controller);

  assert.deepEqual(serviceCalls, [['main', 'card_1', 'ja']]);
  assert.deepEqual(refreshCalls, [
    {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja',
      mode: 'edit'
    }
  ]);
  assert.equal(controller.closed, true);
  assert.equal(controller.confirmButtonTarget.disabled, false);
});

function createBoardWithCustomStages() {
  const board = createWorkspaceBoard({
    id: 'board_flow',
    title: 'Workflow board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['review', 'qa', 'published'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [],
      allowedTransitionStageIds: ['qa', 'published'],
      templateIds: [],
      actionIds: []
    },
    qa: {
      id: 'qa',
      title: 'QA Sweep',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: [],
      actionIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['review'],
      templateIds: [],
      actionIds: []
    }
  };

  return board;
}

function createViewerWorkspace(workspaceId, actor) {
  const workspace = createEmptyWorkspace({
    workspaceId,
    creator: createActor(`owner_${workspaceId}`, `owner+${workspaceId}@example.com`, 'Owner')
  });

  workspace.boards.main.collaboration.memberships.push({
    actor,
    role: 'viewer',
    joinedAt: '2026-03-31T10:05:00.000Z'
  });

  return workspace;
}

function createAccessibleWorkspaceSummary({
  workspaceId,
  isHomeWorkspace = false,
  boards = []
} = {}) {
  return {
    workspaceId,
    isHomeWorkspace,
    boards: boards.map((board) => ({ ...board }))
  };
}

function createCollaborationServiceDouble({
  workspace = createEmptyWorkspace(),
  acceptWorkspace = workspace,
  declineWorkspace = workspace,
  switchWorkspace = workspace,
  setActiveBoardWorkspace = acceptWorkspace
} = {}) {
  return {
    activeWorkspaceId: null,
    calls: [],
    setActiveWorkspace(...args) {
      this.calls.push({ method: 'setActiveWorkspace', args });
      this.activeWorkspaceId = args[0] ?? null;
    },
    async inviteBoardMember(...args) {
      this.calls.push({ method: 'inviteBoardMember', args });
      return structuredClone(workspace);
    },
    async revokeBoardInvite(...args) {
      this.calls.push({ method: 'revokeBoardInvite', args });
      return structuredClone(workspace);
    },
    async setBoardMemberRole(...args) {
      this.calls.push({ method: 'setBoardMemberRole', args });
      return structuredClone(workspace);
    },
    async removeBoardMember(...args) {
      this.calls.push({ method: 'removeBoardMember', args });
      return structuredClone(workspace);
    },
    async acceptBoardInvite(...args) {
      this.calls.push({ method: 'acceptBoardInvite', args });
      return structuredClone(acceptWorkspace);
    },
    async setActiveBoard(...args) {
      this.calls.push({ method: 'setActiveBoard', args });
      return structuredClone(setActiveBoardWorkspace);
    },
    async declineBoardInvite(...args) {
      this.calls.push({ method: 'declineBoardInvite', args });
      return structuredClone(declineWorkspace);
    },
    async switchWorkspace(...args) {
      this.calls.push({ method: 'switchWorkspace', args });
      return structuredClone(switchWorkspace);
    }
  };
}

function createWorkspaceNavigationServiceDouble({
  activeWorkspaceId = null,
  isHomeWorkspace = false,
  switchWorkspaceResult = createEmptyWorkspace(),
  setActiveBoardResult = switchWorkspaceResult,
  loadResult = switchWorkspaceResult
} = {}) {
  return {
    activeWorkspaceId,
    isHomeWorkspace,
    calls: [],
    getActiveWorkspaceId() {
      return this.activeWorkspaceId;
    },
    getIsHomeWorkspace() {
      return this.isHomeWorkspace;
    },
    async switchWorkspace(...args) {
      this.calls.push({ method: 'switchWorkspace', args });
      this.activeWorkspaceId = args[0] ?? null;
      this.isHomeWorkspace = args[0] == null;
      return structuredClone(switchWorkspaceResult);
    },
    async setActiveBoard(...args) {
      this.calls.push({ method: 'setActiveBoard', args });
      return structuredClone(setActiveBoardResult);
    },
    setActiveWorkspace(...args) {
      this.calls.push({ method: 'setActiveWorkspace', args });
      this.activeWorkspaceId = args[0] ?? null;
      this.isHomeWorkspace = args[0] == null;
    },
    async load(...args) {
      this.calls.push({ method: 'load', args });
      return structuredClone(loadResult);
    }
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

function createColumnPanelDouble({ stageId, columnId, cardCount = 0 } = {}) {
  const bodyElement = {
    hidden: false
  };
  const cardsElement = {
    childElementCount: cardCount
  };
  const element = {
    dataset: {
      collapsed: 'false',
      stageId,
      columnId
    },
    querySelector(selector) {
      if (selector === '[data-column-toggle]') {
        return toggleElement;
      }

      if (selector === '.column-panel-body') {
        return bodyElement;
      }

      if (selector === '[data-column-cards]') {
        return cardsElement;
      }

      return null;
    }
  };
  const toggleElement = {
    dataset: {
      stageId,
      columnId
    },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    closest(selector) {
      return selector === '.column-panel' ? element : null;
    }
  };

  return {
    element,
    toggleElement,
    bodyElement,
    cardsElement
  };
}

function createViewDialogController({
  uiLocale = 'en',
  contentByLocale = {
    en: {
      title: 'English source',
      detailsMarkdown: 'English details',
      provenance: null
    },
    'es-CL': {
      title: 'Titulo por defecto',
      detailsMarkdown: 'Detalles por defecto',
      provenance: null
    }
  },
  languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'es-CL',
    supportedLocales: ['en', 'es-CL', 'ja'],
    requiredLocales: ['en', 'ja']
  }
} = {}) {
  const workspace = createEmptyWorkspace();
  const board = createBoardWithCustomStages();
  const card = {
    id: 'card_localized',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T11:00:00.000Z',
    contentByLocale,
    localeRequests: {
      ja: {
        locale: 'ja',
        status: 'open',
        requestedBy: { type: 'human', id: 'viewer_123' },
        requestedAt: '2026-03-31T12:00:00.000Z'
      }
    }
  };

  board.languagePolicy = languagePolicy;
  board.cards[card.id] = card;
  board.stages.review.cardIds = [card.id];
  workspace.boards = {
    [board.id]: board
  };
  workspace.boardOrder = [board.id];
  workspace.ui.activeBoardId = board.id;

  const controller = Object.create(WorkspaceController.prototype);
  controller.workspace = workspace;
  controller.t = Object.assign(
    (key) => (key === 'workspace.view.noDetails' ? 'No details added.' : key),
    { locale: uiLocale }
  );
  controller.dateTimeFormatter = {
    format() {
      return 'Apr 1, 2026, 8:00 AM';
    }
  };
  controller.viewDialogTarget = createDialogDouble();
  controller.hasViewLocaleSectionTarget = true;
  controller.viewLocaleSectionTarget = { hidden: true };
  controller.hasViewLocaleSelectTarget = true;
  controller.viewLocaleSelectTarget = createSelectDouble();
  controller.viewCardTitleTarget = { textContent: '' };
  controller.viewCardBodyTarget = createContentRegionDouble();
  controller.viewCardPrioritySectionTarget = { hidden: true };
  controller.viewCardPriorityTarget = { textContent: '' };
  controller.viewCardUpdatedTarget = { textContent: '' };
  controller.viewDialogState = null;
  controller.viewTriggerElement = null;

  return {
    controller,
    workspace,
    board,
    card
  };
}

function createViewTriggerDouble(cardId, stageId, { requestedLocale = null } = {}) {
  return {
    dataset: {
      cardId,
      stageId,
      columnId: stageId,
      ...(requestedLocale ? { requestedLocale } : {})
    },
    isConnected: true,
    focus() {
      this.focused = true;
    }
  };
}

function createDialogDouble() {
  return {
    open: false,
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector() {
      return {
        focus() {}
      };
    }
  };
}

function createSelectDouble() {
  return {
    options: [],
    value: '',
    disabled: false,
    attributes: {},
    replaceChildren(...options) {
      this.options = options;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    focus() {
      this.focused = true;
    }
  };
}

function createContentRegionDouble() {
  let innerHTML = '';
  let textContent = '';

  return {
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value) {
      innerHTML = String(value);
      textContent = innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    },
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      innerHTML = '';
      textContent = String(value);
    }
  };
}

function installViewDialogDomStubs() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  globalThis.window = {
    marked: {
      parse(input) {
        return `<p>${String(input)}</p>`;
      }
    },
    DOMPurify: {
      sanitize(input) {
        return input;
      }
    }
  };

  globalThis.document = {
    createElement(tagName) {
      if (tagName === 'option') {
        return {
          value: '',
          textContent: ''
        };
      }

      return createContentRegionDouble();
    }
  };

  return function restoreViewDialogDomStubs() {
    if (typeof originalWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }

    if (typeof originalDocument === 'undefined') {
      delete globalThis.document;
    } else {
      globalThis.document = originalDocument;
    }
  };
}
