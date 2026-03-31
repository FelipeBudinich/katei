import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyWorkspace,
  createWorkspaceBoard
} from '../public/js/domain/workspace_read_model.js';
import { getBoardCollaborationState } from '../public/js/controllers/board_collaboration_state.js';
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
import { createRuntimeCardDialogState } from '../public/js/controllers/workspace_card_dialog.js';

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
      args: ['main', 'invite_1']
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
      args: ['main', 'invite_1']
    },
    {
      method: 'switchWorkspace',
      args: [null]
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
    requestedLocale: 'ja'
  });
  const viewState = createRuntimeCardDialogState(card, board, {
    requestedLocale: 'en'
  });

  assert.equal(editState.card, card);
  assert.deepEqual(editState.card.contentByLocale, card.contentByLocale);
  assert.deepEqual(editState.card.localeRequests, card.localeRequests);
  assert.equal(editState.requestedLocale, 'ja');
  assert.deepEqual(editState.displayVariant, {
    locale: 'es-CL',
    title: 'Titulo por defecto',
    detailsMarkdown: 'Detalles por defecto',
    provenance: null,
    isFallback: true,
    source: 'localized'
  });

  assert.equal(viewState.card, card);
  assert.equal(viewState.requestedLocale, 'en');
  assert.deepEqual(viewState.displayVariant, {
    locale: 'en',
    title: 'English source',
    detailsMarkdown: 'English details',
    provenance: null,
    isFallback: false,
    source: 'localized'
  });
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

function createCollaborationServiceDouble({
  workspace = createEmptyWorkspace(),
  acceptWorkspace = workspace,
  declineWorkspace = workspace,
  switchWorkspace = workspace
} = {}) {
  return {
    calls: [],
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

function createActor(id, email, displayName) {
  return {
    type: 'human',
    id,
    email,
    displayName
  };
}
