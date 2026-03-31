import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';
import {
  assertBoardSchemaCompatibleWithBoard,
  normalizeBoardSchemaInput,
  serializeBoardSchemaInput
} from '../public/js/domain/board_schema.js';

test('normalizeBoardSchemaInput canonicalizes valid schema edits', () => {
  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es_cl',
      supportedLocales: ['es_cl', 'ja', 'en'],
      requiredLocales: ['ja']
    },
    stageDefinitions: [
      {
        id: 'backlog',
        title: 'Backlog',
        allowedTransitionStageIds: ['review']
      },
      {
        id: 'review',
        title: 'In Review',
        allowedTransitionStageIds: ['backlog']
      }
    ],
    templates: [
      {
        id: 'starter',
        title: 'Starter',
        initialStageId: 'backlog'
      }
    ]
  });

  assert.deepEqual(normalizedSchema.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'es-CL',
    supportedLocales: ['es-CL', 'ja', 'en'],
    requiredLocales: ['ja']
  });
  assert.deepEqual(normalizedSchema.stageOrder, ['backlog', 'review']);
  assert.deepEqual(normalizedSchema.stages.backlog.templateIds, ['starter']);
});

test('normalizeBoardSchemaInput rejects invalid locale policy, transitions, and template stages', () => {
  assert.throws(
    () =>
      normalizeBoardSchemaInput({
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'fr',
          supportedLocales: ['en'],
          requiredLocales: ['en']
        },
        stageDefinitions: [
          {
            id: 'backlog',
            title: 'Backlog',
            allowedTransitionStageIds: []
          }
        ],
        templates: []
      }),
    /Board language policy is invalid/
  );

  assert.throws(
    () =>
      normalizeBoardSchemaInput({
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en'],
          requiredLocales: ['en']
        },
        stageDefinitions: [
          {
            id: 'backlog',
            title: 'Backlog',
            allowedTransitionStageIds: ['review']
          }
        ],
        templates: []
      }),
    /Stage transitions must reference existing stages/
  );

  assert.throws(
    () =>
      normalizeBoardSchemaInput({
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en'],
          requiredLocales: ['en']
        },
        stageDefinitions: [
          {
            id: 'backlog',
            title: 'Backlog',
            allowedTransitionStageIds: []
          }
        ],
        templates: [
          {
            id: 'starter',
            title: 'Starter',
            initialStageId: 'review'
          }
        ]
      }),
    /Template initial stage must reference an existing stage/
  );
});

test('assertBoardSchemaCompatibleWithBoard rejects removing occupied stages or changing source locale without content', () => {
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
      assertBoardSchemaCompatibleWithBoard(
        board,
        normalizeBoardSchemaInput({
          ...serializeBoardSchemaInput(board),
          stageDefinitions: [
            {
              id: 'doing',
              title: 'Doing',
              allowedTransitionStageIds: []
            }
          ]
        })
      ),
    /Cannot remove a stage that still has cards/
  );

  assert.throws(
    () =>
      assertBoardSchemaCompatibleWithBoard(
        board,
        normalizeBoardSchemaInput({
          ...serializeBoardSchemaInput(board),
          languagePolicy: {
            sourceLocale: 'ja',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          }
        })
      ),
    /Existing cards do not contain the new source locale/
  );
});
