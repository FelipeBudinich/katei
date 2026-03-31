import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import {
  migrateBoardToSchemaV7,
  migrateCardToLocalizedContent,
  migrateWorkspaceSnapshot,
  migrateWorkspaceToV5
} from '../public/js/domain/workspace_migrations.js';

test('migrateWorkspaceToV5 upgrades an empty legacy workspace to the v5 schema', () => {
  const workspace = createLegacyWorkspace();
  const migratedWorkspace = migrateWorkspaceToV5(workspace, {
    now: '2026-03-31T10:00:00.000Z'
  });
  const migratedBoard = migratedWorkspace.boards.main;

  assert.equal(migratedWorkspace.version, 5);
  assert.deepEqual(migratedBoard.stageOrder, ['backlog', 'doing', 'done', 'archived']);
  assert.equal(migratedBoard.columnOrder, undefined);
  assert.equal(migratedBoard.columns, undefined);
  assert.deepEqual(migratedBoard.templates, {
    default: []
  });
  assert.deepEqual(migratedBoard.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
});

test('migrateWorkspaceToV5 migrates multiple boards and preserves existing localized cards', () => {
  const workspace = createLegacyWorkspace({
    boards: {
      main: createLegacyBoard({
        cards: {
          card_1: {
            id: 'card_1',
            title: 'English title',
            detailsMarkdown: 'English details',
            priority: 'important',
            createdAt: '2026-03-30T09:00:00.000Z',
            updatedAt: '2026-03-30T10:00:00.000Z'
          }
        }
      }),
      board_two: createLegacyBoard({
        id: 'board_two',
        title: 'Board two',
        cards: {
          card_2: {
            id: 'card_2',
            priority: 'urgent',
            createdAt: '2026-03-30T09:00:00.000Z',
            updatedAt: '2026-03-30T11:00:00.000Z',
            contentByLocale: {
              en: {
                title: 'Already localized',
                detailsMarkdown: 'Existing localized content',
                provenance: {
                  actor: { type: 'agent', id: 'translator_1' },
                  timestamp: '2026-03-30T11:00:00.000Z',
                  includesHumanInput: false
                }
              }
            }
          }
        }
      })
    },
    boardOrder: ['main', 'board_two'],
    ui: {
      activeBoardId: 'board_two',
      collapsedColumnsByBoard: {
        main: {
          backlog: false,
          doing: false,
          done: false,
          archived: false
        },
        board_two: {
          backlog: false,
          doing: true,
          done: false,
          archived: false
        }
      }
    }
  });

  const migratedWorkspace = migrateWorkspaceToV5(workspace, {
    now: '2026-03-31T12:00:00.000Z'
  });

  assert.deepEqual(migratedWorkspace.boardOrder, ['main', 'board_two']);
  assert.equal(migratedWorkspace.boards.main.cards.card_1.contentByLocale.en.title, 'English title');
  assert.equal(migratedWorkspace.boards.board_two.cards.card_2.contentByLocale.en.title, 'Already localized');
  assert.deepEqual(migratedWorkspace.boards.main.templates, {
    default: []
  });
  assert.deepEqual(migratedWorkspace.boards.board_two.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
});

test('migrateCardToLocalizedContent moves legacy card fields into contentByLocale with system provenance', () => {
  const migratedCard = migrateCardToLocalizedContent(
    {
      id: 'card_1',
      title: 'Legacy title',
      detailsMarkdown: 'Legacy details',
      priority: 'important',
      createdAt: '2026-03-31T09:00:00.000Z',
      updatedAt: '2026-03-31T10:00:00.000Z'
    },
    {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en',
        supportedLocales: ['en'],
        requiredLocales: ['en']
      }
    },
    {
      now: '2026-03-31T12:00:00.000Z'
    }
  );

  assert.equal(migratedCard.title, undefined);
  assert.equal(migratedCard.detailsMarkdown, undefined);
  assert.deepEqual(migratedCard.contentByLocale.en, {
    title: 'Legacy title',
    detailsMarkdown: 'Legacy details',
    provenance: {
      actor: { type: 'system', id: 'legacy-migration' },
      timestamp: '2026-03-31T10:00:00.000Z',
      includesHumanInput: true
    }
  });
});

test('migrateWorkspaceSnapshot is idempotent across repeated runs', () => {
  const legacyWorkspace = createLegacyWorkspace({
    boards: {
      main: createLegacyBoard({
        cards: {
          card_1: {
            id: 'card_1',
            title: 'Legacy title',
            detailsMarkdown: 'Legacy details',
            priority: 'important',
            createdAt: '2026-03-31T09:00:00.000Z',
            updatedAt: '2026-03-31T10:00:00.000Z'
          }
        }
      })
    }
  });

  const firstMigration = migrateWorkspaceSnapshot(legacyWorkspace, {
    now: '2026-03-31T12:00:00.000Z'
  });
  const secondMigration = migrateWorkspaceSnapshot(firstMigration, {
    now: '2026-03-31T12:00:00.000Z'
  });

  assert.deepEqual(secondMigration, firstMigration);
});

test('migrateBoardToSchemaV7 seeds default templates and language policy on migrated boards', () => {
  const migratedBoard = migrateBoardToSchemaV7(
    createLegacyBoard({
      templates: undefined,
      languagePolicy: undefined
    }),
    {
      now: '2026-03-31T12:00:00.000Z'
    }
  );

  assert.deepEqual(migratedBoard.templates, {
    default: []
  });
  assert.deepEqual(migratedBoard.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
});

function createLegacyWorkspace(overrides = {}) {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;
  const baseWorkspace = {
    version: 4,
    workspaceId: workspace.workspaceId,
    ui: structuredClone(workspace.ui),
    boardOrder: [...workspace.boardOrder],
    boards: {
      main: createLegacyBoard({
        id: board.id,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt
      })
    }
  };

  return {
    ...baseWorkspace,
    ...structuredClone(overrides),
    boards: structuredClone(overrides.boards ?? baseWorkspace.boards)
  };
}

function createLegacyBoard(overrides = {}) {
  return {
    id: overrides.id ?? 'main',
    title: overrides.title ?? '過程',
    createdAt: overrides.createdAt ?? '2026-03-31T09:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-03-31T09:00:00.000Z',
    columnOrder: ['backlog', 'doing', 'done', 'archived'],
    columns: {
      backlog: {
        id: 'backlog',
        title: 'Backlog',
        cardIds: Object.keys(overrides.cards ?? {}),
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
    },
    templates: overrides.templates,
    languagePolicy: overrides.languagePolicy,
    cards: structuredClone(overrides.cards ?? {})
  };
}
