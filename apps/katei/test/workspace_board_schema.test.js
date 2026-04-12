import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { validateBoardStages, validateBoardTemplates } from '../public/js/domain/board_workflow.js';

test('default board creation includes stage order, stages, templates, and language policy', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  assert.deepEqual(board.stageOrder, ['todo', 'doing', 'done']);
  assert.deepEqual(Object.keys(board.stages), ['todo', 'doing', 'done']);
  assert.deepEqual(board.stages.todo.allowedTransitionStageIds, ['doing', 'done']);
  assert.deepEqual(board.stages.todo.actions, ['card.create']);
  assert.deepEqual(board.stages.todo.actionIds, ['card.create']);
  assert.deepEqual(board.stages.doing.allowedTransitionStageIds, ['todo', 'done']);
  assert.deepEqual(board.stages.doing.actions, []);
  assert.deepEqual(board.stages.doing.actionIds, []);
  assert.deepEqual(board.stages.done.allowedTransitionStageIds, ['todo', 'doing']);
  assert.deepEqual(board.stages.done.actions, ['card.review', 'card.delete']);
  assert.deepEqual(board.stages.done.actionIds, ['card.review', 'card.delete']);
  assert.equal(board.collaboration.memberships[0].role, 'admin');
  assert.deepEqual(board.collaboration.invites, []);
  assert.deepEqual(board.templates, {
    default: []
  });
  assert.deepEqual(board.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
});

test('validateBoardStages rejects transition targets that do not exist', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.stages.todo.allowedTransitionStageIds = ['review'];

  assert.equal(validateBoardStages(board), false);
});

test('validateBoardTemplates requires initial stage ids and stage template ids to stay in sync', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.templates = {
    default: [
      {
        id: 'template_1',
        title: 'Research note',
        initialStageId: 'todo'
      }
    ]
  };
  board.stages.todo.templateIds = ['template_1'];

  assert.equal(validateBoardTemplates(board), true);

  board.templates.default[0].initialStageId = 'review';
  assert.equal(validateBoardTemplates(board), false);
});
