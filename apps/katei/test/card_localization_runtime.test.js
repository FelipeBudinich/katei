import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardContentProvenance,
  getBoardCardContentVariant
} from '../public/js/domain/card_localization.js';
import {
  createCard,
  updateCard
} from '../public/js/domain/workspace_mutations.js';
import { createEmptyWorkspace } from '../public/js/domain/workspace_read_model.js';

test('createCard writes source-locale content for new cards', () => {
  const workspace = createWorkspaceWithLanguagePolicy({
    sourceLocale: 'ja',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['ja']
  });
  const nextWorkspace = createCard(workspace, 'main', {
    title: '新しいカード',
    detailsMarkdown: '日本語の本文',
    priority: 'urgent'
  });
  const board = nextWorkspace.boards.main;
  const [cardId] = board.stages.backlog.cardIds;
  const card = board.cards[cardId];

  assert.deepEqual(Object.keys(card.contentByLocale), ['ja']);
  assert.deepEqual(card.localeRequests, {});
  assert.deepEqual(card.contentByLocale.ja, {
    title: '新しいカード',
    detailsMarkdown: '日本語の本文',
    provenance: {
      actor: {
        type: 'system',
        id: 'browser-mutation'
      },
      timestamp: card.updatedAt,
      includesHumanInput: true
    }
  });
});

test('updateCard updates only source-locale content and provenance', () => {
  const workspace = createWorkspaceWithLanguagePolicy({
    sourceLocale: 'ja',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['ja']
  });
  const board = workspace.boards.main;

  board.cards.card_1 = {
    id: 'card_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English title',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語の本文',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
      }
    }
  };
  board.stages.backlog.cardIds.push('card_1');

  const nextWorkspace = updateCard(workspace, 'main', 'card_1', {
    detailsMarkdown: '更新された本文'
  });
  const nextCard = nextWorkspace.boards.main.cards.card_1;

  assert.equal(nextCard.contentByLocale.en.detailsMarkdown, 'English details');
  assert.equal(nextCard.contentByLocale.ja.title, '日本語タイトル');
  assert.equal(nextCard.contentByLocale.ja.detailsMarkdown, '更新された本文');
  assert.deepEqual(nextCard.contentByLocale.ja.provenance, {
    actor: {
      type: 'system',
      id: 'browser-mutation'
    },
    timestamp: nextCard.updatedAt,
    includesHumanInput: true
  });
});

test('getBoardCardContentVariant resolves ui locale, then default, then source, then first available locale', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es-CL',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en']
    }
  };

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        es: {
          title: 'Titulo en español',
          detailsMarkdown: 'Detalles en español'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      {
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'es'],
          requiredLocales: ['en']
        }
      },
      { uiLocale: 'es-CL' }
    )?.locale,
    'es'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        es: {
          title: 'Titulo en español',
          detailsMarkdown: 'Detalles en español'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      {
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'es'],
          requiredLocales: ['en']
        }
      },
      {
        requestedLocale: 'es-CL',
        uiLocale: 'en'
      }
    )?.locale,
    'es'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        es: {
          title: 'Titulo general',
          detailsMarkdown: 'Detalles generales'
        },
        'es-CL': {
          title: 'Titulo chileno',
          detailsMarkdown: 'Detalles chilenos'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      {
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en', 'es', 'es-CL'],
          requiredLocales: ['en']
        }
      },
      { uiLocale: 'es-CL' }
    )?.locale,
    'es-CL'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        'es-CL': {
          title: 'Titulo por defecto',
          detailsMarkdown: 'Detalles por defecto'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      board,
      { uiLocale: 'en' }
    )?.locale,
    'en'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        'es-CL': {
          title: 'Titulo por defecto',
          detailsMarkdown: 'Detalles por defecto'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      board,
      {
        requestedLocale: 'ja',
        uiLocale: 'en'
      }
    )?.locale,
    'es-CL'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        'es-CL': {
          title: 'Titulo por defecto',
          detailsMarkdown: 'Detalles por defecto'
        },
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      board
    )?.locale,
    'es-CL'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        en: {
          title: 'English title',
          detailsMarkdown: 'English details'
        }
      }),
      board
    )?.locale,
    'en'
  );

  assert.equal(
    getBoardCardContentVariant(
      createCardWithContent({
        ja: {
          title: '日本語タイトル',
          detailsMarkdown: '日本語本文'
        }
      }),
      board
    )?.locale,
    'ja'
  );
});

test('getBoardCardContentVariant returns localized provenance from the effective runtime locale', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'ja',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['ja']
    }
  };
  const card = createCardWithContent({
    ja: {
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文',
      provenance: createCardContentProvenance({
        actor: { type: 'agent', id: 'translator_1' },
        timestamp: '2026-03-31T12:00:00.000Z',
        includesHumanInput: false
      })
    }
  });

  assert.deepEqual(getBoardCardContentVariant(card, board), {
    locale: 'ja',
    title: '日本語タイトル',
    detailsMarkdown: '日本語本文',
    provenance: {
      actor: { type: 'agent', id: 'translator_1' },
      timestamp: '2026-03-31T12:00:00.000Z',
      includesHumanInput: false
    },
    isFallback: true,
    source: 'localized'
  });
});

function createWorkspaceWithLanguagePolicy(languagePolicy) {
  const workspace = createEmptyWorkspace();
  workspace.boards.main.languagePolicy = structuredClone(languagePolicy);
  return workspace;
}

function createCardWithContent(contentByLocale) {
  const card = {
    id: 'card_runtime_1',
    priority: 'important',
    createdAt: '2026-03-31T09:00:00.000Z',
    updatedAt: '2026-03-31T09:00:00.000Z',
    contentByLocale: {}
  };

  for (const [locale, variant] of Object.entries(contentByLocale)) {
    card.contentByLocale[locale] = {
      title: variant.title,
      detailsMarkdown: variant.detailsMarkdown,
      provenance:
        variant.provenance ??
        createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:00:00.000Z',
          includesHumanInput: true
        })
    };
  }

  return card;
}
