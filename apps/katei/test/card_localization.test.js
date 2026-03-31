import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardContentProvenance,
  getCardContentVariant,
  getMissingRequiredLocales,
  listCardLocales,
  upsertCardContentVariant
} from '../public/js/domain/card_localization.js';

test('getCardContentVariant reads explicit localized variants and listCardLocales canonicalizes keys', () => {
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details',
    contentByLocale: {
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文',
        provenance: {
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: true
        }
      },
      es_cl: {
        title: 'Titulo en español',
        detailsMarkdown: 'Detalle en español',
        provenance: {
          actor: { type: 'agent', id: 'translator_1' },
          timestamp: '2026-03-31T11:00:00.000Z',
          includesHumanInput: false
        }
      }
    }
  };

  assert.deepEqual(listCardLocales(card), ['es-CL', 'ja']);
  assert.deepEqual(
    getCardContentVariant(card, 'ja', {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en'
      }
    }),
    {
      locale: 'ja',
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文',
      provenance: {
        actor: { type: 'human', id: 'viewer_123' },
        timestamp: '2026-03-31T10:00:00.000Z',
        includesHumanInput: true
      },
      isFallback: false,
      source: 'localized'
    }
  );
});

test('getCardContentVariant falls back to legacy card content when no localized variant exists', () => {
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details'
  };

  assert.deepEqual(
    getCardContentVariant(card, 'en', {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en'
      }
    }),
    {
      locale: 'en',
      title: 'Legacy English title',
      detailsMarkdown: 'Legacy English details',
      provenance: null,
      isFallback: true,
      source: 'legacy'
    }
  );
});

test('upsertCardContentVariant adds and updates localized variants without mutating the source card', () => {
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details'
  };
  const localizedCard = upsertCardContentVariant(
    card,
    'es_cl',
    {
      title: 'Titulo en español',
      detailsMarkdown: 'Detalle en español'
    },
    {
      actor: { type: 'human', id: 'viewer_123' },
      timestamp: '2026-03-31T12:00:00.000Z',
      includesHumanInput: true
    }
  );

  assert.equal(card.contentByLocale, undefined);
  assert.deepEqual(localizedCard.contentByLocale, {
    'es-CL': {
      title: 'Titulo en español',
      detailsMarkdown: 'Detalle en español',
      provenance: {
        actor: { type: 'human', id: 'viewer_123' },
        timestamp: '2026-03-31T12:00:00.000Z',
        includesHumanInput: true
      }
    }
  });

  const updatedCard = upsertCardContentVariant(
    localizedCard,
    'es-CL',
    {
      detailsMarkdown: 'Detalle actualizado'
    },
    {
      actor: { type: 'agent', id: 'translator_1' },
      timestamp: '2026-03-31T13:00:00.000Z',
      includesHumanInput: false
    }
  );

  assert.deepEqual(updatedCard.contentByLocale['es-CL'], {
    title: 'Titulo en español',
    detailsMarkdown: 'Detalle actualizado',
    provenance: {
      actor: { type: 'agent', id: 'translator_1' },
      timestamp: '2026-03-31T13:00:00.000Z',
      includesHumanInput: false
    }
  });
});

test('getMissingRequiredLocales detects only the required locales still missing', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja', 'es-CL'],
      requiredLocales: ['en', 'ja', 'es-CL']
    }
  };
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details',
    contentByLocale: {
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: true
        })
      }
    }
  };

  assert.deepEqual(getMissingRequiredLocales(board, card), ['es-CL']);
});
