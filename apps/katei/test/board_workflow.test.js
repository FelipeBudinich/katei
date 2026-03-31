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
    {
      id: 'backlog',
      title: 'Backlog',
      cardIds: [],
      allowedTransitionStageIds: ['doing', 'done'],
      templateIds: []
    },
    {
      id: 'doing',
      title: 'Doing',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'done'],
      templateIds: []
    },
    {
      id: 'done',
      title: 'Done',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'doing', 'archived'],
      templateIds: []
    },
    {
      id: 'archived',
      title: 'Archived',
      cardIds: [],
      allowedTransitionStageIds: ['backlog', 'doing', 'done'],
      templateIds: []
    }
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

test('validateBoardStages accepts boards that define their own stages and transitions', () => {
  const board = createCustomWorkflowBoard();

  assert.equal(validateBoardStages(board), true);
});

test('validateBoardStages rejects duplicate stage ids or invalid stage definitions', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['backlog', 'doing', 'done', 'done'];
  assert.equal(validateBoardStages(board), false);

  const boardWithBadTitle = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  boardWithBadTitle.stages.doing.title = '';

  assert.equal(validateBoardStages(boardWithBadTitle), false);
});

test('validateBoardTemplates accepts synced templates and rejects malformed ones', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.templates = {
    default: [
      {
        id: 'template_1',
        title: 'Reusable draft',
        initialStageId: 'backlog'
      }
    ]
  };
  board.stages.backlog.templateIds = ['template_1'];

  assert.equal(validateBoardTemplates(board), true);

  board.templates.default[0].initialStageId = 'review';

  assert.equal(validateBoardTemplates(board), false);
});

test('validateBoardTemplates supports templates on board-defined stages and rejects unsynced stage references', () => {
  const board = createCustomWorkflowBoard();

  board.templates = {
    default: [
      {
        id: 'review_pass',
        title: 'Review pass',
        initialStageId: 'review'
      }
    ]
  };
  board.stages.review.templateIds = ['review_pass'];

  assert.equal(validateBoardTemplates(board), true);

  board.stages.qa.templateIds = ['review_pass'];

  assert.equal(validateBoardTemplates(board), false);
});

function createCustomWorkflowBoard() {
  const board = createWorkspaceBoard({
    id: 'board_custom',
    title: 'Custom workflow',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['draft', 'review', 'qa', 'published'];
  board.stages = {
    draft: {
      id: 'draft',
      title: 'Draft',
      cardIds: [],
      allowedTransitionStageIds: ['review'],
      templateIds: []
    },
    review: {
      id: 'review',
      title: 'Review',
      cardIds: [],
      allowedTransitionStageIds: ['draft', 'qa'],
      templateIds: []
    },
    qa: {
      id: 'qa',
      title: 'QA',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['qa'],
      templateIds: []
    }
  };

  return board;
}
