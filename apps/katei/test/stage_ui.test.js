import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import { shouldShowDeleteForStage } from '../public/js/controllers/stage_ui.js';

test('shouldShowDeleteForStage follows schema-defined stage actions instead of literal stage ids', () => {
  const board = createWorkspaceBoard({
    id: 'board_actions',
    title: 'Board actions',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['backlog', 'archive-bin', 'archived'];
  board.stages = {
    backlog: {
      id: 'backlog',
      title: 'Backlog',
      cardIds: [],
      allowedTransitionStageIds: ['archive-bin', 'archived'],
      templateIds: [],
      actionIds: []
    },
    'archive-bin': {
      id: 'archive-bin',
      title: 'Archive Bin',
      cardIds: [],
      allowedTransitionStageIds: ['backlog'],
      templateIds: [],
      actionIds: ['card.delete']
    },
    archived: {
      id: 'archived',
      title: 'Archived',
      cardIds: [],
      allowedTransitionStageIds: ['backlog'],
      templateIds: [],
      actionIds: []
    }
  };

  assert.equal(shouldShowDeleteForStage(board, 'backlog'), false);
  assert.equal(shouldShowDeleteForStage(board, 'archive-bin'), true);
  assert.equal(shouldShowDeleteForStage(board, 'archived'), false);
});
