import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace.js';
import {
  assertValidWorkspaceCommand,
  assertValidWorkspaceCommandRequest,
  isWorkspaceCommandType,
  validateWorkspaceCommand,
  validateWorkspaceCommandRequest,
  validateWorkspaceCommandResponse
} from '../public/js/domain/workspace_commands.js';

test('isWorkspaceCommandType accepts known command types and rejects unknown ones', () => {
  assert.equal(isWorkspaceCommandType('board.create'), true);
  assert.equal(isWorkspaceCommandType('board.update'), true);
  assert.equal(isWorkspaceCommandType('board.invite.create'), true);
  assert.equal(isWorkspaceCommandType('board.member.remove'), true);
  assert.equal(isWorkspaceCommandType('card.locale.upsert'), true);
  assert.equal(isWorkspaceCommandType('card.locale.request'), true);
  assert.equal(isWorkspaceCommandType('card.locale.request.clear'), true);
  assert.equal(isWorkspaceCommandType('card.move'), true);
  assert.equal(isWorkspaceCommandType('board.archive'), false);
});

test('validateWorkspaceCommand accepts valid command envelopes', () => {
  const commands = [
    {
      clientMutationId: 'm1',
      type: 'board.create',
      payload: { title: 'Planning' }
    },
    {
      clientMutationId: 'm2',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: 'Now',
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
    },
    {
      clientMutationId: 'm3',
      type: 'board.rename',
      payload: { boardId: 'main', title: 'Now' }
    },
    {
      clientMutationId: 'm4',
      type: 'board.delete',
      payload: { boardId: 'main' }
    },
    {
      clientMutationId: 'm5',
      type: 'board.reset',
      payload: { boardId: 'main' }
    },
    {
      clientMutationId: 'm6',
      type: 'board.invite.create',
      payload: {
        boardId: 'main',
        email: 'invitee@example.com',
        role: ' Editor '
      }
    },
    {
      clientMutationId: 'm7',
      type: 'board.invite.revoke',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    {
      clientMutationId: 'm8',
      type: 'board.invite.accept',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    {
      clientMutationId: 'm9',
      type: 'board.invite.decline',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    {
      clientMutationId: 'm10',
      type: 'board.member.role.set',
      payload: {
        boardId: 'main',
        targetActor: {
          type: 'human',
          id: 'viewer_123',
          email: 'viewer@example.com'
        },
        role: 'viewer'
      }
    },
    {
      clientMutationId: 'm11',
      type: 'board.member.remove',
      payload: {
        boardId: 'main',
        targetActor: {
          type: 'human',
          id: 'viewer_123'
        }
      }
    },
    {
      clientMutationId: 'm12',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Ship step 6b.1',
        detailsMarkdown: 'Contract only',
        priority: 'urgent'
      }
    },
    {
      clientMutationId: 'm13',
      type: 'card.update',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        title: 'Ship step 6b.1 safely'
      }
    },
    {
      clientMutationId: 'm14',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'es_cl',
        title: 'Titulo actualizado',
        detailsMarkdown: 'Detalle actualizado'
      }
    },
    {
      clientMutationId: 'm15',
      type: 'card.locale.request',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    {
      clientMutationId: 'm16',
      type: 'card.locale.request.clear',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    {
      clientMutationId: 'm17',
      type: 'card.delete',
      payload: { boardId: 'main', cardId: 'card_1' }
    },
    {
      clientMutationId: 'm18',
      type: 'card.move',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        sourceColumnId: 'backlog',
        targetColumnId: 'doing'
      }
    },
    {
      clientMutationId: 'm19',
      type: 'ui.activeBoard.set',
      payload: { boardId: 'main' }
    },
    {
      clientMutationId: 'm20',
      type: 'ui.columnCollapsed.set',
      payload: {
        boardId: 'main',
        columnId: 'done',
        isCollapsed: true
      }
    }
  ];

  for (const command of commands) {
    assert.equal(validateWorkspaceCommand(command), true);
    assert.doesNotThrow(() => assertValidWorkspaceCommand(command));
  }
});

test('validateWorkspaceCommand rejects unknown command types', () => {
  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'm1',
      type: 'board.archive',
      payload: {}
    }),
    false
  );
});

test('validateWorkspaceCommand rejects invalid collaboration payloads', () => {
  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'c1',
      type: 'board.invite.create',
      payload: {
        boardId: 'main',
        email: 'not-an-email',
        role: 'editor'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'c2',
      type: 'board.invite.create',
      payload: {
        boardId: 'main',
        email: 'invitee@example.com',
        role: 'owner'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'c3',
      type: 'board.invite.accept',
      payload: {
        boardId: 'main'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'c4',
      type: 'board.member.role.set',
      payload: {
        boardId: 'main',
        role: 'admin'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'c5',
      type: 'board.member.remove',
      payload: {
        boardId: 'main',
        targetActor: {
          type: 'human'
        }
      }
    }),
    false
  );
});

test('validateWorkspaceCommand rejects invalid localized card payloads', () => {
  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'l1',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'not a locale',
        title: 'Titulo',
        detailsMarkdown: 'Detalle'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'l2',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'es-CL',
        detailsMarkdown: 'Detalle'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'l3',
      type: 'card.locale.request',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: '???'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'l4',
      type: 'card.locale.request.clear',
      payload: {
        boardId: 'main',
        locale: 'ja'
      }
    }),
    false
  );
});

test('validateWorkspaceCommand rejects missing clientMutationId', () => {
  assert.equal(
    validateWorkspaceCommand({
      type: 'board.create',
      payload: { title: 'Planning' }
    }),
    false
  );

  assert.throws(
    () =>
      assertValidWorkspaceCommand({
        type: 'board.create',
        payload: { title: 'Planning' }
      }),
    /clientMutationId/
  );
});

test('validateWorkspaceCommand rejects invalid payloads', () => {
  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'm1',
      type: 'board.create',
      payload: { title: '   ' }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'm2',
      type: 'card.move',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        sourceColumnId: 'backlog'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'm3',
      type: 'ui.columnCollapsed.set',
      payload: {
        boardId: 'main',
        columnId: 'doing',
        isCollapsed: 'yes'
      }
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommand({
      clientMutationId: 'm4',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: 'Bad schema',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'fr'
        },
        stageDefinitions: [],
        templates: []
      }
    }),
    false
  );
});

test('validateWorkspaceCommandRequest enforces command envelope and expectedRevision', () => {
  const request = {
    command: {
      clientMutationId: 'm1',
      type: 'card.delete',
      payload: {
        boardId: 'main',
        cardId: 'card_1'
      }
    },
    expectedRevision: 4
  };

  assert.equal(validateWorkspaceCommandRequest(request), true);
  assert.doesNotThrow(() => assertValidWorkspaceCommandRequest(request));
  assert.equal(
    validateWorkspaceCommandRequest({
      ...request,
      expectedRevision: -1
    }),
    false
  );
  assert.equal(
    validateWorkspaceCommandRequest({
      expectedRevision: 4
    }),
    false
  );
});

test('validateWorkspaceCommandResponse accepts the planned response envelope', () => {
  const workspace = createEmptyWorkspace();

  assert.equal(
    validateWorkspaceCommandResponse({
      workspace,
      meta: {
        revision: 0,
        updatedAt: '2026-03-31T00:00:00.000Z',
        lastChangedBy: {
          type: 'human',
          id: 'viewer-sub'
        },
        isPristine: true
      },
      result: {
        command: {
          clientMutationId: 'm1',
          type: 'board.create'
        }
      }
    }),
    true
  );
});

test('validateWorkspaceCommandResponse rejects invalid response envelopes', () => {
  assert.equal(
    validateWorkspaceCommandResponse({
      workspace: { nope: true },
      meta: {
        revision: 0
      },
      result: {}
    }),
    false
  );

  assert.equal(
    validateWorkspaceCommandResponse({
      workspace: createEmptyWorkspace(),
      meta: {
        revision: -1
      },
      result: {}
    }),
    false
  );
});
