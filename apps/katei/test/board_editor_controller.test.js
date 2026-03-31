import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import {
  createBoardEditorFormState,
  parseBoardEditorFormInput
} from '../public/js/controllers/board_editor_schema.js';

test('createBoardEditorFormState serializes the current board schema for editing', () => {
  const board = createEmptyWorkspace().boards.main;
  board.templates.default = [
    {
      id: 'starter',
      title: 'Starter',
      initialStageId: 'backlog'
    }
  ];
  board.stages.backlog.templateIds = ['starter'];

  const formState = createBoardEditorFormState(board);

  assert.equal(formState.title, '過程');
  assert.match(formState.stageDefinitions, /backlog \| Backlog \| doing, done/);
  assert.match(formState.templates, /starter \| Starter \| backlog/);
});

test('parseBoardEditorFormInput parses valid schema edits and generates template ids when omitted', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: 'en, ja',
    requiredLocales: 'en',
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n'),
    templates: 'Starter template | backlog'
  });

  assert.equal(parsedInput.title, 'Editorial board');
  assert.deepEqual(parsedInput.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  });
  assert.deepEqual(parsedInput.stageDefinitions, [
    {
      id: 'backlog',
      title: 'Backlog',
      allowedTransitionStageIds: ['review']
    },
    {
      id: 'review',
      title: 'Review',
      allowedTransitionStageIds: ['backlog']
    }
  ]);
  assert.deepEqual(parsedInput.templates, [
    {
      id: 'starter-template',
      title: 'Starter template',
      initialStageId: 'backlog'
    }
  ]);
});
