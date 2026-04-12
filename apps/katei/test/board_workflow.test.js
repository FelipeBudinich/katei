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
      id: 'todo',
      title: 'Todo',
      cardIds: [],
      allowedTransitionStageIds: ['doing', 'done'],
      templateIds: [],
      actions: ['card.create'],
      actionIds: ['card.create']
    },
    {
      id: 'doing',
      title: 'Doing',
      cardIds: [],
      allowedTransitionStageIds: ['todo', 'done'],
      templateIds: [],
      actions: [],
      actionIds: []
    },
    {
      id: 'done',
      title: 'Done',
      cardIds: [],
      allowedTransitionStageIds: ['todo', 'doing'],
      templateIds: [],
      actions: ['card.review', 'card.delete'],
      actionIds: ['card.review', 'card.delete']
    }
  ]);

  firstStages[0].title = 'Changed';
  assert.equal(secondStages[0].title, 'Todo');
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

test('validateBoardStages accepts card.review as a valid stage action id', () => {
  const board = createCustomWorkflowBoard();

  board.stages.review.actionIds = ['card.review'];

  assert.equal(validateBoardStages(board), true);
});

test('validateBoardStages accepts review policies only on card.review stages', () => {
  const board = createCustomWorkflowBoard();

  board.stages.review.actionIds = ['card.review'];
  board.stages.review.reviewPolicy = {
    approverRole: 'admin'
  };

  assert.equal(validateBoardStages(board), true);

  delete board.stages.review.reviewPolicy;
  board.stages.qa.reviewPolicy = {
    approverRole: 'admin'
  };

  assert.equal(validateBoardStages(board), false);
});

test('validateBoardStages rejects duplicate stage ids or invalid stage definitions', () => {
  const board = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['todo', 'doing', 'done', 'done'];
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

test('validateBoardStages rejects unknown or duplicate stage action ids', () => {
  const boardWithUnknownAction = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  boardWithUnknownAction.stages.todo.actionIds = ['board.delete'];

  assert.equal(validateBoardStages(boardWithUnknownAction), false);

  const boardWithDuplicateActions = createWorkspaceBoard({
    id: 'main',
    title: 'Main board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  boardWithDuplicateActions.stages.done.actionIds = ['card.delete', 'card.delete'];

  assert.equal(validateBoardStages(boardWithDuplicateActions), false);
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
        initialStageId: 'todo'
      }
    ]
  };
  board.stages.todo.templateIds = ['template_1'];

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
      templateIds: [],
      actionIds: []
    },
    review: {
      id: 'review',
      title: 'Review',
      cardIds: [],
      allowedTransitionStageIds: ['draft', 'qa'],
      templateIds: [],
      actionIds: []
    },
    qa: {
      id: 'qa',
      title: 'QA',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: [],
      actionIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['qa'],
      templateIds: [],
      actionIds: []
    }
  };

  return board;
}
