import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { validateWorkspaceShape } from '../public/js/domain/workspace_validation.js';
import { createMutationContext } from '../src/workspaces/mutation_context.js';
import { applyWorkspaceCommand } from '../src/workspaces/apply_workspace_command.js';
import { createWorkspaceRecord } from '../src/workspaces/workspace_record.js';
import { WorkspaceRevisionConflictError } from '../src/workspaces/workspace_record_repository.js';

function createRecord(workspace = createEmptyWorkspace(), revision = 0) {
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
    ...overrides
  });
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
  assert.equal(result.boardId, 'board_srv001');
  assert.equal(result.noOp, false);
  assert.equal(activityEvent.type, 'workspace.command.applied');
  assert.equal(activityEvent.revision, 1);
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
  assert.deepEqual(workspace.boards.main.columns.backlog.cardIds, ['card_srv001']);
  assert.equal(workspace.boards.main.cards.card_srv001.createdAt, '2026-03-31T10:00:00.000Z');
  assert.equal(workspace.boards.main.cards.card_srv001.updatedAt, '2026-03-31T10:00:00.000Z');
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
  assert.equal(workspace.boards.main.cards.card_srv001.title, 'Updated title');
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

  assert.deepEqual(workspace.boards.main.columns.backlog.cardIds, []);
  assert.deepEqual(workspace.boards.main.columns.doing.cardIds, ['card_srv001']);
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
  assert.deepEqual(workspace.boards.main.columns.backlog.cardIds, []);
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
        record: createRecord(createEmptyWorkspace(), 2),
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
      type: 'ui.columnCollapsed.set',
      payload: {
        boardId: 'main',
        columnId: 'doing',
        isCollapsed: true
      }
    },
    expectedRevision: 0,
    context: createContext()
  });

  assert.equal(validateWorkspaceShape(workspace), true);
  assert.equal(workspace.ui.collapsedColumnsByBoard.main.doing, true);
});
