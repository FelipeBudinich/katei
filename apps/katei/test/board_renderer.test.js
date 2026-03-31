import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceBoard } from '../public/js/domain/workspace_read_model.js';
import { getBoardRenderStages, getCardRenderState } from '../public/js/renderers/board_renderer.js';

test('getBoardRenderStages follows board.stageOrder instead of fixed column order', () => {
  const board = createWorkspaceBoard({
    id: 'board_custom',
    title: 'Custom board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });

  board.stageOrder = ['review', 'writing', 'published'];
  board.stages = {
    review: {
      id: 'review',
      title: 'Ready for Review',
      cardIds: [],
      allowedTransitionStageIds: ['writing', 'published'],
      templateIds: [],
      actionIds: []
    },
    writing: {
      id: 'writing',
      title: 'Writing',
      cardIds: [],
      allowedTransitionStageIds: ['review', 'published'],
      templateIds: [],
      actionIds: []
    },
    published: {
      id: 'published',
      title: 'Published',
      cardIds: [],
      allowedTransitionStageIds: ['review'],
      templateIds: [],
      actionIds: []
    }
  };

  assert.deepEqual(
    getBoardRenderStages(board).map(({ stageId, stage }) => [stageId, stage.title]),
    [
      ['review', 'Ready for Review'],
      ['writing', 'Writing'],
      ['published', 'Published']
    ]
  );
});

test('getCardRenderState resolves localized title and preview text from the board locale policy', () => {
  const board = createWorkspaceBoard({
    id: 'board_localized',
    title: 'Localized board',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:00:00.000Z'
  });
  const card = {
    id: 'card_localized',
    priority: 'important',
    createdAt: '2026-03-31T10:00:00.000Z',
    updatedAt: '2026-03-31T10:30:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details'
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '## 日本語本文'
      }
    }
  };

  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const renderState = withMarkdownEnvironment(() => getCardRenderState(board, card));

  assert.deepEqual(renderState, {
    title: '日本語タイトル',
    previewText: '日本語本文'
  });
});

function withMarkdownEnvironment(action) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  globalThis.window = {
    marked: {
      parse(markdown) {
        return String(markdown ?? '')
          .replace(/^#{1,6}\s+/gm, '')
          .replace(/\*\*(.*?)\*\*/g, '$1');
      }
    },
    DOMPurify: {
      sanitize(value) {
        return String(value ?? '');
      }
    }
  };
  globalThis.document = {
    createElement() {
      let textContent = '';

      return {
        set innerHTML(value) {
          textContent = String(value ?? '').replace(/<[^>]*>/g, ' ');
        },
        get textContent() {
          return textContent;
        }
      };
    }
  };

  try {
    return action();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}
