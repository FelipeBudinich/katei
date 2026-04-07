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
    boardDirectory: []
  });
});

function createPortfolioRecordFixture({
  workspaceId,
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
