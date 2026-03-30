import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCard,
  createEmptyWorkspace,
  updateCard,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';

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
