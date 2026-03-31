import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import {
  getDefaultBoardStageId,
  getBoardStageTitle,
  getStageMoveOptions,
  resolveBoardStageId
} from '../public/js/controllers/stage_ui.js';

test('resolveBoardStageId accepts stage ids and legacy column ids for the active board flow', () => {
  const board = createBoardWithCustomStages();
  board.stages.review.cardIds = ['card_1'];

  assert.equal(resolveBoardStageId(board, { stageId: 'review' }), 'review');
  assert.equal(resolveBoardStageId(board, { columnId: 'review' }), 'review');
  assert.equal(resolveBoardStageId(board, { cardId: 'card_1' }), 'review');
});

test('getStageMoveOptions derives editor move targets from allowedTransitionStageIds', () => {
  const board = createBoardWithCustomStages();

  assert.deepEqual(getStageMoveOptions(board, 'review'), [
    { id: 'review', title: 'Ready for Review' },
    { id: 'qa', title: 'QA Sweep' },
    { id: 'published', title: 'Published' }
  ]);
  assert.equal(getBoardStageTitle(board, 'qa'), 'QA Sweep');
});

test('getDefaultBoardStageId follows the board-defined stage order for create flows', () => {
  const board = createBoardWithCustomStages();

  assert.equal(getDefaultBoardStageId(board), 'review');
});

function createBoardWithCustomStages() {
  const board = createWorkspaceBoard({
    id: 'board_flow',
    title: 'Workflow board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['review', 'qa', 'published'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [],
      allowedTransitionStageIds: ['qa', 'published'],
      templateIds: []
    },
    qa: {
      id: 'qa',
      title: 'QA Sweep',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['review'],
      templateIds: []
    }
  };

  return board;
}
