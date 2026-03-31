import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { findColumnIdByCardId, getActiveBoard, getCollapsedColumnsForBoard } from '../public/js/domain/workspace_selectors.js';
import { validateWorkspaceShape } from '../public/js/domain/workspace_validation.js';
import {
  createCard,
  setColumnCollapsed,
  updateCard
} from '../public/js/domain/workspace_mutations.js';

test('createCard stores detailsMarkdown on new cards', () => {
  const workspace = createEmptyWorkspace();
  const nextWorkspace = createCard(workspace, 'main', {
    title: 'Write launch notes',
    detailsMarkdown: '## Launch\n\n- confirm copy',
    priority: 'urgent'
  });
  const board = nextWorkspace.boards.main;
  const [cardId] = board.columns.backlog.cardIds;

  assert.equal(board.cards[cardId].detailsMarkdown, '## Launch\n\n- confirm copy');
  assert.equal(board.cards[cardId].title, 'Write launch notes');
  assert.equal(board.cards[cardId].priority, 'urgent');
});

test('updateCard updates detailsMarkdown on existing cards', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Write launch notes',
    detailsMarkdown: 'Initial note',
    priority: 'important'
  });
  const board = workspace.boards.main;
  const [cardId] = board.columns.backlog.cardIds;
  const nextWorkspace = updateCard(workspace, 'main', cardId, {
    detailsMarkdown: 'Updated **markdown**'
  });

  assert.equal(nextWorkspace.boards.main.cards[cardId].detailsMarkdown, 'Updated **markdown**');
  assert.equal(nextWorkspace.boards.main.cards[cardId].title, 'Write launch notes');
  assert.equal(nextWorkspace.boards.main.cards[cardId].priority, 'important');
});

test('validateWorkspaceShape accepts cards that use detailsMarkdown', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship rollout',
    detailsMarkdown: 'Plain details',
    priority: 'normal'
  });

  assert.equal(validateWorkspaceShape(workspace), true);
});

test('validateWorkspaceShape rejects legacy cards that only use description', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_legacy = {
    id: 'card_legacy',
    title: 'Legacy card',
    description: 'Old field name',
    priority: 'important',
    createdAt: '2026-03-30T00:00:00.000Z',
    updatedAt: '2026-03-30T00:00:00.000Z'
  };
  board.columns.backlog.cardIds.push('card_legacy');

  assert.equal(validateWorkspaceShape(workspace), false);
});

test('getActiveBoard returns the active board from the read model', () => {
  const workspace = createEmptyWorkspace();

  assert.equal(getActiveBoard(workspace).id, 'main');
});

test('findColumnIdByCardId returns the containing column id', () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Trace card location',
    priority: 'normal'
  });
  const board = workspace.boards.main;
  const [cardId] = board.columns.backlog.cardIds;

  assert.equal(findColumnIdByCardId(board, cardId), 'backlog');
  assert.equal(findColumnIdByCardId(board, 'missing_card'), null);
});

test('getCollapsedColumnsForBoard merges stored state with default column flags', () => {
  const workspace = setColumnCollapsed(createEmptyWorkspace(), 'main', 'doing', true);

  assert.deepEqual(getCollapsedColumnsForBoard(workspace, 'main'), {
    backlog: false,
    doing: true,
    done: false,
    archived: false
  });
});
