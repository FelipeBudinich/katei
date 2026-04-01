import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import {
  appendActivityEvent,
  appendCommandReceipt,
  createActivityEvent,
  createCommandAppliedWorkspaceRecord,
  createCommandReceipt,
  createWorkspaceRecord,
  createHomeWorkspaceId,
  fromWorkspaceRecordDocument,
  findCommandReceipt
} from '../src/workspaces/workspace_record.js';

function createRecord(overrides = {}) {
  const workspaceId = createHomeWorkspaceId('sub_123');
  return createWorkspaceRecord({
    workspaceId,
    viewerSub: 'sub_123',
    workspace: createEmptyWorkspace({
      workspaceId,
      creator: {
        type: 'human',
        id: 'sub_123'
      }
    }),
    revision: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    lastChangedBy: null,
    activityEvents: [],
    commandReceipts: [],
    ...overrides
  });
}

test('findCommandReceipt looks up a receipt by clientMutationId', () => {
  const record = createRecord({
    commandReceipts: [
      createCommandReceipt({
        clientMutationId: 'm1',
        commandType: 'board.create',
        actorId: 'sub_123',
        revision: 1,
        appliedAt: '2026-04-01T10:05:00.000Z',
        result: {
          boardId: 'board_1',
          noOp: false
        }
      })
    ]
  });

  assert.deepEqual(findCommandReceipt(record, 'm1'), {
    clientMutationId: 'm1',
    commandType: 'board.create',
    actorId: 'sub_123',
    revision: 1,
    appliedAt: '2026-04-01T10:05:00.000Z',
    result: {
      boardId: 'board_1',
      noOp: false
    }
  });
  assert.equal(findCommandReceipt(record, 'missing'), null);
});

test('appendCommandReceipt retains a bounded recent receipt set', () => {
  const record = createRecord({
    commandReceipts: [
      createCommandReceipt({
        clientMutationId: 'm1',
        commandType: 'board.create',
        actorId: 'sub_123',
        revision: 1,
        appliedAt: '2026-04-01T10:05:00.000Z',
        result: { noOp: false }
      }),
      createCommandReceipt({
        clientMutationId: 'm2',
        commandType: 'card.create',
        actorId: 'sub_123',
        revision: 2,
        appliedAt: '2026-04-01T10:06:00.000Z',
        result: { noOp: false }
      })
    ]
  });

  const receipts = appendCommandReceipt(
    record,
    {
      clientMutationId: 'm3',
      commandType: 'card.update',
      actorId: 'sub_123',
      revision: 3,
      appliedAt: '2026-04-01T10:07:00.000Z',
      result: { noOp: false }
    },
    2
  );

  assert.deepEqual(
    receipts.map((receipt) => receipt.clientMutationId),
    ['m2', 'm3']
  );
});

test('command receipts remain record metadata and do not pollute workspace JSON', () => {
  const record = createRecord({
    commandReceipts: [
      createCommandReceipt({
        clientMutationId: 'm1',
        commandType: 'board.create',
        actorId: 'sub_123',
        revision: 1,
        appliedAt: '2026-04-01T10:05:00.000Z',
        result: { boardId: 'board_1', noOp: false }
      })
    ]
  });

  assert.equal(Object.hasOwn(record.workspace, 'commandReceipts'), false);
  assert.equal(record.commandReceipts.length, 1);
});

test('createActivityEvent supports semantic entity and compact details fields', () => {
  const event = createActivityEvent({
    id: 'activity_1',
    type: 'card.moved',
    actor: { type: 'human', id: 'sub_123' },
    createdAt: '2026-04-01T10:10:00.000Z',
    revision: 3,
    entity: {
      kind: 'card',
      boardId: 'main',
      cardId: 'card_1'
    },
    details: {
      sourceColumnId: 'backlog',
      targetColumnId: 'doing'
    }
  });

  assert.deepEqual(event, {
    id: 'activity_1',
    type: 'card.moved',
    actor: { type: 'human', id: 'sub_123' },
    createdAt: '2026-04-01T10:10:00.000Z',
    revision: 3,
    entity: {
      kind: 'card',
      boardId: 'main',
      cardId: 'card_1'
    },
    details: {
      sourceColumnId: 'backlog',
      targetColumnId: 'doing'
    }
  });
});

test('appendActivityEvent retains a bounded recent activity set', () => {
  const record = createRecord({
    activityEvents: [
      createActivityEvent({
        id: 'activity_1',
        type: 'board.created',
        createdAt: '2026-04-01T10:05:00.000Z',
        revision: 1
      }),
      createActivityEvent({
        id: 'activity_2',
        type: 'board.renamed',
        createdAt: '2026-04-01T10:06:00.000Z',
        revision: 2
      })
    ]
  });

  const events = appendActivityEvent(
    record,
    {
      id: 'activity_3',
      type: 'card.created',
      createdAt: '2026-04-01T10:07:00.000Z',
      revision: 3,
      entity: {
        kind: 'card',
        boardId: 'main',
        cardId: 'card_1'
      }
    },
    2
  );

  assert.deepEqual(
    events.map((event) => event.id),
    ['activity_2', 'activity_3']
  );
});

test('older activity events without entity or details still load safely', () => {
  const record = createRecord({
    activityEvents: [
      {
        id: 'activity_legacy',
        type: 'workspace.saved',
        actor: { type: 'human', id: 'sub_123' },
        createdAt: '2026-04-01T10:05:00.000Z',
        revision: 1
      }
    ]
  });

  assert.deepEqual(record.activityEvents, [
    {
      id: 'activity_legacy',
      type: 'workspace.saved',
      actor: { type: 'human', id: 'sub_123' },
      createdAt: '2026-04-01T10:05:00.000Z',
      revision: 1,
      entity: null,
      details: null
    }
  ]);
});

test('fromWorkspaceRecordDocument migrates legacy home documents to canonical shared-workspace ids', () => {
  const record = fromWorkspaceRecordDocument({
    _id: 'sub_123',
    viewerSub: 'sub_123',
    workspace: createEmptyWorkspace(),
    revision: 1,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:05:00.000Z',
    lastChangedBy: 'sub_123',
    activityEvents: [],
    commandReceipts: []
  });

  assert.equal(record.workspace.ui.collapsedColumnsByBoard, undefined);

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.isHomeWorkspace, true);
  assert.equal(record.documentId, 'sub_123');
  assert.equal(record.workspace.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.deepEqual(record.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(record.workspace.access, {
    kind: 'private'
  });
});

test('fromWorkspaceRecordDocument accepts ownerSub-only legacy documents and seeds owner admin memberships', () => {
  const record = fromWorkspaceRecordDocument({
    _id: 'sub_owner',
    ownerSub: 'sub_owner',
    workspace: {
      version: 5,
      workspaceId: 'sub_owner',
      ui: {
        activeBoardId: 'main',
        collapsedColumnsByBoard: {
          main: {
            backlog: false,
            doing: false,
            done: false,
            archived: false
          }
        }
      },
      boardOrder: ['main'],
      boards: {
        main: {
          id: 'main',
          title: 'Legacy board',
          createdAt: '2026-04-01T09:00:00.000Z',
          updatedAt: '2026-04-01T09:00:00.000Z',
          columnOrder: ['backlog', 'doing', 'done', 'archived'],
          columns: {
            backlog: {
              id: 'backlog',
              title: 'Backlog',
              cardIds: ['card_1'],
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
          cards: {
            card_1: {
              id: 'card_1',
              title: 'Legacy task',
              detailsMarkdown: 'Needs backfill',
              priority: 'important',
              createdAt: '2026-04-01T09:00:00.000Z',
              updatedAt: '2026-04-01T09:30:00.000Z'
            }
          }
        }
      }
    },
    revision: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    lastChangedBy: null,
    activityEvents: [],
    commandReceipts: []
  });

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_owner'));
  assert.equal(record.workspace.workspaceId, createHomeWorkspaceId('sub_owner'));
  assert.deepEqual(record.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_owner'
    }
  });
  assert.deepEqual(record.workspace.boards.main.collaboration.memberships, [
    {
      actor: {
        type: 'human',
        id: 'sub_owner'
      },
      role: 'admin',
      joinedAt: '2026-04-01T09:00:00.000Z'
    }
  ]);
});

test('createWorkspaceRecord preserves canonical owner/admin seeding assumptions for migrated home records', () => {
  const record = createWorkspaceRecord({
    workspaceId: 'sub_123',
    viewerSub: 'sub_123',
    isHomeWorkspace: true,
    documentId: 'sub_123',
    workspace: createEmptyWorkspace({
      workspaceId: 'sub_123'
    }),
    revision: 0,
    createdAt: '2026-04-01T10:00:00.000Z',
    updatedAt: '2026-04-01T10:00:00.000Z',
    activityEvents: [],
    commandReceipts: []
  });

  assert.equal(record.workspaceId, createHomeWorkspaceId('sub_123'));
  assert.equal(record.documentId, 'sub_123');
  assert.deepEqual(record.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.equal(record.workspace.boards.main.collaboration.memberships[0].actor.id, 'sub_123');
  assert.equal(record.workspace.boards.main.collaboration.memberships[0].role, 'admin');
});

test('createCommandAppliedWorkspaceRecord appends semantic activity and a command receipt together', () => {
  const workspace = createEmptyWorkspace();
  workspace.boards.main.title = 'Roadmap';

  const nextRecord = createCommandAppliedWorkspaceRecord(createRecord(), {
    workspace,
    actor: { type: 'human', id: 'sub_123' },
    now: '2026-04-01T10:15:00.000Z',
    activityEvent: createActivityEvent({
      id: 'activity_cmd_1',
      type: 'board.renamed',
      actor: { type: 'human', id: 'sub_123' },
      createdAt: '2026-04-01T10:15:00.000Z',
      revision: 1,
      entity: {
        kind: 'board',
        boardId: 'main'
      },
      details: {
        title: 'Roadmap'
      }
    }),
    commandReceipt: createCommandReceipt({
      clientMutationId: 'm1',
      commandType: 'board.rename',
      actorId: 'sub_123',
      revision: 1,
      appliedAt: '2026-04-01T10:15:00.000Z',
      result: {
        boardId: 'main',
        noOp: false
      }
    })
  });

  assert.equal(nextRecord.revision, 1);
  assert.equal(nextRecord.updatedAt, '2026-04-01T10:15:00.000Z');
  assert.equal(nextRecord.lastChangedBy, 'sub_123');
  assert.deepEqual(nextRecord.activityEvents, [
    {
      id: 'activity_cmd_1',
      type: 'board.renamed',
      actor: { type: 'human', id: 'sub_123' },
      createdAt: '2026-04-01T10:15:00.000Z',
      revision: 1,
      entity: {
        kind: 'board',
        boardId: 'main',
        cardId: null
      },
      details: {
        title: 'Roadmap'
      }
    }
  ]);
  assert.deepEqual(nextRecord.commandReceipts, [
    {
      clientMutationId: 'm1',
      commandType: 'board.rename',
      actorId: 'sub_123',
      revision: 1,
      appliedAt: '2026-04-01T10:15:00.000Z',
      result: {
        boardId: 'main',
        noOp: false
      }
    }
  ]);
});
