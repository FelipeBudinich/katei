import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { WorkspaceService } from '../public/js/services/workspace_service.js';

test('WorkspaceService load keeps using repository.loadWorkspace', async () => {
  const workspace = createEmptyWorkspace();
  const repository = createRepositoryDouble({ workspace });
  const service = new WorkspaceService(repository);

  const loadedWorkspace = await service.load();

  assert.deepEqual(loadedWorkspace, workspace);
  assert.equal(repository.loadCalls, 1);
  assert.equal(repository.applyCommandCalls.length, 0);
});

test('WorkspaceService exposes the repository active workspace id', () => {
  const workspace = createEmptyWorkspace();
  const repository = createRepositoryDouble({ workspace, activeWorkspaceId: 'workspace_home' });
  const service = new WorkspaceService(repository);

  assert.equal(service.getActiveWorkspaceId(), 'workspace_home');
});

test('WorkspaceService exposes the repository pending workspace invites', () => {
  const workspace = createEmptyWorkspace();
  const pendingWorkspaceInvites = [
    {
      workspaceId: 'workspace_shared',
      boardId: 'casa',
      boardTitle: 'Casa',
      inviteId: 'invite_1',
      role: 'viewer',
      invitedAt: '2026-04-01T10:00:00.000Z',
      invitedBy: {
        id: 'sub_owner',
        email: 'owner@example.com',
        displayName: 'Owner'
      }
    }
  ];
  const repository = createRepositoryDouble({ workspace, pendingWorkspaceInvites });
  const service = new WorkspaceService(repository);

  assert.deepEqual(service.getPendingWorkspaceInvites(), pendingWorkspaceInvites);
});

test('WorkspaceService exposes the repository accessible workspaces', () => {
  const workspace = createEmptyWorkspace();
  const accessibleWorkspaces = [
    {
      workspaceId: 'workspace_shared',
      isHomeWorkspace: false,
      boards: [
        {
          boardId: 'casa',
          boardTitle: 'Casa',
          role: 'viewer'
        }
      ]
    }
  ];
  const repository = createRepositoryDouble({ workspace, accessibleWorkspaces });
  const service = new WorkspaceService(repository);

  assert.deepEqual(service.getAccessibleWorkspaces(), accessibleWorkspaces);
});

test('WorkspaceService setActiveWorkspace delegates to the repository switch helper', () => {
  const workspace = createEmptyWorkspace();
  const repository = createRepositoryDouble({ workspace });
  const service = new WorkspaceService(repository);

  service.setActiveWorkspace('workspace_shared');

  assert.equal(repository.activeWorkspaceId, 'workspace_shared');
  assert.deepEqual(repository.setActiveWorkspaceCalls, ['workspace_shared']);
  assert.deepEqual(repository.events, ['set:workspace_shared']);
});

test('WorkspaceService switchWorkspace updates the active workspace before reloading', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_shared' });
  const repository = createRepositoryDouble({ workspace });
  const service = new WorkspaceService(repository);

  const loadedWorkspace = await service.switchWorkspace('workspace_shared');

  assert.deepEqual(loadedWorkspace, workspace);
  assert.equal(repository.activeWorkspaceId, 'workspace_shared');
  assert.equal(repository.loadCalls, 1);
  assert.deepEqual(repository.setActiveWorkspaceCalls, ['workspace_shared']);
  assert.deepEqual(repository.events, ['set:workspace_shared', 'load']);
});

test('WorkspaceService setWorkspaceTitle resolves the target workspace revision and returns title mutation data', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_shared' });

  workspace.title = 'Studio HQ';

  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 344,
    lastRevisionWorkspaceId: 'workspace_home',
    resolveWorkspaceRevisionMap: {
      workspace_shared: 3
    }
  });
  const service = new WorkspaceService(repository);

  const result = await service.setWorkspaceTitle('workspace_shared', '  Studio HQ  ');

  assert.deepEqual(repository.resolveWorkspaceRevisionCalls, ['workspace_shared']);
  assert.equal(repository.setWorkspaceTitleCalls.length, 1);
  assert.match(repository.setWorkspaceTitleCalls[0].clientMutationId, /^cmd_/);
  assert.deepEqual(repository.setWorkspaceTitleCalls[0], {
    clientMutationId: repository.setWorkspaceTitleCalls[0].clientMutationId,
    title: '  Studio HQ  '
  });
  assert.deepEqual(repository.setWorkspaceTitleContexts, [
    {
      workspaceId: 'workspace_shared',
      expectedRevision: 3
    }
  ]);
  assert.deepEqual(result.workspace, workspace);
  assert.deepEqual(result.activeWorkspace, {
    workspaceId: 'workspace_shared',
    workspaceTitle: 'Studio HQ',
    isHomeWorkspace: false
  });
  assert.deepEqual(result.meta, {
    revision: 1,
    updatedAt: '2026-04-04T10:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.deepEqual(result.result, {
    clientMutationId: repository.setWorkspaceTitleCalls[0].clientMutationId,
    type: 'workspace.title.set',
    noOp: false,
    workspaceId: 'workspace_shared',
    workspaceTitle: 'Studio HQ'
  });
  assert.equal(result.workspaceId, 'workspace_shared');
  assert.equal(result.workspaceTitle, 'Studio HQ');
});

test('WorkspaceService setWorkspaceTitle honors explicit expectedRevision and propagates repository errors', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_shared' });
  const conflictError = new Error('This workspace changed elsewhere. Refresh to continue.');

  conflictError.status = 409;

  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 344,
    lastRevisionWorkspaceId: 'workspace_home',
    setWorkspaceTitleError: conflictError
  });
  const service = new WorkspaceService(repository);

  await assert.rejects(
    service.setWorkspaceTitle('workspace_shared', 'Studio HQ', 27),
    conflictError
  );

  assert.deepEqual(repository.resolveWorkspaceRevisionCalls, []);
  assert.deepEqual(repository.setWorkspaceTitleContexts, [
    {
      workspaceId: 'workspace_shared',
      expectedRevision: 27
    }
  ]);
});

test('WorkspaceService createWorkspace delegates to repository.createWorkspace without touching active state', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_home' });
  const repository = createRepositoryDouble({ workspace });
  const service = new WorkspaceService(repository);

  const result = await service.createWorkspace({
    title: '  Studio HQ  '
  });

  assert.deepEqual(repository.createWorkspaceCalls, [
    {
      title: '  Studio HQ  '
    }
  ]);
  assert.deepEqual(result, {
    ok: true,
    result: {
      workspaceId: 'workspace_created_1',
      workspaceTitle: 'Studio HQ'
    }
  });
});

test('WorkspaceService createBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.createBoard({ title: 'Roadmap' }),
    expectedType: 'board.create',
    expectedPayload: {
      title: 'Roadmap'
    }
  });
});

test('WorkspaceService renameBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.renameBoard('main', 'Updated title'),
    expectedType: 'board.rename',
    expectedPayload: {
      boardId: 'main',
      title: 'Updated title'
    }
  });
});

test('WorkspaceService updateBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.updateBoard('main', {
        title: 'Updated title',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'ja',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['en']
        },
        aiProvider: 'openai',
        openAiApiKey: 'sk-board-1234',
        clearOpenAiApiKey: false,
        localizationGlossary: [
          {
            source: 'Omen of Sorrow',
            translations: {
              es: 'Omen of Sorrow'
            }
          }
        ],
        stageDefinitions: [
          {
            id: 'backlog',
            title: 'Backlog',
            allowedTransitionStageIds: ['review']
          },
          {
            id: 'review',
            title: 'Review',
            allowedTransitionStageIds: ['backlog']
          }
        ],
        templates: [
          {
            id: 'starter',
            title: 'Starter',
            initialStageId: 'backlog'
          }
        ]
      }),
    expectedType: 'board.update',
    expectedPayload: {
      boardId: 'main',
      title: 'Updated title',
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'ja',
        supportedLocales: ['en', 'ja'],
        requiredLocales: ['en']
      },
      aiProvider: 'openai',
      openAiApiKey: 'sk-board-1234',
      clearOpenAiApiKey: false,
      localizationGlossary: [
        {
          source: 'Omen of Sorrow',
          translations: {
            es: 'Omen of Sorrow'
          }
        }
      ],
      stageDefinitions: [
        {
          id: 'backlog',
          title: 'Backlog',
          allowedTransitionStageIds: ['review']
        },
        {
          id: 'review',
          title: 'Review',
          allowedTransitionStageIds: ['backlog']
        }
      ],
      templates: [
        {
          id: 'starter',
          title: 'Starter',
          initialStageId: 'backlog'
        }
      ]
    }
  });
});

test('WorkspaceService deleteBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.deleteBoard('main'),
    expectedType: 'board.delete',
    expectedPayload: {
      boardId: 'main'
    }
  });
});

test('WorkspaceService resetBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.resetBoard('main'),
    expectedType: 'board.reset',
    expectedPayload: {
      boardId: 'main'
    }
  });
});

test('WorkspaceService setActiveBoard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.setActiveBoard('main'),
    expectedType: 'ui.activeBoard.set',
    expectedPayload: {
      boardId: 'main'
    }
  });
});

test('WorkspaceService inviteBoardMember calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.inviteBoardMember('main', 'invitee@example.com', 'editor'),
    expectedType: 'board.invite.create',
    expectedPayload: {
      boardId: 'main',
      email: 'invitee@example.com',
      role: 'editor'
    }
  });
});

test('WorkspaceService revokeBoardInvite calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.revokeBoardInvite('main', 'invite_1'),
    expectedType: 'board.invite.revoke',
    expectedPayload: {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  });
});

test('WorkspaceService acceptBoardInvite calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.acceptBoardInvite('main', 'invite_1'),
    expectedType: 'board.invite.accept',
    expectedPayload: {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  });
});

test('WorkspaceService declineBoardInvite calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.declineBoardInvite('main', 'invite_1'),
    expectedType: 'board.invite.decline',
    expectedPayload: {
      boardId: 'main',
      inviteId: 'invite_1'
    }
  });
});

test('WorkspaceService invite acceptance resolves the target workspace revision for cross-workspace invites', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_shared' });
  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 344,
    lastRevisionWorkspaceId: 'workspace_home',
    resolveWorkspaceRevisionMap: {
      workspace_shared: 3
    }
  });
  const service = new WorkspaceService(repository);

  const resultWorkspace = await service.acceptBoardInvite('casa', 'invite_1', 'workspace_shared');

  assert.deepEqual(resultWorkspace, workspace);
  assert.deepEqual(repository.resolveWorkspaceRevisionCalls, ['workspace_shared']);
  assert.equal(repository.applyCommandCalls.length, 1);
  assert.equal(repository.applyCommandCalls[0].type, 'board.invite.accept');
  assert.deepEqual(repository.applyCommandCalls[0].payload, {
    boardId: 'casa',
    inviteId: 'invite_1'
  });
  assert.deepEqual(repository.applyCommandContexts, [
    {
      workspaceId: 'workspace_shared',
      expectedRevision: 3
    }
  ]);
});

test('WorkspaceService invite decline resolves the target workspace revision for cross-workspace invites', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_shared' });
  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 344,
    lastRevisionWorkspaceId: 'workspace_home',
    resolveWorkspaceRevisionMap: {
      workspace_shared: 3
    }
  });
  const service = new WorkspaceService(repository);

  const resultWorkspace = await service.declineBoardInvite('casa', 'invite_1', 'workspace_shared');

  assert.deepEqual(resultWorkspace, workspace);
  assert.deepEqual(repository.resolveWorkspaceRevisionCalls, ['workspace_shared']);
  assert.equal(repository.applyCommandCalls.length, 1);
  assert.equal(repository.applyCommandCalls[0].type, 'board.invite.decline');
  assert.deepEqual(repository.applyCommandCalls[0].payload, {
    boardId: 'casa',
    inviteId: 'invite_1'
  });
  assert.deepEqual(repository.applyCommandContexts, [
    {
      workspaceId: 'workspace_shared',
      expectedRevision: 3
    }
  ]);
});

test('WorkspaceService same-workspace invite decisions reuse the cached active workspace revision', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_home' });
  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 344,
    lastRevisionWorkspaceId: 'workspace_home'
  });
  const service = new WorkspaceService(repository);

  await service.acceptBoardInvite('main', 'invite_accept_1', 'workspace_home');
  await service.declineBoardInvite('main', 'invite_decline_1', 'workspace_home');

  assert.deepEqual(repository.resolveWorkspaceRevisionCalls, []);
  assert.equal(repository.applyCommandCalls.length, 2);
  assert.deepEqual(repository.applyCommandContexts, [
    {
      workspaceId: 'workspace_home',
      expectedRevision: 344
    },
    {
      workspaceId: 'workspace_home',
      expectedRevision: 344
    }
  ]);
});

test('WorkspaceService setBoardMemberRole calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.setBoardMemberRole(
        'main',
        {
          type: 'human',
          id: 'viewer_123',
          email: 'viewer@example.com'
        },
        'viewer'
      ),
    expectedType: 'board.member.role.set',
    expectedPayload: {
      boardId: 'main',
      targetActor: {
        type: 'human',
        id: 'viewer_123',
        email: 'viewer@example.com'
      },
      role: 'viewer'
    }
  });
});

test('WorkspaceService setBoardSelfRole calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.setBoardSelfRole(
        'main',
        'editor',
        {
          workspaceId: 'workspace_shared',
          expectedRevision: 12
        }
      ),
    expectedType: 'board.self.role.set',
    expectedPayload: {
      boardId: 'main',
      role: 'editor'
    },
    expectedContext: {
      workspaceId: 'workspace_shared',
      expectedRevision: 12
    }
  });
});

test('WorkspaceService removeBoardMember calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.removeBoardMember('main', {
        type: 'human',
        id: 'viewer_123'
      }),
    expectedType: 'board.member.remove',
    expectedPayload: {
      boardId: 'main',
      targetActor: {
        type: 'human',
        id: 'viewer_123'
      }
    }
  });
});

test('WorkspaceService createCard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.createCard('main', {
        stageId: 'doing',
        title: 'Ship service rewrite',
        detailsMarkdown: 'Server is the source of truth',
        priority: 'urgent',
        requiresReview: true
      }),
    expectedType: 'card.create',
    expectedPayload: {
      boardId: 'main',
      stageId: 'doing',
      title: 'Ship service rewrite',
      detailsMarkdown: 'Server is the source of truth',
      priority: 'urgent',
      requiresReview: true
    }
  });
});

test('WorkspaceService updateCard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.updateCard('main', 'card_1', {
        title: 'Updated title',
        detailsMarkdown: 'Updated details'
      }),
    expectedType: 'card.update',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      title: 'Updated title',
      detailsMarkdown: 'Updated details'
    }
  });
});

test('WorkspaceService upsertCardLocale calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) =>
      service.upsertCardLocale('main', 'card_1', 'es-CL', {
        title: 'Titulo actualizado',
        detailsMarkdown: 'Detalle actualizado'
      }),
    expectedType: 'card.locale.upsert',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'es-CL',
      title: 'Titulo actualizado',
      detailsMarkdown: 'Detalle actualizado'
    }
  });
});

test('WorkspaceService discardCardLocale calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.discardCardLocale('main', 'card_1', 'es-CL'),
    expectedType: 'card.locale.discard',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'es-CL'
    }
  });
});

test('WorkspaceService generateCardLocalization calls repository.generateCardLocalization and returns workspace', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_home' });
  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 12,
    lastRevisionWorkspaceId: 'workspace_home'
  });
  const service = new WorkspaceService(repository);

  const resultWorkspace = await service.generateCardLocalization('main', 'card_1', 'ja');

  assert.deepEqual(resultWorkspace, workspace);
  assert.equal(repository.generateCardLocalizationCalls.length, 1);
  assert.match(repository.generateCardLocalizationCalls[0].clientMutationId, /^cmd_/);
  assert.deepEqual(repository.generateCardLocalizationCalls[0], {
    clientMutationId: repository.generateCardLocalizationCalls[0].clientMutationId,
    boardId: 'main',
    cardId: 'card_1',
    targetLocale: 'ja'
  });
  assert.deepEqual(repository.generateCardLocalizationContexts, [
    {
      workspaceId: 'workspace_home',
      expectedRevision: 12
    }
  ]);
});

test('WorkspaceService runStagePrompt calls repository.runStagePrompt and returns workspace', async () => {
  const workspace = createEmptyWorkspace({ workspaceId: 'workspace_home' });
  const repository = createRepositoryDouble({
    workspace,
    activeWorkspaceId: 'workspace_home',
    revision: 12,
    lastRevisionWorkspaceId: 'workspace_home'
  });
  const service = new WorkspaceService(repository);

  const resultWorkspace = await service.runStagePrompt('main', 'card_1');

  assert.deepEqual(resultWorkspace, workspace);
  assert.equal(repository.runStagePromptCalls.length, 1);
  assert.match(repository.runStagePromptCalls[0].clientMutationId, /^cmd_/);
  assert.deepEqual(repository.runStagePromptCalls[0], {
    clientMutationId: repository.runStagePromptCalls[0].clientMutationId,
    boardId: 'main',
    cardId: 'card_1'
  });
  assert.deepEqual(repository.runStagePromptContexts, [
    {
      workspaceId: 'workspace_home',
      expectedRevision: 12
    }
  ]);
});

test('WorkspaceService requestCardLocale calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.requestCardLocale('main', 'card_1', 'ja'),
    expectedType: 'card.locale.request',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  });
});

test('WorkspaceService clearCardLocaleRequest calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.clearCardLocaleRequest('main', 'card_1', 'ja'),
    expectedType: 'card.locale.request.clear',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  });
});

test('WorkspaceService requestCardLocaleReview calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.requestCardLocaleReview('main', 'card_1', 'ja'),
    expectedType: 'card.locale.review.request',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  });
});

test('WorkspaceService verifyCardLocaleReview calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.verifyCardLocaleReview('main', 'card_1', 'ja'),
    expectedType: 'card.locale.review.verify',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    }
  });
});

test('WorkspaceService deleteCard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.deleteCard('main', 'card_1'),
    expectedType: 'card.delete',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1'
    }
  });
});

test('WorkspaceService approveCardReview calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.approveCardReview('main', 'card_1'),
    expectedType: 'card.review.approve',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1'
    }
  });
});

test('WorkspaceService rejectCardReview calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.rejectCardReview('main', 'card_1'),
    expectedType: 'card.review.reject',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1'
    }
  });
});

test('WorkspaceService moveCard calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.moveCard('main', 'card_1', 'backlog', 'doing'),
    expectedType: 'card.move',
    expectedPayload: {
      boardId: 'main',
      cardId: 'card_1',
      sourceColumnId: 'backlog',
      targetColumnId: 'doing'
    }
  });
});

async function assertServiceCommand({ action, expectedType, expectedPayload, expectedContext = undefined }) {
  const workspace = createEmptyWorkspace();
  const repository = createRepositoryDouble({ workspace });
  const service = new WorkspaceService(repository);

  const resultWorkspace = await action(service);

  assert.deepEqual(resultWorkspace, workspace);
  assert.equal(repository.loadCalls, 0);
  assert.equal(repository.saveCalls.length, 0);
  assert.equal(repository.applyCommandCalls.length, 1);
  assert.match(repository.applyCommandCalls[0].clientMutationId, /^cmd_/);
  assert.equal(repository.applyCommandCalls[0].type, expectedType);
  assert.deepEqual(repository.applyCommandCalls[0].payload, expectedPayload);

  if (expectedContext !== undefined) {
    assert.deepEqual(repository.applyCommandContexts[0], expectedContext);
  }
}

function createRepositoryDouble({
  workspace,
  activeWorkspaceId = null,
  pendingWorkspaceInvites = [],
  accessibleWorkspaces = [],
  isHomeWorkspace = false,
  revision = null,
  lastRevisionWorkspaceId = null,
  lastStateSource = 'api',
  resolveWorkspaceRevisionMap = {},
  setWorkspaceTitleError = null
}) {
  const revisionLookup = new Map(Object.entries(resolveWorkspaceRevisionMap));

  return {
    activeWorkspaceId,
    pendingWorkspaceInvites,
    accessibleWorkspaces,
    isHomeWorkspace,
    revision,
    lastRevisionWorkspaceId,
    lastStateSource,
    loadCalls: 0,
    saveCalls: [],
    applyCommandCalls: [],
    applyCommandContexts: [],
    setWorkspaceTitleCalls: [],
    setWorkspaceTitleContexts: [],
    createWorkspaceCalls: [],
    generateCardLocalizationCalls: [],
    generateCardLocalizationContexts: [],
    runStagePromptCalls: [],
    runStagePromptContexts: [],
    resolveWorkspaceRevisionCalls: [],
    setActiveWorkspaceCalls: [],
    events: [],
    getActiveWorkspaceId() {
      return this.activeWorkspaceId;
    },
    getPendingWorkspaceInvites() {
      return this.pendingWorkspaceInvites;
    },
    getAccessibleWorkspaces() {
      return this.accessibleWorkspaces;
    },
    getIsHomeWorkspace() {
      return this.isHomeWorkspace === true;
    },
    getRevision() {
      return this.revision;
    },
    getLastRevisionWorkspaceId() {
      return this.lastRevisionWorkspaceId;
    },
    getLastStateSource() {
      return this.lastStateSource;
    },
    setActiveWorkspace(workspaceId) {
      this.activeWorkspaceId = workspaceId ?? null;
      this.setActiveWorkspaceCalls.push(this.activeWorkspaceId);
      this.events.push(`set:${this.activeWorkspaceId}`);
    },
    async loadWorkspace() {
      this.events.push('load');
      this.loadCalls += 1;
      return structuredClone(workspace);
    },
    async resolveWorkspaceRevision(workspaceId) {
      const normalizedWorkspaceId = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
      this.resolveWorkspaceRevisionCalls.push(normalizedWorkspaceId);
      return revisionLookup.get(normalizedWorkspaceId) ?? null;
    },
    async applyCommand(command, options = {}) {
      this.applyCommandCalls.push(structuredClone(command));
      this.applyCommandContexts.push(structuredClone(options));
      return {
        workspace: structuredClone(workspace),
        meta: {
          revision: 1,
          updatedAt: '2026-04-04T10:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        },
        result: {
          clientMutationId: command.clientMutationId,
          type: command.type,
          noOp: false
        }
      };
    },
    async setWorkspaceTitle(request, options = {}) {
      this.setWorkspaceTitleCalls.push(structuredClone(request));
      this.setWorkspaceTitleContexts.push(structuredClone(options));

      if (setWorkspaceTitleError) {
        throw setWorkspaceTitleError;
      }

      const nextWorkspace = structuredClone(workspace);
      const normalizedTitle = typeof request?.title === 'string' ? request.title.trim() : '';

      if (normalizedTitle) {
        nextWorkspace.title = normalizedTitle;
      } else {
        delete nextWorkspace.title;
      }

      return {
        workspace: nextWorkspace,
        activeWorkspace: {
          workspaceId: nextWorkspace.workspaceId,
          workspaceTitle: normalizedTitle || null,
          isHomeWorkspace: false
        },
        meta: {
          revision: 1,
          updatedAt: '2026-04-04T10:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        },
        result: {
          clientMutationId: request.clientMutationId,
          type: 'workspace.title.set',
          noOp: false,
          workspaceId: nextWorkspace.workspaceId,
          workspaceTitle: normalizedTitle || null
        }
      };
    },
    async createWorkspace(request = {}) {
      this.createWorkspaceCalls.push(structuredClone(request));
      return {
        ok: true,
        result: {
          workspaceId: 'workspace_created_1',
          workspaceTitle: typeof request?.title === 'string' && request.title.trim() ? request.title.trim() : 'Workspace 1'
        }
      };
    },
    async generateCardLocalization(request, options = {}) {
      this.generateCardLocalizationCalls.push(structuredClone(request));
      this.generateCardLocalizationContexts.push(structuredClone(options));
      return {
        workspace: structuredClone(workspace),
        meta: {
          revision: 1,
          updatedAt: '2026-04-04T10:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        },
        result: {
          clientMutationId: request.clientMutationId,
          type: 'card.locale.generate',
          noOp: false
        }
      };
    },
    async runStagePrompt(request, options = {}) {
      this.runStagePromptCalls.push(structuredClone(request));
      this.runStagePromptContexts.push(structuredClone(options));
      return {
        workspace: structuredClone(workspace),
        meta: {
          revision: 1,
          updatedAt: '2026-04-04T10:00:00.000Z',
          lastChangedBy: 'sub_123',
          isPristine: false
        },
        result: {
          clientMutationId: request.clientMutationId,
          type: 'card.stage-prompt.run',
          noOp: false
        }
      };
    },
    async saveWorkspace(nextWorkspace) {
      this.saveCalls.push(structuredClone(nextWorkspace));
      return structuredClone(workspace);
    }
  };
}
