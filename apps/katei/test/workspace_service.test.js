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

test('WorkspaceService setColumnCollapsed calls repository.applyCommand and returns workspace', async () => {
  await assertServiceCommand({
    action: (service) => service.setColumnCollapsed('main', 'doing', true),
    expectedType: 'ui.columnCollapsed.set',
    expectedPayload: {
      boardId: 'main',
      columnId: 'doing',
      isCollapsed: true
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
        title: 'Ship service rewrite',
        detailsMarkdown: 'Server is the source of truth',
        priority: 'urgent'
      }),
    expectedType: 'card.create',
    expectedPayload: {
      boardId: 'main',
      title: 'Ship service rewrite',
      detailsMarkdown: 'Server is the source of truth',
      priority: 'urgent'
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

async function assertServiceCommand({ action, expectedType, expectedPayload }) {
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
}

function createRepositoryDouble({ workspace, activeWorkspaceId = null }) {
  return {
    activeWorkspaceId,
    loadCalls: 0,
    saveCalls: [],
    applyCommandCalls: [],
    setActiveWorkspaceCalls: [],
    events: [],
    getActiveWorkspaceId() {
      return this.activeWorkspaceId;
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
    async applyCommand(command) {
      this.applyCommandCalls.push(structuredClone(command));
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
    async saveWorkspace(nextWorkspace) {
      this.saveCalls.push(structuredClone(nextWorkspace));
      return structuredClone(workspace);
    }
  };
}
