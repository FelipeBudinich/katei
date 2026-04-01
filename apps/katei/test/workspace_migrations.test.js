import test from 'node:test';
import assert from 'node:assert/strict';
import { getCardContentVariant } from '../public/js/domain/card_localization.js';
import {
  migrateBoardToSchemaV8,
  migrateCardToLocalizedContent,
  migrateWorkspaceSnapshot,
  migrateWorkspaceToV6
} from '../public/js/domain/workspace_migrations.js';
import { WORKSPACE_VERSION } from '../public/js/domain/workspace_read_model.js';
import { createHomeWorkspaceId } from '../src/workspaces/workspace_record.js';

test('migrateWorkspaceToV6 upgrades a legacy v7 workspace to the current shared-workspace schema', () => {
  const workspace = createLegacyWorkspace({
    workspaceId: 'sub_123',
    boards: {
      main: createLegacyBoard({
        cards: {
          card_legacy_1: createLegacyCard({
            id: 'card_legacy_1',
            title: 'Legacy persisted task',
            detailsMarkdown: 'Loaded from disk'
          })
        }
      })
    }
  });

  const migratedWorkspace = migrateWorkspaceToV6(workspace, {
    now: '2026-03-31T10:00:00.000Z',
    workspaceId: createHomeWorkspaceId('sub_123'),
    ownerSub: 'sub_123'
  });
  const migratedBoard = migratedWorkspace.boards.main;
  const migratedCard = migratedBoard.cards.card_legacy_1;

  assert.equal(migratedWorkspace.version, WORKSPACE_VERSION);
  assert.equal(migratedWorkspace.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.deepEqual(migratedWorkspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(migratedWorkspace.access, {
    kind: 'private'
  });
  assert.equal(migratedWorkspace.ui.collapsedColumnsByBoard, undefined);
  assert.deepEqual(migratedBoard.stageOrder, ['backlog', 'doing', 'done', 'archived']);
  assert.equal(migratedBoard.columnOrder, undefined);
  assert.equal(migratedBoard.columns, undefined);
  assert.deepEqual(migratedBoard.collaboration, {
    memberships: [
      {
        actor: {
          type: 'human',
          id: 'sub_123'
        },
        role: 'admin',
        joinedAt: '2026-03-31T09:00:00.000Z'
      }
    ],
    invites: []
  });
  assert.deepEqual(migratedBoard.templates, {
    default: []
  });
  assert.deepEqual(migratedBoard.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
  assert.equal(migratedCard.title, undefined);
  assert.equal(migratedCard.detailsMarkdown, undefined);
  assert.deepEqual(migratedCard.localeRequests, {});
  assert.equal(migratedCard.contentByLocale.en.title, 'Legacy persisted task');
  assert.equal(migratedCard.contentByLocale.en.detailsMarkdown, 'Loaded from disk');
});

test('migrateWorkspaceSnapshot canonicalizes legacy home-workspace ids when record metadata is provided', () => {
  const migratedWorkspace = migrateWorkspaceSnapshot(
    createLegacyWorkspace({
      workspaceId: 'sub_123'
    }),
    {
      workspaceId: createHomeWorkspaceId('sub_123'),
      ownerSub: 'sub_123'
    }
  );

  assert.equal(migratedWorkspace.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.deepEqual(migratedWorkspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(migratedWorkspace.access, {
    kind: 'private'
  });
});

test('migrateWorkspaceSnapshot migrates multiple boards and preserves existing memberships without double-seeding owners', () => {
  const workspace = createLegacyWorkspace({
    workspaceId: 'workspace_shared_1',
    boards: {
      main: createLegacyBoard({
        cards: {
          card_1: createLegacyCard({
            id: 'card_1',
            title: 'Backfilled board'
          })
        }
      }),
      board_two: createLegacyBoard({
        id: 'board_two',
        title: 'Board two',
        cards: {
          card_2: createLegacyCard({
            id: 'card_2',
            title: 'Existing collab card'
          })
        },
        memberships: [
          {
            actor: { type: 'human', id: 'sub_collab' },
            role: 'editor',
            joinedAt: '2026-03-30T12:00:00.000Z'
          }
        ]
      })
    },
    boardOrder: ['main', 'board_two'],
    ui: createLegacyWorkspaceUi(['main', 'board_two'], 'board_two')
  });

  const migratedWorkspace = migrateWorkspaceSnapshot(workspace, {
    ownerSub: 'sub_owner'
  });

  assert.deepEqual(migratedWorkspace.boardOrder, ['main', 'board_two']);
  assert.equal(migratedWorkspace.boards.main.collaboration.memberships.length, 1);
  assert.equal(migratedWorkspace.boards.main.collaboration.memberships[0].actor.id, 'sub_owner');
  assert.deepEqual(migratedWorkspace.boards.board_two.collaboration.memberships, [
    {
      actor: { type: 'human', id: 'sub_collab' },
      role: 'editor',
      joinedAt: '2026-03-30T12:00:00.000Z'
    }
  ]);
});

test('migrateWorkspaceSnapshot seeds owner admin when a board has no memberships after collaboration normalization', () => {
  const workspace = createLegacyWorkspace({
    boards: {
      main: createLegacyBoard({
        collaboration: {
          memberships: [{ actor: { type: 'human' }, role: 'owner' }],
          invites: [{ id: 'invite_1', status: 'pending' }]
        }
      })
    }
  });

  const migratedWorkspace = migrateWorkspaceSnapshot(workspace, {
    ownerSub: 'sub_owner'
  });

  assert.deepEqual(migratedWorkspace.boards.main.collaboration, {
    memberships: [
      {
        actor: { type: 'human', id: 'sub_owner' },
        role: 'admin',
        joinedAt: '2026-03-31T09:00:00.000Z'
      }
    ],
    invites: []
  });
});

test('migrateWorkspaceSnapshot preserves existing locale requests and seeds empty localeRequests when missing', () => {
  const workspace = createLegacyWorkspace({
    boards: {
      main: createLegacyBoard({
        cards: {
          card_missing_requests: createLegacyCard({
            id: 'card_missing_requests',
            title: 'No requests yet'
          }),
          card_legacy_alias_requests: createLegacyCard({
            id: 'card_legacy_alias_requests',
            title: 'Legacy alias request',
            localizationRequests: {
              ja: {
                locale: 'ja',
                requestedBy: { type: 'human', id: 'sub_translator_ja' },
                requestedAt: '2026-03-31T11:30:00.000Z'
              }
            }
          }),
          card_existing_requests: createLegacyCard({
            id: 'card_existing_requests',
            title: 'Translation requested',
            localeRequests: {
              es: {
                locale: 'es',
                status: 'open',
                requestedBy: { type: 'human', id: 'sub_translator' },
                requestedAt: '2026-03-31T11:00:00.000Z'
              }
            }
          })
        }
      })
    }
  });

  const migratedWorkspace = migrateWorkspaceSnapshot(workspace, {
    ownerSub: 'sub_owner'
  });

  assert.deepEqual(migratedWorkspace.boards.main.cards.card_missing_requests.localeRequests, {});
  assert.deepEqual(migratedWorkspace.boards.main.cards.card_legacy_alias_requests.localeRequests, {
    ja: {
      locale: 'ja',
      status: 'open',
      requestedBy: { type: 'human', id: 'sub_translator_ja' },
      requestedAt: '2026-03-31T11:30:00.000Z'
    }
  });
  assert.deepEqual(migratedWorkspace.boards.main.cards.card_existing_requests.localeRequests, {
    es: {
      locale: 'es',
      status: 'open',
      requestedBy: { type: 'human', id: 'sub_translator' },
      requestedAt: '2026-03-31T11:00:00.000Z'
    }
  });
});

test('migrateCardToLocalizedContent keeps existing localized variants authoritative over stale legacy aliases', () => {
  const migratedCard = migrateCardToLocalizedContent(
    {
      id: 'card_1',
      title: 'Stale legacy title',
      detailsMarkdown: 'Stale legacy details',
      priority: 'important',
      createdAt: '2026-03-31T09:00:00.000Z',
      updatedAt: '2026-03-31T10:00:00.000Z',
      contentByLocale: {
        en: {
          title: 'Localized title',
          detailsMarkdown: 'Localized details',
          provenance: {
            actor: { type: 'human', id: 'viewer_123' },
            timestamp: '2026-03-31T10:00:00.000Z',
            includesHumanInput: true
          }
        }
      }
    },
    {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en'],
        requiredLocales: ['en']
      }
    }
  );

  assert.equal(migratedCard.title, undefined);
  assert.equal(migratedCard.detailsMarkdown, undefined);
  assert.deepEqual(migratedCard.localeRequests, {});
  assert.equal(
    getCardContentVariant(migratedCard, 'en', {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en'],
        requiredLocales: ['en']
      }
    })?.title,
    'Localized title'
  );
});

test('migrateBoardToSchemaV8 preserves custom stage ids, templates, and collaboration idempotently', () => {
  const board = createLegacyBoard({
    id: 'board_custom',
    title: 'Custom board',
    stageOrder: ['draft', 'review', 'published'],
    columns: {
      draft: {
        id: 'draft',
        title: 'Draft',
        cardIds: ['card_1'],
        allowedTransitionStageIds: ['review'],
        templateIds: ['starter']
      },
      review: {
        id: 'review',
        title: 'Review',
        cardIds: [],
        allowedTransitionStageIds: ['draft', 'published'],
        templateIds: []
      },
      published: {
        id: 'published',
        title: 'Published',
        cardIds: [],
        allowedTransitionStageIds: ['review'],
        templateIds: []
      }
    },
    templates: [
      {
        id: 'starter',
        title: 'Starter',
        initialStageId: 'draft'
      }
    ],
    cards: {
      card_1: createLegacyCard({
        id: 'card_1',
        title: 'Legacy draft'
      })
    }
  });

  const firstMigration = migrateBoardToSchemaV8(board, {
    workspaceOwner: { type: 'human', id: 'sub_owner' }
  });
  const secondMigration = migrateBoardToSchemaV8(firstMigration, {
    workspaceOwner: { type: 'human', id: 'sub_owner' }
  });

  assert.deepEqual(firstMigration.stageOrder, ['draft', 'review', 'published']);
  assert.deepEqual(firstMigration.stages.review.allowedTransitionStageIds, ['draft', 'published']);
  assert.deepEqual(firstMigration.templates, {
    default: [
      {
        id: 'starter',
        title: 'Starter',
        initialStageId: 'draft'
      }
    ]
  });
  assert.equal(firstMigration.collaboration.memberships.length, 1);
  assert.equal(firstMigration.collaboration.memberships[0].actor.id, 'sub_owner');
  assert.equal(firstMigration.cards.card_1.contentByLocale.en.title, 'Legacy draft');
  assert.deepEqual(secondMigration, firstMigration);
});

test('migrateWorkspaceSnapshot is idempotent across repeated runs', () => {
  const legacyWorkspace = createLegacyWorkspace({
    workspaceId: 'sub_123',
    boards: {
      main: createLegacyBoard({
        cards: {
          card_1: createLegacyCard({
            id: 'card_1',
            title: 'Legacy title',
            detailsMarkdown: 'Legacy details'
          })
        }
      })
    }
  });

  const firstMigration = migrateWorkspaceSnapshot(legacyWorkspace, {
    workspaceId: createHomeWorkspaceId('sub_123'),
    ownerSub: 'sub_123'
  });
  const secondMigration = migrateWorkspaceSnapshot(firstMigration, {
    workspaceId: createHomeWorkspaceId('sub_123'),
    ownerSub: 'sub_123'
  });

  assert.deepEqual(secondMigration, firstMigration);
});

function createLegacyWorkspace({
  version = 5,
  workspaceId = 'workspace_legacy_1',
  boards = {
    main: createLegacyBoard()
  },
  boardOrder = Object.keys(boards),
  ui = createLegacyWorkspaceUi(Object.keys(boards), Object.keys(boards)[0] ?? 'main')
} = {}) {
  return {
    version,
    workspaceId,
    ui: structuredClone(ui),
    boardOrder: [...boardOrder],
    boards: structuredClone(boards)
  };
}

function createLegacyWorkspaceUi(boardIds, activeBoardId) {
  return {
    activeBoardId,
    collapsedColumnsByBoard: Object.fromEntries(
      boardIds.map((boardId) => [
        boardId,
        {
          backlog: false,
          doing: false,
          done: false,
          archived: false
        }
      ])
    )
  };
}

function createLegacyBoard({
  id = 'main',
  title = '過程',
  createdAt = '2026-03-31T09:00:00.000Z',
  updatedAt = createdAt,
  cards = {},
  stageOrder = ['backlog', 'doing', 'done', 'archived'],
  columns = createLegacyColumns(stageOrder, cards),
  templates = undefined,
  languagePolicy = undefined,
  memberships = undefined,
  invites = undefined,
  collaboration = undefined
} = {}) {
  return {
    id,
    title,
    createdAt,
    updatedAt,
    columnOrder: [...stageOrder],
    columns: structuredClone(columns),
    ...(memberships === undefined ? {} : { memberships: structuredClone(memberships) }),
    ...(invites === undefined ? {} : { invites: structuredClone(invites) }),
    ...(collaboration === undefined ? {} : { collaboration: structuredClone(collaboration) }),
    templates,
    languagePolicy,
    cards: structuredClone(cards)
  };
}

function createLegacyColumns(stageOrder, cards) {
  const defaultColumns = {
    backlog: {
      id: 'backlog',
      title: 'Backlog',
      cardIds: Object.keys(cards),
      allowedTransitionStageIds: ['doing', 'done'],
      templateIds: []
    },
    doing: {
      id: 'doing',
      title: 'Doing',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'done'],
      templateIds: []
    },
    done: {
      id: 'done',
      title: 'Done',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'doing', 'archived'],
      templateIds: []
    },
    archived: {
      id: 'archived',
      title: 'Archived',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'doing', 'done'],
      templateIds: []
    }
  };

  return Object.fromEntries(
    stageOrder.map((stageId) => [
      stageId,
      structuredClone(defaultColumns[stageId] ?? {
        id: stageId,
        title: stageId,
        cardIds: [],
        allowedTransitionStageIds: stageOrder.filter((candidateStageId) => candidateStageId !== stageId),
        templateIds: []
      })
    ])
  );
}

function createLegacyCard({
  id = 'card_1',
  title = 'Legacy title',
  detailsMarkdown = '',
  priority = 'important',
  createdAt = '2026-03-31T09:00:00.000Z',
  updatedAt = '2026-03-31T10:00:00.000Z',
  contentByLocale = undefined,
  localeRequests = undefined,
  localizationRequests = undefined
} = {}) {
  return {
    id,
    title,
    detailsMarkdown,
    priority,
    createdAt,
    updatedAt,
    ...(contentByLocale === undefined ? {} : { contentByLocale: structuredClone(contentByLocale) }),
    ...(localeRequests === undefined ? {} : { localeRequests: structuredClone(localeRequests) }),
    ...(localizationRequests === undefined ? {} : { localizationRequests: structuredClone(localizationRequests) })
  };
}
