import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import { validateBoardStages, validateBoardTemplates } from '../public/js/domain/board_workflow.js';

test('default board creation includes stage order, stages, templates, and language policy', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  assert.deepEqual(board.stageOrder, ['backlog', 'doing', 'done', 'archived']);
  assert.deepEqual(Object.keys(board.stages), ['backlog', 'doing', 'done', 'archived']);
  assert.deepEqual(board.stages.backlog.allowedTransitionStageIds, ['doing', 'done']);
  assert.deepEqual(board.stages.backlog.actionIds, ['card.create']);
  assert.deepEqual(board.stages.doing.actionIds, ['card.create']);
  assert.deepEqual(board.stages.done.allowedTransitionStageIds, ['backlog', 'doing', 'archived']);
  assert.deepEqual(board.stages.done.actionIds, []);
  assert.deepEqual(board.stages.archived.actionIds, ['card.delete']);
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

  board.stages.backlog.allowedTransitionStageIds = ['review'];

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
        initialStageId: 'backlog'
      }
    ]
  };
  board.stages.backlog.templateIds = ['template_1'];

  assert.equal(validateBoardTemplates(board), true);

  board.templates.default[0].initialStageId = 'review';
  assert.equal(validateBoardTemplates(board), false);
});
