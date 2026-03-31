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

test('parseBoardEditorFormInput rejects source-locale changes that existing cards cannot satisfy', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  board.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: '',
        provenance: null
      }
    }
  };
  board.stages.backlog.cardIds.push('card_1');

  assert.throws(
    () =>
      parseBoardEditorFormInput(
        {
          title: 'Editorial board',
          sourceLocale: 'ja',
          defaultLocale: 'ja',
          supportedLocales: 'en, ja',
          requiredLocales: 'ja',
          stageDefinitions: ['backlog | Backlog | doing', 'doing | Doing | backlog'].join('\n'),
          templates: ''
        },
        {
          currentBoard: board
        }
      ),
    /Existing cards do not contain the new source locale/
  );
});

test('parseBoardEditorFormInput generates unique template ids when repeated titles omit ids', () => {
  const parsedInput = parseBoardEditorFormInput({
    title: 'Editorial board',
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: 'en',
    requiredLocales: 'en',
    stageDefinitions: ['backlog | Backlog | review', 'review | Review | backlog'].join('\n'),
    templates: ['Starter template | backlog', 'Starter template | review'].join('\n')
  });

  assert.deepEqual(parsedInput.templates, [
    {
      id: 'starter-template',
      title: 'Starter template',
      initialStageId: 'backlog'
    },
    {
      id: 'starter-template-2',
      title: 'Starter template',
      initialStageId: 'review'
    }
  ]);
});
