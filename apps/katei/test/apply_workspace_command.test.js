import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace, createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import { validateWorkspaceShape } from '../public/js/domain/workspace_validation.js';
import { createMutationContext } from '../src/workspaces/mutation_context.js';
import {
  decryptBoardSecret,
  encryptBoardSecret
} from '../src/security/board_secret_crypto.js';
import {
  applyWorkspaceCommand,
  WorkspaceCommandPermissionError
} from '../src/workspaces/apply_workspace_command.js';
import { createWorkspaceRecord } from '../src/workspaces/workspace_record.js';
import { WorkspaceRevisionConflictError } from '../src/workspaces/workspace_record_repository.js';

function createRecord(workspace = createWorkspaceForActor(), revision = 0) {
  return createWorkspaceRecord({
    viewerSub: 'viewer_123',
    workspace,
    revision,
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    lastChangedBy: null,
    activityEvents: []
  });
}

function createContext(overrides = {}) {
  return createMutationContext({
    actor: {
      type: 'human',
      id: 'viewer_123'
    },
    now: '2026-03-31T10:00:00.000Z',
    createBoardId: () => 'board_srv001',
    createCardId: () => 'card_srv001',
    boardSecretEncryptionKey: 'test-board-secret-encryption-key',
    ...overrides
  });
}

function createActor({ type = 'human', id = 'viewer_123', email = null, name = null } = {}) {
  return {
    type,
    id,
    ...(email ? { email } : {}),
    ...(name ? { name } : {})
  };
}

function createMembership({ type = 'human', id, role, email = null } = {}) {
  return {
    actor: {
      type,
      id,
      ...(email ? { email } : {})
    },
    role
  };
}

function createInvite({
  id = 'invite_1',
  email = 'invitee@example.com',
  role = 'viewer',
  status = 'pending',
  invitedBy = { type: 'human', id: 'viewer_admin' },
  invitedAt = '2026-03-31T09:00:00.000Z',
  respondedAt = undefined,
  expiresAt = undefined
} = {}) {
  return {
    id,
    email,
    role,
    status,
    invitedBy,
    invitedAt,
    ...(respondedAt ? { respondedAt } : {}),
    ...(expiresAt ? { expiresAt } : {})
  };
}

function createWorkspaceForActor(actor = createActor()) {
  return createEmptyWorkspace({
    creator: actor
  });
}

function createWorkspaceWithMainCollaboration({ memberships, invites = [] } = {}) {
  const workspace = createWorkspaceForActor();
  workspace.boards.main.collaboration = {
    memberships: structuredClone(memberships),
    invites: structuredClone(invites)
  };
  return workspace;
}

function addBoardToWorkspace(
  workspace,
  {
    boardId = 'board_secondary',
    title = 'Secondary board',
    creator = createActor({ id: 'viewer_other' })
  } = {}
) {
  const board = createWorkspaceBoard({
    id: boardId,
    title,
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    creator
  });

  workspace.boards[boardId] = board;
  workspace.boardOrder.push(boardId);

  return workspace;
}

function createWorkspaceWithCard({ memberships } = {}) {
  const workspace = createWorkspaceWithMainCollaboration({ memberships });
  workspace.boards.main.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:30:00.000Z',
    updatedAt: '2026-03-31T09:30:00.000Z',
    localeRequests: {},
    contentByLocale: {
      en: {
        title: 'Existing card',
        detailsMarkdown: 'Existing details',
        provenance: {
          actor: {
            type: 'human',
            id: 'viewer_admin'
          },
          timestamp: '2026-03-31T09:30:00.000Z',
          includesHumanInput: true
        }
      }
    }
  };
  workspace.boards.main.stages.backlog.cardIds = ['card_1'];
  return workspace;
}

function seedBoardOpenAiApiKey(board, apiKey, config = createContext()) {
  board.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: apiKey.slice(-4)
  };
  board.aiLocalizationSecrets = {
    openAiApiKeyEncrypted: encryptBoardSecret(apiKey, config)
  };
}

function readBoardStageDefinitions(board) {
  return board.stageOrder.map((stageId) => ({
    id: stageId,
    title: board.stages[stageId].title,
    allowedTransitionStageIds: [...board.stages[stageId].allowedTransitionStageIds],
    actionIds: [...board.stages[stageId].actionIds]
  }));
}

function createLocalizedVariant({
  title,
  detailsMarkdown,
  actor = createActor({ id: 'viewer_admin' }),
  timestamp = '2026-03-31T09:30:00.000Z',
  includesHumanInput = actor.type === 'human'
} = {}) {
  return {
    title,
    detailsMarkdown,
    provenance: {
      actor,
      timestamp,
      includesHumanInput
    }
  };
}

function assertPermissionError(action, pattern = /permission/i) {
  let error = null;

  try {
    action();
  } catch (caughtError) {
    error = caughtError;
  }

  assert.ok(error instanceof WorkspaceCommandPermissionError);
  assert.match(error.message, pattern);
}

test('board.create mints a server-side board id and timestamps from context', () => {
  const { workspace, result, activityEvent } = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm1',
      type: 'board.create',
      payload: {
        title: 'Roadmap'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(workspace.boardOrder.at(-1), 'board_srv001');
  assert.equal(workspace.ui.activeBoardId, 'board_srv001');
  assert.equal(workspace.boards.board_srv001.createdAt, '2026-03-31T10:00:00.000Z');
  assert.equal(workspace.boards.board_srv001.updatedAt, '2026-03-31T10:00:00.000Z');
  assert.deepEqual(workspace.boards.board_srv001.collaboration, {
    memberships: [
      {
        actor: { type: 'human', id: 'viewer_123' },
        role: 'admin',
        joinedAt: '2026-03-31T10:00:00.000Z'
      }
    ],
    invites: []
  });
  assert.equal(result.boardId, 'board_srv001');
  assert.equal(result.noOp, false);
  assert.equal(activityEvent.type, 'workspace.command.applied');
  assert.equal(activityEvent.revision, 1);
});

test('board.update saves valid schema edits through the command engine', () => {
  const workspace = createWorkspaceForActor();

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm1b',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: 'Editorial board',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'ja',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['en']
        },
        stageDefinitions: [
          {
            id: 'backlog',
            title: 'Inbox',
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
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.type, 'board.update');
  assert.equal(nextWorkspace.boards.main.title, 'Editorial board');
  assert.deepEqual(nextWorkspace.boards.main.stageOrder, ['backlog', 'review']);
  assert.equal(nextWorkspace.boards.main.stages.backlog.title, 'Inbox');
  assert.deepEqual(nextWorkspace.boards.main.stages.backlog.templateIds, ['starter']);
  assert.deepEqual(nextWorkspace.boards.main.templates.default, [
    {
      id: 'starter',
      title: 'Starter',
      initialStageId: 'backlog'
    }
  ]);
  assert.deepEqual(nextWorkspace.boards.main.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  });
});

test('board.update preserves an existing encrypted OpenAI key when the submitted key is blank', () => {
  const workspace = createWorkspaceForActor();
  seedBoardOpenAiApiKey(workspace.boards.main, 'sk-existing-1234');

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm1c',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: 'Editorial board',
        aiProvider: 'openai',
        clearOpenAiApiKey: false,
        languagePolicy: workspace.boards.main.languagePolicy,
        stageDefinitions: readBoardStageDefinitions(workspace.boards.main),
        templates: []
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.noOp, false);
  assert.equal(nextWorkspace.boards.main.aiLocalization.hasApiKey, true);
  assert.equal(nextWorkspace.boards.main.aiLocalization.apiKeyLast4, '1234');
  assert.equal(
    decryptBoardSecret(
      nextWorkspace.boards.main.aiLocalizationSecrets.openAiApiKeyEncrypted,
      createContext()
    ),
    'sk-existing-1234'
  );
});

test('board.update clears stale OpenAI key metadata when no encrypted secret exists', () => {
  const workspace = createWorkspaceForActor();
  workspace.boards.main.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  };
  delete workspace.boards.main.aiLocalizationSecrets;

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm1c_stale',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: workspace.boards.main.title,
        aiProvider: 'openai',
        clearOpenAiApiKey: false,
        languagePolicy: workspace.boards.main.languagePolicy,
        stageDefinitions: readBoardStageDefinitions(workspace.boards.main),
        templates: []
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.noOp, false);
  assert.deepEqual(nextWorkspace.boards.main.aiLocalization, {
    provider: 'openai',
    hasApiKey: false,
    apiKeyLast4: null
  });
  assert.equal(nextWorkspace.boards.main.aiLocalizationSecrets, undefined);
});

test('board.update replaces the stored OpenAI key and treats AI-only changes as real updates', () => {
  const workspace = createWorkspaceForActor();

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm1d',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: workspace.boards.main.title,
        aiProvider: 'openai',
        openAiApiKey: 'sk-replaced-9876',
        clearOpenAiApiKey: false,
        languagePolicy: workspace.boards.main.languagePolicy,
        stageDefinitions: readBoardStageDefinitions(workspace.boards.main),
        templates: []
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.noOp, false);
  assert.equal(nextWorkspace.boards.main.updatedAt, '2026-03-31T10:00:00.000Z');
  assert.deepEqual(nextWorkspace.boards.main.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '9876'
  });
  assert.equal(
    decryptBoardSecret(
      nextWorkspace.boards.main.aiLocalizationSecrets.openAiApiKeyEncrypted,
      createContext()
    ),
    'sk-replaced-9876'
  );
});

test('board.update clears the stored OpenAI key when requested', () => {
  const workspace = createWorkspaceForActor();
  seedBoardOpenAiApiKey(workspace.boards.main, 'sk-clear-4321');

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm1e',
      type: 'board.update',
      payload: {
        boardId: 'main',
        title: workspace.boards.main.title,
        aiProvider: 'openai',
        clearOpenAiApiKey: true,
        languagePolicy: workspace.boards.main.languagePolicy,
        stageDefinitions: readBoardStageDefinitions(workspace.boards.main),
        templates: []
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.noOp, false);
  assert.deepEqual(nextWorkspace.boards.main.aiLocalization, {
    provider: 'openai',
    hasApiKey: false,
    apiKeyLast4: null
  });
  assert.equal(nextWorkspace.boards.main.aiLocalizationSecrets, undefined);
});

test('card.create mints a server-side card id and stores the card in backlog', () => {
  const { workspace, result } = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm2',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Ship service',
        detailsMarkdown: 'Server-authoritative',
        priority: 'urgent'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.cardId, 'card_srv001');
  assert.deepEqual(workspace.boards.main.stages.backlog.cardIds, ['card_srv001']);
  assert.equal(workspace.boards.main.cards.card_srv001.createdAt, '2026-03-31T10:00:00.000Z');
  assert.equal(workspace.boards.main.cards.card_srv001.updatedAt, '2026-03-31T10:00:00.000Z');
  assert.deepEqual(workspace.boards.main.cards.card_srv001.localeRequests, {});
  assert.deepEqual(workspace.boards.main.cards.card_srv001.contentByLocale.en, {
    title: 'Ship service',
    detailsMarkdown: 'Server-authoritative',
    provenance: {
      actor: {
        type: 'human',
        id: 'viewer_123'
      },
      timestamp: '2026-03-31T10:00:00.000Z',
      includesHumanInput: true
    }
  });
});

test('card.create writes only the board source locale when the command engine uses a non-default language policy', () => {
  const workspace = createWorkspaceForActor();
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'ja',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['ja']
  };

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'm2b',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: '日本語カード',
        detailsMarkdown: '日本語の本文'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });
  const card = nextWorkspace.boards.main.cards.card_srv001;

  assert.deepEqual(Object.keys(card.contentByLocale), ['ja']);
  assert.equal(card.contentByLocale.ja.title, '日本語カード');
  assert.equal(card.contentByLocale.en, undefined);
});

test('card.update changes updatedAt only and preserves createdAt', () => {
  const createdWorkspace = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm3',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Original title'
      }
    },
    expectedRevision: 0,
    context: createContext()
  }).workspace;

  const { workspace } = applyWorkspaceCommand({
    record: createRecord(createdWorkspace, 1),
    command: {
      clientMutationId: 'm4',
      type: 'card.update',
      payload: {
        boardId: 'main',
        cardId: 'card_srv001',
        title: 'Updated title'
      }
    },
    expectedRevision: 1,
    context: createContext({
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.equal(workspace.boards.main.cards.card_srv001.createdAt, '2026-03-31T10:00:00.000Z');
  assert.equal(workspace.boards.main.cards.card_srv001.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(workspace.boards.main.cards.card_srv001.contentByLocale.en.title, 'Updated title');
  assert.deepEqual(workspace.boards.main.cards.card_srv001.contentByLocale.en.provenance, {
    actor: {
      type: 'human',
      id: 'viewer_123'
    },
    timestamp: '2026-03-31T11:00:00.000Z',
    includesHumanInput: true
  });
});

test('admin and editor can upsert a selected locale without changing other locale variants', () => {
  for (const role of ['admin', 'editor']) {
    const workspace = createWorkspaceWithCard({
      memberships: [createMembership({ id: 'viewer_123', role })]
    });
    workspace.boards.main.languagePolicy = {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['en']
    };
    workspace.boards.main.cards.card_1.localeRequests = {
      ja: {
        locale: 'ja',
        status: 'open',
        requestedBy: { type: 'human', id: 'viewer_admin' },
        requestedAt: '2026-03-31T09:45:00.000Z'
      }
    };

    const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
      record: createRecord(workspace, 0),
      command: {
        clientMutationId: `locale_upsert_${role}`,
        type: 'card.locale.upsert',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          locale: 'ja',
          title: '日本語タイトル',
          detailsMarkdown: '日本語本文'
        }
      },
      expectedRevision: 0,
      context: createContext({
        now: '2026-03-31T11:00:00.000Z'
      })
    });

    assert.equal(result.locale, 'ja');
    assert.equal(nextWorkspace.boards.main.updatedAt, '2026-03-31T11:00:00.000Z');
    assert.equal(nextWorkspace.boards.main.cards.card_1.updatedAt, '2026-03-31T11:00:00.000Z');
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.en, {
      title: 'Existing card',
      detailsMarkdown: 'Existing details',
      provenance: {
        actor: {
          type: 'human',
          id: 'viewer_admin'
        },
        timestamp: '2026-03-31T09:30:00.000Z',
        includesHumanInput: true
      }
    });
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, {
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文',
      provenance: {
        actor: {
          type: 'human',
          id: 'viewer_123'
        },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: true
      }
    });
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.localeRequests, {});
  }
});

test('human actors can overwrite an existing human-authored localized variant', () => {
  const workspace = createWorkspaceWithCard({
    memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
  });
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  workspace.boards.main.cards.card_1.contentByLocale.ja = createLocalizedVariant({
    title: '既存タイトル',
    detailsMarkdown: '既存本文',
    actor: createActor({ id: 'viewer_admin' }),
    timestamp: '2026-03-31T09:45:00.000Z',
    includesHumanInput: true
  });

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'locale_upsert_human_overwrite',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        title: '更新済みタイトル',
        detailsMarkdown: '更新済み本文'
      }
    },
    expectedRevision: 0,
    context: createContext({
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.equal(result.noOp, false);
  assert.equal(result.locale, 'ja');
  assert.equal(nextWorkspace.boards.main.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(nextWorkspace.boards.main.cards.card_1.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, {
    title: '更新済みタイトル',
    detailsMarkdown: '更新済み本文',
    provenance: {
      actor: {
        type: 'human',
        id: 'viewer_123'
      },
      timestamp: '2026-03-31T11:00:00.000Z',
      includesHumanInput: true
    }
  });
});

test('agent and system actors receive stable blocked results when targeting human-authored localized variants', () => {
  for (const actor of [
    createActor({ type: 'agent', id: 'translator_agent' }),
    createActor({ type: 'system', id: 'translation_system' })
  ]) {
    const workspace = createWorkspaceWithCard({
      memberships: [
        createMembership({ id: 'viewer_admin', role: 'admin' }),
        createMembership({ type: actor.type, id: actor.id, role: 'editor' })
      ]
    });
    workspace.boards.main.languagePolicy = {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['en']
    };
    workspace.boards.main.cards.card_1.contentByLocale.ja = createLocalizedVariant({
      title: '人間のタイトル',
      detailsMarkdown: '人間の本文',
      actor: createActor({ id: 'viewer_admin' }),
      timestamp: '2026-03-31T09:45:00.000Z',
      includesHumanInput: true
    });
    const initialBoardUpdatedAt = workspace.boards.main.updatedAt;
    const initialCardUpdatedAt = workspace.boards.main.cards.card_1.updatedAt;

    const { workspace: nextWorkspace, result, activityEvent } = applyWorkspaceCommand({
      record: createRecord(workspace, 0),
      command: {
        clientMutationId: `locale_block_${actor.type}`,
        type: 'card.locale.upsert',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          locale: 'ja',
          title: '自動更新タイトル',
          detailsMarkdown: '自動更新本文'
        }
      },
      expectedRevision: 0,
      context: createContext({
        actor,
        now: '2026-03-31T11:00:00.000Z'
      })
    });

    assert.deepEqual(result, {
      clientMutationId: `locale_block_${actor.type}`,
      type: 'card.locale.upsert',
      noOp: true,
      blocked: true,
      reason: 'human-authored-locale-protected',
      boardId: 'main',
      cardId: 'card_1',
      locale: 'ja'
    });
    assert.equal(activityEvent, null);
    assert.equal(nextWorkspace.boards.main.updatedAt, initialBoardUpdatedAt);
    assert.equal(nextWorkspace.boards.main.cards.card_1.updatedAt, initialCardUpdatedAt);
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, workspace.boards.main.cards.card_1.contentByLocale.ja);
  }
});

test('agent and system actors can create a missing localized variant', () => {
  for (const actor of [
    createActor({ type: 'agent', id: 'translator_agent' }),
    createActor({ type: 'system', id: 'translation_system' })
  ]) {
    const workspace = createWorkspaceWithCard({
      memberships: [
        createMembership({ id: 'viewer_admin', role: 'admin' }),
        createMembership({ type: actor.type, id: actor.id, role: 'editor' })
      ]
    });
    workspace.boards.main.languagePolicy = {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['en']
    };

    const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
      record: createRecord(workspace, 0),
      command: {
        clientMutationId: `locale_create_${actor.type}`,
        type: 'card.locale.upsert',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          locale: 'ja',
          title: '自動生成タイトル',
          detailsMarkdown: '自動生成本文'
        }
      },
      expectedRevision: 0,
      context: createContext({
        actor,
        now: '2026-03-31T11:00:00.000Z'
      })
    });

    assert.equal(result.noOp, false);
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, {
      title: '自動生成タイトル',
      detailsMarkdown: '自動生成本文',
      provenance: {
        actor: {
          type: actor.type,
          id: actor.id
        },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: false
      }
    });
  }
});

test('agent and system actors can update automation-authored localized variants', () => {
  for (const actor of [
    createActor({ type: 'agent', id: 'translator_agent' }),
    createActor({ type: 'system', id: 'translation_system' })
  ]) {
    const workspace = createWorkspaceWithCard({
      memberships: [
        createMembership({ id: 'viewer_admin', role: 'admin' }),
        createMembership({ type: actor.type, id: actor.id, role: 'editor' })
      ]
    });
    workspace.boards.main.languagePolicy = {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['en']
    };
    workspace.boards.main.cards.card_1.contentByLocale.ja = createLocalizedVariant({
      title: '自動タイトル',
      detailsMarkdown: '自動本文',
      actor: createActor({ type: 'agent', id: 'seed_translator' }),
      timestamp: '2026-03-31T09:45:00.000Z',
      includesHumanInput: false
    });

    const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
      record: createRecord(workspace, 0),
      command: {
        clientMutationId: `locale_update_${actor.type}`,
        type: 'card.locale.upsert',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          locale: 'ja',
          title: '更新済み自動タイトル',
          detailsMarkdown: '更新済み自動本文'
        }
      },
      expectedRevision: 0,
      context: createContext({
        actor,
        now: '2026-03-31T11:00:00.000Z'
      })
    });

    assert.equal(result.noOp, false);
    assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, {
      title: '更新済み自動タイトル',
      detailsMarkdown: '更新済み自動本文',
      provenance: {
        actor: {
          type: actor.type,
          id: actor.id
        },
        timestamp: '2026-03-31T11:00:00.000Z',
        includesHumanInput: false
      }
    });
  }
});

test('explicit override allows automation to overwrite a human-authored localized variant', () => {
  const actor = createActor({ type: 'agent', id: 'translator_agent' });
  const workspace = createWorkspaceWithCard({
    memberships: [createMembership({ type: actor.type, id: actor.id, role: 'editor' })]
  });
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  workspace.boards.main.cards.card_1.contentByLocale.ja = createLocalizedVariant({
    title: '人間のタイトル',
    detailsMarkdown: '人間の本文',
    actor: createActor({ id: 'viewer_admin' }),
    timestamp: '2026-03-31T09:45:00.000Z',
    includesHumanInput: true
  });

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'locale_override_agent',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        title: '強制上書きタイトル',
        detailsMarkdown: '強制上書き本文',
        overrideHumanAuthoredContent: true
      }
    },
    expectedRevision: 0,
    context: createContext({
      actor,
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.equal(result.noOp, false);
  assert.deepEqual(nextWorkspace.boards.main.cards.card_1.contentByLocale.ja, {
    title: '強制上書きタイトル',
    detailsMarkdown: '強制上書き本文',
    provenance: {
      actor: {
        type: 'agent',
        id: 'translator_agent'
      },
      timestamp: '2026-03-31T11:00:00.000Z',
      includesHumanInput: false
    }
  });
});

test('viewer cannot upsert, request, or clear localized card content', () => {
  const workspace = createWorkspaceWithCard({
    memberships: [createMembership({ id: 'viewer_123', role: 'viewer' })]
  });
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  workspace.boards.main.cards.card_1.localeRequests = {
    ja: {
      locale: 'ja',
      status: 'open',
      requestedBy: { type: 'human', id: 'viewer_admin' },
      requestedAt: '2026-03-31T09:45:00.000Z'
    }
  };

  for (const command of [
    {
      clientMutationId: 'locale_upsert_viewer',
      type: 'card.locale.upsert',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja',
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文'
      }
    },
    {
      clientMutationId: 'locale_request_viewer',
      type: 'card.locale.request',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    {
      clientMutationId: 'locale_clear_viewer',
      type: 'card.locale.request.clear',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    }
  ]) {
    assertPermissionError(
      () =>
        applyWorkspaceCommand({
          record: createRecord(workspace, 0),
          command,
          expectedRevision: 0,
          context: createContext()
        }),
      /modify this board/i
    );
  }
});

test('card.locale.request creates an open request and duplicate requests become no-ops', () => {
  const workspace = createWorkspaceWithCard({
    memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
  });
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const initialResult = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'locale_request_1',
      type: 'card.locale.request',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    expectedRevision: 0,
    context: createContext({
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.equal(initialResult.workspace.boards.main.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(initialResult.workspace.boards.main.cards.card_1.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.deepEqual(initialResult.workspace.boards.main.cards.card_1.localeRequests, {
    ja: {
      locale: 'ja',
      status: 'open',
      requestedBy: {
        type: 'human',
        id: 'viewer_123'
      },
      requestedAt: '2026-03-31T11:00:00.000Z'
    }
  });

  const duplicateResult = applyWorkspaceCommand({
    record: createRecord(initialResult.workspace, 1),
    command: {
      clientMutationId: 'locale_request_2',
      type: 'card.locale.request',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    expectedRevision: 1,
    context: createContext({
      now: '2026-03-31T12:00:00.000Z'
    })
  });

  assert.equal(duplicateResult.result.noOp, true);
  assert.equal(duplicateResult.activityEvent, null);
  assert.deepEqual(duplicateResult.workspace.boards.main.cards.card_1.localeRequests, {
    ja: {
      locale: 'ja',
      status: 'open',
      requestedBy: {
        type: 'human',
        id: 'viewer_123'
      },
      requestedAt: '2026-03-31T11:00:00.000Z'
    }
  });
});

test('card.locale.request.clear removes the open request and updates timestamps', () => {
  const workspace = createWorkspaceWithCard({
    memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
  });
  workspace.boards.main.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  workspace.boards.main.cards.card_1.localeRequests = {
    ja: {
      locale: 'ja',
      status: 'open',
      requestedBy: { type: 'human', id: 'viewer_admin' },
      requestedAt: '2026-03-31T09:45:00.000Z'
    }
  };

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'locale_clear_1',
      type: 'card.locale.request.clear',
      payload: {
        boardId: 'main',
        cardId: 'card_1',
        locale: 'ja'
      }
    },
    expectedRevision: 0,
    context: createContext({
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.equal(result.locale, 'ja');
  assert.equal(nextWorkspace.boards.main.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(nextWorkspace.boards.main.cards.card_1.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.deepEqual(nextWorkspace.boards.main.cards.card_1.localeRequests, {});
});

test('card.move changes the correct source and target columns', () => {
  const createdWorkspace = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm5',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Move me'
      }
    },
    expectedRevision: 0,
    context: createContext()
  }).workspace;

  const { workspace, result } = applyWorkspaceCommand({
    record: createRecord(createdWorkspace, 1),
    command: {
      clientMutationId: 'm6',
      type: 'card.move',
      payload: {
        boardId: 'main',
        cardId: 'card_srv001',
        sourceColumnId: 'backlog',
        targetColumnId: 'doing'
      }
    },
    expectedRevision: 1,
    context: createContext({
      now: '2026-03-31T11:00:00.000Z'
    })
  });

  assert.deepEqual(workspace.boards.main.stages.backlog.cardIds, []);
  assert.deepEqual(workspace.boards.main.stages.doing.cardIds, ['card_srv001']);
  assert.equal(workspace.boards.main.cards.card_srv001.updatedAt, '2026-03-31T11:00:00.000Z');
  assert.equal(result.sourceColumnId, 'backlog');
  assert.equal(result.targetColumnId, 'doing');
});

test('card.delete removes card references from columns and cards map', () => {
  const createdWorkspace = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm7',
      type: 'card.create',
      payload: {
        boardId: 'main',
        title: 'Delete me'
      }
    },
    expectedRevision: 0,
    context: createContext()
  }).workspace;

  const { workspace } = applyWorkspaceCommand({
    record: createRecord(createdWorkspace, 1),
    command: {
      clientMutationId: 'm8',
      type: 'card.delete',
      payload: {
        boardId: 'main',
        cardId: 'card_srv001'
      }
    },
    expectedRevision: 1,
    context: createContext()
  });

  assert.equal(workspace.boards.main.cards.card_srv001, undefined);
  assert.deepEqual(workspace.boards.main.stages.backlog.cardIds, []);
});

test('no-op command behavior is surfaced without creating an activity event', () => {
  const { workspace, result, activityEvent } = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm9',
      type: 'ui.activeBoard.set',
      payload: {
        boardId: 'main'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(result.noOp, true);
  assert.equal(activityEvent, null);
  assert.equal(workspace.ui.activeBoardId, 'main');
});

test('applyWorkspaceCommand enforces expectedRevision against the loaded record', () => {
  assert.throws(
    () =>
      applyWorkspaceCommand({
        record: createRecord(createWorkspaceForActor(), 2),
        command: {
          clientMutationId: 'm10',
          type: 'board.create',
          payload: {
            title: 'Mismatch'
          }
        },
        expectedRevision: 1,
        context: createContext()
      }),
    WorkspaceRevisionConflictError
  );
});

test('applyWorkspaceCommand returns valid workspace snapshots', () => {
  const { workspace } = applyWorkspaceCommand({
    record: createRecord(),
    command: {
      clientMutationId: 'm11',
      type: 'board.rename',
      payload: {
        boardId: 'main',
        title: 'Renamed board'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(validateWorkspaceShape(workspace), true);
  assert.equal(workspace.boards.main.title, 'Renamed board');
  assert.equal(workspace.ui.collapsedColumnsByBoard, undefined);
});

test('board admin can create an invite', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_123', role: 'admin' })]
  });

  const { workspace: nextWorkspace, result } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'invite_create_1',
      type: 'board.invite.create',
      payload: {
        boardId: 'main',
        email: 'invitee@example.com',
        role: 'Editor'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  const invite = nextWorkspace.boards.main.collaboration.invites[0];

  assert.equal(nextWorkspace.boards.main.collaboration.invites.length, 1);
  assert.match(invite.id, /^invite_[a-f0-9]{12}$/);
  assert.equal(invite.email, 'invitee@example.com');
  assert.equal(invite.role, 'editor');
  assert.equal(invite.status, 'pending');
  assert.equal(invite.invitedAt, '2026-03-31T10:00:00.000Z');
  assert.deepEqual(invite.invitedBy, {
    type: 'human',
    id: 'viewer_123'
  });
  assert.equal(result.inviteId, invite.id);
});

test('board invite creation is rejected for editor and viewer members', () => {
  for (const role of ['editor', 'viewer']) {
    const workspace = createWorkspaceWithMainCollaboration({
      memberships: [createMembership({ id: 'viewer_123', role })]
    });

    assertPermissionError(
      () =>
        applyWorkspaceCommand({
          record: createRecord(workspace, 0),
          command: {
            clientMutationId: `invite_forbidden_${role}`,
            type: 'board.invite.create',
            payload: {
              boardId: 'main',
              email: 'invitee@example.com',
              role: 'viewer'
            }
          },
          expectedRevision: 0,
          context: createContext()
        }),
      /administer this board/i
    );
  }
});

test('matching-email user can accept a pending invite', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
    invites: [createInvite({ email: 'invitee@example.com', role: 'editor' })]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'invite_accept_1',
      type: 'board.invite.accept',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    expectedRevision: 0,
    context: createContext({
      actor: createActor({
        id: 'viewer_invited',
        email: 'invitee@example.com',
        name: 'Invited Viewer'
      })
    })
  });

  assert.equal(nextWorkspace.boards.main.collaboration.invites[0].status, 'accepted');
  assert.equal(nextWorkspace.boards.main.collaboration.invites[0].respondedAt, '2026-03-31T10:00:00.000Z');
  assert.deepEqual(nextWorkspace.boards.main.collaboration.memberships.at(-1), {
    actor: {
      type: 'human',
      id: 'viewer_invited',
      email: 'invitee@example.com',
      displayName: 'Invited Viewer'
    },
    role: 'editor',
    joinedAt: '2026-03-31T10:00:00.000Z',
    invitedBy: {
      type: 'human',
      id: 'viewer_admin'
    }
  });
});

test('accepting a pending invite adds a membership when one is missing', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
    invites: [createInvite({ email: 'invitee@example.com', role: 'viewer' })]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'invite_accept_2',
      type: 'board.invite.accept',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    expectedRevision: 0,
    context: createContext({
      actor: createActor({
        id: 'viewer_invited',
        email: 'invitee@example.com'
      })
    })
  });

  assert.equal(nextWorkspace.boards.main.collaboration.memberships.length, 2);
  assert.deepEqual(nextWorkspace.boards.main.collaboration.memberships[1].actor, {
    type: 'human',
    id: 'viewer_invited',
    email: 'invitee@example.com'
  });
});

test('non-matching-email user cannot accept an invite', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
    invites: [createInvite({ email: 'invitee@example.com', role: 'viewer' })]
  });

  assertPermissionError(
    () =>
      applyWorkspaceCommand({
        record: createRecord(workspace, 0),
        command: {
          clientMutationId: 'invite_accept_forbidden',
          type: 'board.invite.accept',
          payload: {
            boardId: 'main',
            inviteId: 'invite_1'
          }
        },
        expectedRevision: 0,
        context: createContext({
          actor: createActor({
            id: 'viewer_invited',
            email: 'other@example.com'
          })
        })
      }),
    /respond to this invite/i
  );
});

test('revoked and expired invites cannot be accepted', () => {
  const scenarios = [
    {
      invite: createInvite({
        email: 'invitee@example.com',
        status: 'revoked',
        respondedAt: '2026-03-31T09:30:00.000Z'
      }),
      message: /revoked/i
    },
    {
      invite: createInvite({
        email: 'invitee@example.com',
        status: 'pending',
        expiresAt: '2026-03-31T09:59:59.000Z'
      }),
      message: /expired/i
    }
  ];

  for (const scenario of scenarios) {
    const workspace = createWorkspaceWithMainCollaboration({
      memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
      invites: [scenario.invite]
    });

    assert.throws(
      () =>
        applyWorkspaceCommand({
          record: createRecord(workspace, 0),
          command: {
            clientMutationId: `invite_accept_rejected_${scenario.invite.status}`,
            type: 'board.invite.accept',
            payload: {
              boardId: 'main',
              inviteId: 'invite_1'
            }
          },
          expectedRevision: 0,
          context: createContext({
            actor: createActor({
              id: 'viewer_invited',
              email: 'invitee@example.com'
            })
          })
        }),
      scenario.message
    );
  }
});

test('revoking an invite marks it revoked and does not add a membership', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
    invites: [createInvite({ email: 'invitee@example.com', role: 'viewer' })]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'invite_revoke_1',
      type: 'board.invite.revoke',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    expectedRevision: 0,
    context: createContext({
      actor: createActor({ id: 'viewer_admin' })
    })
  });

  assert.equal(nextWorkspace.boards.main.collaboration.invites[0].status, 'revoked');
  assert.equal(nextWorkspace.boards.main.collaboration.invites[0].respondedAt, '2026-03-31T10:00:00.000Z');
  assert.equal(nextWorkspace.boards.main.collaboration.memberships.length, 1);
});

test('matching-email user can decline a pending invite', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_admin', role: 'admin' })],
    invites: [createInvite({ email: 'invitee@example.com', role: 'viewer' })]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'invite_decline_1',
      type: 'board.invite.decline',
      payload: {
        boardId: 'main',
        inviteId: 'invite_1'
      }
    },
    expectedRevision: 0,
    context: createContext({
      actor: createActor({
        id: 'viewer_invited',
        email: 'invitee@example.com'
      })
    })
  });

  assert.equal(nextWorkspace.boards.main.collaboration.invites[0].status, 'declined');
  assert.equal(nextWorkspace.boards.main.collaboration.memberships.length, 1);
});

test('board admin can change a member role', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [
      createMembership({ id: 'viewer_123', role: 'admin' }),
      createMembership({ id: 'viewer_member', role: 'viewer' })
    ]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'member_role_1',
      type: 'board.member.role.set',
      payload: {
        boardId: 'main',
        targetActor: {
          type: 'human',
          id: 'viewer_member'
        },
        role: 'editor'
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(nextWorkspace.boards.main.collaboration.memberships[1].role, 'editor');
});

test('board admin can remove a non-admin member', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [
      createMembership({ id: 'viewer_123', role: 'admin' }),
      createMembership({ id: 'viewer_member', role: 'viewer' })
    ]
  });

  const { workspace: nextWorkspace } = applyWorkspaceCommand({
    record: createRecord(workspace, 0),
    command: {
      clientMutationId: 'member_remove_1',
      type: 'board.member.remove',
      payload: {
        boardId: 'main',
        targetActor: {
          type: 'human',
          id: 'viewer_member'
        }
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.deepEqual(
    nextWorkspace.boards.main.collaboration.memberships.map((membership) => membership.actor.id),
    ['viewer_123']
  );
});

test('last admin demotion is rejected', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_123', role: 'admin' })]
  });

  assert.throws(
    () =>
      applyWorkspaceCommand({
        record: createRecord(workspace, 0),
        command: {
          clientMutationId: 'member_role_last_admin',
          type: 'board.member.role.set',
          payload: {
            boardId: 'main',
            targetActor: {
              type: 'human',
              id: 'viewer_123'
            },
            role: 'viewer'
          }
        },
        expectedRevision: 0,
        context: createContext()
      }),
    /Cannot demote the last board admin/
  );
});

test('last admin removal is rejected', () => {
  const workspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_123', role: 'admin' })]
  });

  assert.throws(
    () =>
      applyWorkspaceCommand({
        record: createRecord(workspace, 0),
        command: {
          clientMutationId: 'member_remove_last_admin',
          type: 'board.member.remove',
          payload: {
            boardId: 'main',
            targetActor: {
              type: 'human',
              id: 'viewer_123'
            }
          }
        },
        expectedRevision: 0,
        context: createContext()
      }),
    /Cannot remove the last board admin/
  );
});

test('card create, update, move, and delete require edit permission', () => {
  const commands = [
    {
      workspace: createWorkspaceWithMainCollaboration({
        memberships: [createMembership({ id: 'viewer_123', role: 'viewer' })]
      }),
      command: {
        clientMutationId: 'card_permission_create',
        type: 'card.create',
        payload: {
          boardId: 'main',
          title: 'Blocked card'
        }
      }
    },
    {
      workspace: createWorkspaceWithCard({
        memberships: [createMembership({ id: 'viewer_123', role: 'viewer' })]
      }),
      command: {
        clientMutationId: 'card_permission_update',
        type: 'card.update',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          title: 'Blocked update'
        }
      }
    },
    {
      workspace: createWorkspaceWithCard({
        memberships: [createMembership({ id: 'viewer_123', role: 'viewer' })]
      }),
      command: {
        clientMutationId: 'card_permission_move',
        type: 'card.move',
        payload: {
          boardId: 'main',
          cardId: 'card_1',
          sourceColumnId: 'backlog',
          targetColumnId: 'doing'
        }
      }
    },
    {
      workspace: createWorkspaceWithCard({
        memberships: [createMembership({ id: 'viewer_123', role: 'viewer' })]
      }),
      command: {
        clientMutationId: 'card_permission_delete',
        type: 'card.delete',
        payload: {
          boardId: 'main',
          cardId: 'card_1'
        }
      }
    }
  ];

  for (const { workspace, command } of commands) {
    assertPermissionError(
      () =>
        applyWorkspaceCommand({
          record: createRecord(workspace, 0),
          command,
          expectedRevision: 0,
          context: createContext()
        }),
      /modify this board/i
    );
  }
});

test('board update, delete, and reset require admin permission', () => {
  const updateWorkspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
  });
  const resetWorkspace = createWorkspaceWithMainCollaboration({
    memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
  });
  const deleteWorkspace = addBoardToWorkspace(
    createWorkspaceWithMainCollaboration({
      memberships: [createMembership({ id: 'viewer_123', role: 'editor' })]
    })
  );

  const commands = [
    {
      workspace: updateWorkspace,
      command: {
        clientMutationId: 'board_permission_update',
        type: 'board.update',
        payload: {
          boardId: 'main',
          title: 'Blocked board update',
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
      }
    },
    {
      workspace: deleteWorkspace,
      command: {
        clientMutationId: 'board_permission_delete',
        type: 'board.delete',
        payload: {
          boardId: 'main'
        }
      }
    },
    {
      workspace: resetWorkspace,
      command: {
        clientMutationId: 'board_permission_reset',
        type: 'board.reset',
        payload: {
          boardId: 'main'
        }
      }
    }
  ];

  for (const { workspace, command } of commands) {
    assertPermissionError(
      () =>
        applyWorkspaceCommand({
          record: createRecord(workspace, 0),
          command,
          expectedRevision: 0,
          context: createContext()
        }),
      /administer this board/i
    );
  }
});

test('active board changes require read permission', () => {
  const workspace = addBoardToWorkspace(
    createWorkspaceWithMainCollaboration({
      memberships: [createMembership({ id: 'viewer_123', role: 'admin' })]
    }),
    {
      boardId: 'board_private',
      title: 'Private board',
      creator: createActor({ id: 'viewer_other' })
    }
  );

  assertPermissionError(
    () =>
      applyWorkspaceCommand({
        record: createRecord(workspace, 0),
        command: {
          clientMutationId: 'ui_permission_active_board',
          type: 'ui.activeBoard.set',
          payload: {
            boardId: 'board_private'
          }
        },
        expectedRevision: 0,
        context: createContext()
      }),
    /access this board/i
  );
});
