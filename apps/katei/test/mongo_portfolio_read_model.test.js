import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace
} from '../public/js/domain/workspace.js';
import {
  createCardContentProvenance,
  createCardContentReview
} from '../public/js/domain/card_localization.js';
import { MongoPortfolioReadModel } from '../src/workspaces/mongo_portfolio_read_model.js';
import {
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  toWorkspaceRecordDocument
} from '../src/workspaces/workspace_record.js';

test('loadPortfolioSummary returns deterministic summary rollups with localization backlog metrics', async () => {
  const ownerRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_alpha_owner',
    viewerSub: 'sub_owner_alpha',
    recordCreatedAt: '2026-04-01T09:00:00.000Z',
    recordUpdatedAt: '2026-04-01T10:00:00.000Z',
    boards: [
      {
        boardId: 'main',
        title: 'Owner roadmap',
        createdAt: '2026-04-01T09:05:00.000Z',
        updatedAt: '2026-04-01T09:55:00.000Z',
        cards: [
          {
            title: 'Owner-only card',
            detailsMarkdown: 'Private board summary'
          }
        ]
      }
    ]
  });
  const sharedRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_zeta_shared',
    viewerSub: 'sub_owner_zeta',
    recordCreatedAt: '2026-04-02T08:00:00.000Z',
    recordUpdatedAt: '2026-04-02T12:30:00.000Z',
    boards: [
      {
        boardId: 'secondary',
        title: 'Client localization',
        createdAt: '2026-04-02T08:05:00.000Z',
        updatedAt: '2026-04-02T12:00:00.000Z',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'ja',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['ja']
        },
        memberships: [
          {
            actor: { type: 'human', id: 'sub_member_shared', email: 'member@example.com' },
            role: 'editor',
            joinedAt: '2026-04-02T08:10:00.000Z'
          }
        ],
        cards: [
          {
            title: 'Translate hero copy',
            detailsMarkdown: 'Japanese localization',
            createdAt: '2026-04-02T08:06:00.000Z',
            updatedAt: '2026-04-02T09:10:00.000Z',
            localeRequests: {
              ja: createOpenLocaleRequest({
                locale: 'ja',
                requestedBy: { type: 'human', id: 'sub_member_shared' },
                requestedAt: '2026-04-02T09:15:00.000Z'
              })
            }
          },
          {
            title: 'Check glossaries',
            detailsMarkdown: 'Shared board card',
            createdAt: '2026-04-02T08:07:00.000Z',
            updatedAt: '2026-04-02T09:20:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '用語集を確認',
                detailsMarkdown: 'AI proposal',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-02T09:20:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai'
                }
              })
            ]
          },
          {
            title: 'Await approval',
            detailsMarkdown: 'Pending human verification',
            createdAt: '2026-04-02T08:08:00.000Z',
            updatedAt: '2026-04-02T09:30:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '確認待ち',
                detailsMarkdown: 'Needs human verification',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-02T09:24:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai',
                  verificationRequestedBy: { type: 'human', id: 'sub_member_shared' },
                  verificationRequestedAt: '2026-04-02T09:25:00.000Z'
                }
              })
            ]
          },
          {
            title: 'Legacy open request',
            detailsMarkdown: 'Requested locale remains open',
            createdAt: '2026-04-02T08:09:00.000Z',
            updatedAt: '2026-04-02T09:40:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '既存翻訳',
                detailsMarkdown: 'Already translated',
                actor: { type: 'human', id: 'sub_member_shared' },
                timestamp: '2026-04-02T09:00:00.000Z',
                includesHumanInput: true,
                review: {
                  origin: 'human'
                }
              })
            ],
            localeRequests: {
              ja: createOpenLocaleRequest({
                locale: 'ja',
                requestedBy: { type: 'human', id: 'sub_member_shared' },
                requestedAt: '2026-04-02T09:05:00.000Z'
              })
            }
          }
        ]
      },
      {
        boardId: 'main',
        title: 'Shared HQ',
        createdAt: '2026-04-02T08:01:00.000Z',
        updatedAt: '2026-04-02T11:45:00.000Z',
        cards: [
          {
            title: 'Executive summary',
            detailsMarkdown: 'One board card'
          }
        ]
      },
      {
        boardId: 'overflow',
        title: 'Overflow board',
        createdAt: '2026-04-02T08:15:00.000Z',
        updatedAt: '2026-04-02T12:20:00.000Z'
      }
    ],
    boardOrder: ['secondary', 'main', 'overflow']
  });
  const collection = createCollectionDouble([
    toWorkspaceRecordDocument(sharedRecord),
    toWorkspaceRecordDocument(ownerRecord)
  ]);
  const readModel = new MongoPortfolioReadModel({ collection });

  const summary = await readModel.loadPortfolioSummary();

  assert.deepEqual(summary.totals, {
    workspaces: 2,
    boards: 4,
    cards: 6,
    cardsMissingRequiredLocales: 1,
    openLocaleRequestCount: 2,
    awaitingHumanVerificationCount: 1,
    agentProposalCount: 1
  });
  assert.deepEqual(summary.workspaces, [
    {
      workspaceId: 'workspace_alpha_owner',
      workspaceTitle: null,
      boardCount: 1,
      timestamps: {
        createdAt: '2026-04-01T09:00:00.000Z',
        updatedAt: '2026-04-01T10:00:00.000Z'
      }
    },
    {
      workspaceId: 'workspace_zeta_shared',
      workspaceTitle: null,
      boardCount: 3,
      timestamps: {
        createdAt: '2026-04-02T08:00:00.000Z',
        updatedAt: '2026-04-02T12:30:00.000Z'
      }
    }
  ]);
  assert.deepEqual(
    summary.boardDirectory.map((entry) => [entry.workspaceId, entry.boardId]),
    [
      ['workspace_alpha_owner', 'main'],
      ['workspace_zeta_shared', 'secondary'],
      ['workspace_zeta_shared', 'main'],
      ['workspace_zeta_shared', 'overflow']
    ]
  );
  assert.deepEqual(summary.boardDirectory[0], {
    workspaceId: 'workspace_alpha_owner',
    workspaceTitle: null,
    boardId: 'main',
    boardTitle: 'Owner roadmap',
    localePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      requiredLocales: ['en']
    },
    cardCounts: {
      total: 1,
      byStage: null
    },
    localizationSummary: {
      cardsMissingRequiredLocales: 0,
      openLocaleRequestCount: 0,
      awaitingHumanVerificationCount: 0,
      agentProposalCount: 0
    },
    aging: {
      oldestMissingRequiredLocaleUpdatedAt: null,
      oldestOpenLocaleRequestAt: null,
      oldestAwaitingHumanVerificationAt: null,
      oldestAgentProposalAt: null
    },
    timestamps: {
      workspaceCreatedAt: '2026-04-01T09:00:00.000Z',
      workspaceUpdatedAt: '2026-04-01T10:00:00.000Z',
      boardCreatedAt: '2026-04-01T09:05:00.000Z',
      boardUpdatedAt: '2026-04-01T09:55:00.000Z'
    }
  });
  assert.deepEqual(summary.boardDirectory[1], {
    workspaceId: 'workspace_zeta_shared',
    workspaceTitle: null,
    boardId: 'secondary',
    boardTitle: 'Client localization',
    localePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'ja',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['ja']
    },
    cardCounts: {
      total: 4,
      byStage: null
    },
    localizationSummary: {
      cardsMissingRequiredLocales: 1,
      openLocaleRequestCount: 2,
      awaitingHumanVerificationCount: 1,
      agentProposalCount: 1
    },
    aging: {
      oldestMissingRequiredLocaleUpdatedAt: '2026-04-02T09:10:00.000Z',
      oldestOpenLocaleRequestAt: '2026-04-02T09:05:00.000Z',
      oldestAwaitingHumanVerificationAt: '2026-04-02T09:25:00.000Z',
      oldestAgentProposalAt: '2026-04-02T09:20:00.000Z'
    },
    timestamps: {
      workspaceCreatedAt: '2026-04-02T08:00:00.000Z',
      workspaceUpdatedAt: '2026-04-02T12:30:00.000Z',
      boardCreatedAt: '2026-04-02T08:05:00.000Z',
      boardUpdatedAt: '2026-04-02T12:00:00.000Z'
    }
  });
  assert.equal(Object.hasOwn(summary.boardDirectory[1], 'cards'), false);
  assert.equal(Object.hasOwn(summary.boardDirectory[1], 'collaboration'), false);
  assert.equal(Object.hasOwn(summary.boardDirectory[1], 'templates'), false);
  assert.equal(Object.hasOwn(summary.boardDirectory[1], 'aiLocalization'), false);
  assert.deepEqual(
    summary.awaitingHumanVerificationItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      boardTitle: item.boardTitle,
      cardTitle: item.cardTitle,
      localizedTitle: item.localizedTitle,
      locale: item.locale,
      verificationRequestedAt: item.verificationRequestedAt
    })),
    [
      {
        workspaceId: 'workspace_zeta_shared',
        boardId: 'secondary',
        boardTitle: 'Client localization',
        cardTitle: 'Await approval',
        localizedTitle: '確認待ち',
        locale: 'ja',
        verificationRequestedAt: '2026-04-02T09:25:00.000Z'
      }
    ]
  );
  assert.deepEqual(
    summary.agentProposalItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      boardTitle: item.boardTitle,
      cardTitle: item.cardTitle,
      localizedTitle: item.localizedTitle,
      locale: item.locale,
      proposedAt: item.proposedAt
    })),
    [
      {
        workspaceId: 'workspace_zeta_shared',
        boardId: 'secondary',
        boardTitle: 'Client localization',
        cardTitle: 'Check glossaries',
        localizedTitle: '用語集を確認',
        locale: 'ja',
        proposedAt: '2026-04-02T09:20:00.000Z'
      }
    ]
  );
  assert.deepEqual(
    summary.missingRequiredLocalizationItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      boardTitle: item.boardTitle,
      cardTitle: item.cardTitle,
      missingLocales: item.missingLocales,
      cardUpdatedAt: item.cardUpdatedAt
    })),
    [
      {
        workspaceId: 'workspace_zeta_shared',
        boardId: 'secondary',
        boardTitle: 'Client localization',
        cardTitle: 'Translate hero copy',
        missingLocales: ['ja'],
        cardUpdatedAt: '2026-04-02T09:10:00.000Z'
      }
    ]
  );
});

test('loadPortfolioSummary handles an empty database cleanly', async () => {
  const readModel = new MongoPortfolioReadModel({
    collection: createCollectionDouble([])
  });

  const summary = await readModel.loadPortfolioSummary();

  assert.deepEqual(summary, {
    totals: {
      workspaces: 0,
      boards: 0,
      cards: 0,
      cardsMissingRequiredLocales: 0,
      openLocaleRequestCount: 0,
      awaitingHumanVerificationCount: 0,
      agentProposalCount: 0
    },
    workspaces: [],
    boardDirectory: [],
    awaitingHumanVerificationItems: [],
    agentProposalItems: [],
    missingRequiredLocalizationItems: []
  });
});

test('loadPortfolioSummary projects workspace titles when present and leaves untitled workspaces nullable', async () => {
  const titledRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_titled',
    workspaceTitle: 'Studio workspace',
    viewerSub: 'sub_titled',
    recordCreatedAt: '2026-04-03T09:00:00.000Z',
    recordUpdatedAt: '2026-04-03T10:00:00.000Z',
    boards: [
      {
        boardId: 'main',
        title: 'Main board',
        createdAt: '2026-04-03T09:05:00.000Z',
        updatedAt: '2026-04-03T09:55:00.000Z',
        cards: []
      }
    ]
  });
  const untitledRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_untitled',
    viewerSub: 'sub_untitled',
    recordCreatedAt: '2026-04-04T09:00:00.000Z',
    recordUpdatedAt: '2026-04-04T10:00:00.000Z',
    boards: [
      {
        boardId: 'main',
        title: 'Untitled board',
        createdAt: '2026-04-04T09:05:00.000Z',
        updatedAt: '2026-04-04T09:55:00.000Z',
        cards: []
      }
    ]
  });
  const readModel = new MongoPortfolioReadModel({
    collection: createCollectionDouble([
      toWorkspaceRecordDocument(titledRecord),
      toWorkspaceRecordDocument(untitledRecord)
    ])
  });

  const summary = await readModel.loadPortfolioSummary();

  assert.equal(
    summary.workspaces.find((workspace) => workspace.workspaceId === 'workspace_titled')?.workspaceTitle,
    'Studio workspace'
  );
  assert.equal(
    summary.workspaces.find((workspace) => workspace.workspaceId === 'workspace_untitled')?.workspaceTitle,
    null
  );
  assert.equal(
    summary.boardDirectory.find((entry) => entry.workspaceId === 'workspace_titled')?.workspaceTitle,
    'Studio workspace'
  );
});

test('loadPortfolioSummary keeps workspace and board grouping stable and sorts queue items by the expected timestamps', async () => {
  const alphaRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_alpha',
    viewerSub: 'sub_owner_alpha',
    recordCreatedAt: '2026-04-01T08:00:00.000Z',
    recordUpdatedAt: '2026-04-03T12:00:00.000Z',
    boards: [
      {
        boardId: 'bravo',
        title: 'Complete board',
        createdAt: '2026-04-01T08:05:00.000Z',
        updatedAt: '2026-04-03T11:00:00.000Z',
        cards: [
          {
            title: 'Complete card',
            detailsMarkdown: 'No localization backlog'
          }
        ]
      },
      {
        boardId: 'charlie',
        title: 'Alpha localization backlog',
        createdAt: '2026-04-01T08:10:00.000Z',
        updatedAt: '2026-04-03T11:30:00.000Z',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['ja']
        },
        cards: [
          {
            title: 'Await approval alpha',
            detailsMarkdown: 'Needs human verification',
            createdAt: '2026-04-01T08:11:00.000Z',
            updatedAt: '2026-04-02T09:10:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '確認待ち alpha',
                detailsMarkdown: 'Alpha verification item',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-03T09:05:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai',
                  verificationRequestedBy: { type: 'human', id: 'sub_owner_alpha' },
                  verificationRequestedAt: '2026-04-01T10:00:00.000Z'
                }
              })
            ]
          },
          {
            title: 'AI proposal alpha',
            detailsMarkdown: 'Alpha proposal item',
            createdAt: '2026-04-01T08:12:00.000Z',
            updatedAt: '2026-04-02T09:20:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '提案 alpha',
                detailsMarkdown: 'Alpha AI proposal',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-02T08:00:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai'
                }
              })
            ]
          },
          {
            title: 'Missing alpha',
            detailsMarkdown: 'Still needs Japanese',
            createdAt: '2026-04-01T08:13:00.000Z',
            updatedAt: '2026-04-02T09:00:00.000Z'
          }
        ]
      }
    ],
    boardOrder: ['bravo', 'charlie']
  });
  const betaRecord = createPortfolioRecordFixture({
    workspaceId: 'workspace_beta',
    viewerSub: 'sub_owner_beta',
    recordCreatedAt: '2026-04-01T07:00:00.000Z',
    recordUpdatedAt: '2026-04-04T12:00:00.000Z',
    boards: [
      {
        boardId: 'alpha',
        title: 'Beta localization backlog',
        createdAt: '2026-04-01T08:05:00.000Z',
        updatedAt: '2026-04-04T11:30:00.000Z',
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'ja'],
          requiredLocales: ['ja']
        },
        cards: [
          {
            title: 'Await approval beta',
            detailsMarkdown: 'Needs human verification too',
            createdAt: '2026-04-01T08:06:00.000Z',
            updatedAt: '2026-04-04T09:10:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '確認待ち beta',
                detailsMarkdown: 'Beta verification item',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-04T09:05:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai',
                  verificationRequestedBy: { type: 'human', id: 'sub_owner_beta' },
                  verificationRequestedAt: '2026-04-03T10:00:00.000Z'
                }
              })
            ]
          },
          {
            title: 'AI proposal beta',
            detailsMarkdown: 'Beta proposal item',
            createdAt: '2026-04-01T08:07:00.000Z',
            updatedAt: '2026-04-04T09:20:00.000Z',
            localizedContent: [
              createLocalizedVariant({
                locale: 'ja',
                title: '提案 beta',
                detailsMarkdown: 'Beta AI proposal',
                actor: { type: 'agent', id: 'agent_localizer' },
                timestamp: '2026-04-02T08:00:00.000Z',
                includesHumanInput: false,
                review: {
                  origin: 'ai'
                }
              })
            ]
          },
          {
            title: 'Missing beta',
            detailsMarkdown: 'Still needs Japanese too',
            createdAt: '2026-04-01T08:08:00.000Z',
            updatedAt: '2026-04-01T09:00:00.000Z'
          }
        ]
      }
    ]
  });
  const collection = createCollectionDouble([
    toWorkspaceRecordDocument(betaRecord),
    toWorkspaceRecordDocument(alphaRecord)
  ]);
  const readModel = new MongoPortfolioReadModel({ collection });

  const summary = await readModel.loadPortfolioSummary();

  assert.deepEqual(
    summary.workspaces.map((workspace) => workspace.workspaceId),
    ['workspace_alpha', 'workspace_beta']
  );
  assert.deepEqual(
    summary.boardDirectory.map((entry) => `${entry.workspaceId}:${entry.boardId}`),
    ['workspace_alpha:bravo', 'workspace_alpha:charlie', 'workspace_beta:alpha']
  );
  assert.deepEqual(
    summary.awaitingHumanVerificationItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      cardTitle: item.cardTitle,
      verificationRequestedAt: item.verificationRequestedAt
    })),
    [
      {
        workspaceId: 'workspace_alpha',
        boardId: 'charlie',
        cardTitle: 'Await approval alpha',
        verificationRequestedAt: '2026-04-01T10:00:00.000Z'
      },
      {
        workspaceId: 'workspace_beta',
        boardId: 'alpha',
        cardTitle: 'Await approval beta',
        verificationRequestedAt: '2026-04-03T10:00:00.000Z'
      }
    ]
  );
  assert.deepEqual(
    summary.agentProposalItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      cardTitle: item.cardTitle,
      proposedAt: item.proposedAt
    })),
    [
      {
        workspaceId: 'workspace_alpha',
        boardId: 'charlie',
        cardTitle: 'AI proposal alpha',
        proposedAt: '2026-04-02T08:00:00.000Z'
      },
      {
        workspaceId: 'workspace_beta',
        boardId: 'alpha',
        cardTitle: 'AI proposal beta',
        proposedAt: '2026-04-02T08:00:00.000Z'
      }
    ]
  );
  assert.deepEqual(
    summary.missingRequiredLocalizationItems.map((item) => ({
      workspaceId: item.workspaceId,
      boardId: item.boardId,
      cardTitle: item.cardTitle,
      cardUpdatedAt: item.cardUpdatedAt
    })),
    [
      {
        workspaceId: 'workspace_beta',
        boardId: 'alpha',
        cardTitle: 'Missing beta',
        cardUpdatedAt: '2026-04-01T09:00:00.000Z'
      },
      {
        workspaceId: 'workspace_alpha',
        boardId: 'charlie',
        cardTitle: 'Missing alpha',
        cardUpdatedAt: '2026-04-02T09:00:00.000Z'
      }
    ]
  );

  for (const item of [
    ...summary.awaitingHumanVerificationItems,
    ...summary.agentProposalItems,
    ...summary.missingRequiredLocalizationItems
  ]) {
    assert.equal(Object.hasOwn(item, 'contentByLocale'), false);
    assert.equal(Object.hasOwn(item, 'detailsMarkdown'), false);
    assert.equal(Object.hasOwn(item, 'localeRequests'), false);
    assert.equal(Object.hasOwn(item, 'provenance'), false);
    assert.equal(Object.hasOwn(item, 'review'), false);
  }
});

function createPortfolioRecordFixture({
  workspaceId,
  workspaceTitle = null,
  viewerSub,
  recordCreatedAt,
  recordUpdatedAt,
  boards,
  boardOrder = boards.map((board) => board.boardId)
}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId,
    now: recordCreatedAt
  });
  const workspace = createEmptyWorkspace({
    workspaceId,
    creator: {
      type: 'human',
      id: viewerSub
    }
  });

  workspace.title = workspaceTitle;

  workspace.boards = {};
  workspace.boardOrder = [];
  workspace.ui.activeBoardId = null;
  let nextWorkspace = workspace;

  for (const boardConfig of boards) {
    nextWorkspace = addBoard(nextWorkspace, viewerSub, boardConfig);
  }

  nextWorkspace.boardOrder = [...boardOrder];
  nextWorkspace.ui.activeBoardId = nextWorkspace.boardOrder[0] ?? null;

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace: nextWorkspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: recordUpdatedAt
  });
}

function addBoard(workspace, viewerSub, {
  boardId,
  title,
  createdAt,
  updatedAt,
  languagePolicy = null,
  memberships = [],
  cards = []
}) {
  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspace.workspaceId}_${boardId}`,
    creator: {
      type: 'human',
      id: viewerSub
    }
  }).boards.main;
  const board = structuredClone(sourceBoard);

  board.id = boardId;
  board.title = title;
  board.createdAt = createdAt;
  board.updatedAt = updatedAt;

  if (languagePolicy) {
    board.languagePolicy = structuredClone(languagePolicy);
  }

  if (memberships.length) {
    board.collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  }

  let nextWorkspace = structuredClone(workspace);
  nextWorkspace.boards[boardId] = board;

  for (const card of cards) {
    nextWorkspace = addBoardCard(nextWorkspace, boardId, card);
  }

  nextWorkspace.boards[boardId].createdAt = createdAt;
  nextWorkspace.boards[boardId].updatedAt = updatedAt;

  if (memberships.length) {
    nextWorkspace.boards[boardId].collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  }

  return nextWorkspace;
}

function addBoardCard(workspace, boardId, {
  title,
  detailsMarkdown,
  createdAt = null,
  updatedAt = null,
  localeRequests = null,
  localizedContent = []
}) {
  const previousCardIds = new Set(Object.keys(workspace.boards[boardId].cards ?? {}));
  const nextWorkspace = createCard(workspace, boardId, {
    title,
    detailsMarkdown
  });
  const cardId = Object.keys(nextWorkspace.boards[boardId].cards).find((candidateId) => !previousCardIds.has(candidateId));
  const card = nextWorkspace.boards[boardId].cards[cardId];

  if (createdAt) {
    card.createdAt = createdAt;
  }

  if (updatedAt) {
    card.updatedAt = updatedAt;
  }

  if (localeRequests) {
    card.localeRequests = structuredClone(localeRequests);
  }

  for (const variant of localizedContent) {
    card.contentByLocale[variant.locale] = createStoredLocalizedVariant(variant);
  }

  return nextWorkspace;
}

function createStoredLocalizedVariant({
  locale: _locale,
  title,
  detailsMarkdown,
  actor,
  timestamp,
  includesHumanInput = true,
  review = null
}) {
  return {
    title,
    detailsMarkdown,
    provenance: createCardContentProvenance({
      actor,
      timestamp,
      includesHumanInput
    }),
    review: review ? createCardContentReview(review) : null
  };
}

function createLocalizedVariant({
  locale,
  title,
  detailsMarkdown,
  actor,
  timestamp,
  includesHumanInput = true,
  review = null
}) {
  return {
    locale,
    title,
    detailsMarkdown,
    actor,
    timestamp,
    includesHumanInput,
    review
  };
}

function createOpenLocaleRequest({ locale, requestedBy, requestedAt }) {
  return {
    locale,
    status: 'open',
    requestedBy,
    requestedAt
  };
}

function createCollectionDouble(initialDocuments = []) {
  const documents = initialDocuments.map((document) => structuredClone(document));

  return {
    find() {
      return {
        async toArray() {
          return documents.map((document) => structuredClone(document));
        }
      };
    }
  };
}
