import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace
} from '../public/js/domain/workspace.js';
import { MongoPortfolioReadModel } from '../src/workspaces/mongo_portfolio_read_model.js';
import {
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  toWorkspaceRecordDocument
} from '../src/workspaces/workspace_record.js';

test('loadPortfolioSummary returns deterministic summary-only workspace and board rollups', async () => {
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
            detailsMarkdown: 'Japanese localization'
          },
          {
            title: 'Check glossaries',
            detailsMarkdown: 'Shared board card'
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
      total: 2,
      byStage: null
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
    nextWorkspace = createCard(nextWorkspace, boardId, card);
  }

  nextWorkspace.boards[boardId].createdAt = createdAt;
  nextWorkspace.boards[boardId].updatedAt = updatedAt;

  if (memberships.length) {
    nextWorkspace.boards[boardId].collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  }

  return nextWorkspace;
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
