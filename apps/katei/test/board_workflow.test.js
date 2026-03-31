import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDefaultBoardStages,
  validateBoardStages,
  validateBoardTemplates
} from '../public/js/domain/board_workflow.js';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';

test('createDefaultBoardStages returns the default workflow stages as fresh objects', () => {
  const firstStages = createDefaultBoardStages();
  const secondStages = createDefaultBoardStages();

  assert.deepEqual(firstStages, [
    { id: 'backlog', title: 'Backlog' },
    { id: 'doing', title: 'Doing' },
    { id: 'done', title: 'Done' },
    { id: 'archived', title: 'Archived' }
  ]);

  firstStages[0].title = 'Changed';
  assert.equal(secondStages[0].title, 'Backlog');
});

test('validateBoardStages accepts boards that match the current workflow schema', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  assert.equal(validateBoardStages(board), true);
});

test('validateBoardStages rejects invalid stage order or column definitions', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.columnOrder = ['backlog', 'done', 'doing', 'archived'];
  assert.equal(validateBoardStages(board), false);

  const boardWithBadTitle = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  boardWithBadTitle.columns.doing.title = 'In progress';

  assert.equal(validateBoardStages(boardWithBadTitle), false);
});

test('validateBoardTemplates accepts absent templates and rejects malformed ones', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  assert.equal(validateBoardTemplates(board), true);

  board.templates = [
    {
      id: 'template_1',
      title: 'Reusable draft',
      stageId: 'backlog'
    }
  ];

  assert.equal(validateBoardTemplates(board), true);

  board.templates = [
    {
      id: 'template_1',
      title: 'Broken draft',
      stageId: 'review'
    }
  ];

  assert.equal(validateBoardTemplates(board), false);
});
