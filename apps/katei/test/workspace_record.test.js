import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import {
  appendActivityEvent,
  appendCommandReceipt,
  createActivityEvent,
  createCommandReceipt,
  createWorkspaceRecord,
  findCommandReceipt
} from '../src/workspaces/workspace_record.js';

function createRecord(overrides = {}) {
  return createWorkspaceRecord({
    viewerSub: 'sub_123',
    workspace: createEmptyWorkspace(),
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
