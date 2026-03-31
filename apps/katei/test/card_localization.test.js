import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
        provenance: { source: 'human' }
      },
      es_cl: {
        title: 'Titulo en español',
        detailsMarkdown: 'Detalle en español'
      }
    }
  };

  assert.deepEqual(listCardLocales(card), ['es-CL', 'ja']);
  assert.deepEqual(
    getCardContentVariant(card, 'ja', {
      languagePolicy: {
        defaultLocale: 'en'
      }
    }),
    {
      locale: 'ja',
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文',
      provenance: { source: 'human' },
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
    { source: 'human' }
  );

  assert.equal(card.contentByLocale, undefined);
  assert.deepEqual(localizedCard.contentByLocale, {
    'es-CL': {
      title: 'Titulo en español',
      detailsMarkdown: 'Detalle en español',
      provenance: { source: 'human' }
    }
  });

  const updatedCard = upsertCardContentVariant(
    localizedCard,
    'es-CL',
    {
      detailsMarkdown: 'Detalle actualizado'
    },
    { source: 'agent' }
  );

  assert.deepEqual(updatedCard.contentByLocale['es-CL'], {
    title: 'Titulo en español',
    detailsMarkdown: 'Detalle actualizado',
    provenance: { source: 'agent' }
  });
});

test('getMissingRequiredLocales detects only the required locales still missing', () => {
  const board = {
    languagePolicy: {
      defaultLocale: 'en',
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
        detailsMarkdown: '日本語本文'
      }
    }
  };

  assert.deepEqual(getMissingRequiredLocales(board, card), ['es-CL']);
});
