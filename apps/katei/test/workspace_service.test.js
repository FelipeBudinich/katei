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

function createRepositoryDouble({ workspace }) {
  return {
    loadCalls: 0,
    saveCalls: [],
    applyCommandCalls: [],
    async loadWorkspace() {
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
