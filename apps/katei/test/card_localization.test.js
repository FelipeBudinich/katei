import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGeneratedCardLocalization,
  CardLocalizationGenerationConflictError,
  createCardContentProvenance,
  getCardContentVariant,
  getMissingRequiredLocales,
  listCardLocales,
  resolveDefaultCardLocale,
  upsertCardContentVariant
} from '../public/js/domain/card_localization.js';

test('resolveDefaultCardLocale applies explicit, ui-default, board, and first-available precedence in order', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es-CL',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en']
    }
  };

  assert.equal(
    resolveDefaultCardLocale({
      board,
      requestedLocale: 'es-CL',
      uiLocale: 'en',
      candidateLocales: ['en', 'es']
    }),
    'es'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      requestedLocale: 'ja',
      uiLocale: 'en',
      candidateLocales: ['en', 'es-CL', 'ja']
    }),
    'ja'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      requestedLocale: 'ja',
      uiLocale: 'en',
      candidateLocales: ['en', 'es-CL']
    }),
    'es-CL'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      uiLocale: 'es-CL',
      candidateLocales: ['en', 'es']
    }),
    'es'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      uiLocale: 'en',
      candidateLocales: ['en', 'es-CL', 'ja']
    }),
    'en'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      uiLocale: 'fr',
      candidateLocales: ['en', 'es-CL']
    }),
    'es-CL'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board: {
        languagePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'es-CL',
          supportedLocales: ['en', 'es-CL', 'ja'],
          requiredLocales: ['en']
        }
      },
      uiLocale: 'fr',
      candidateLocales: ['en']
    }),
    'en'
  );

  assert.equal(
    resolveDefaultCardLocale({
      board,
      uiLocale: 'fr',
      candidateLocales: ['ja']
    }),
    'ja'
  );
});

test('getCardContentVariant prefers an exact ui locale before board default when no explicit locale is requested', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es-CL',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en']
    }
  };

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_ui_locale',
        contentByLocale: {
          en: {
            title: 'English source',
            detailsMarkdown: 'English details',
            provenance: null
          },
          'es-CL': {
            title: 'Titulo por defecto',
            detailsMarkdown: 'Detalles por defecto',
            provenance: null
          }
        }
      },
      null,
      board,
      { uiLocale: 'en' }
    )?.locale,
    'en'
  );
});

test('getCardContentVariant falls back from a regional ui locale to same-language content before board default', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'es'],
      requiredLocales: ['en']
    }
  };

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_ui_language_fallback',
        contentByLocale: {
          en: {
            title: 'English source',
            detailsMarkdown: 'English details',
            provenance: null
          },
          es: {
            title: 'Titulo en español',
            detailsMarkdown: 'Detalles en español',
            provenance: null
          }
        }
      },
      null,
      board,
      { uiLocale: 'es-CL' }
    )?.locale,
    'es'
  );
});

test('getCardContentVariant resolves legacy jp content as ja and prefers canonical ja when both exist', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['en']
    }
  };

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_legacy_jp',
        contentByLocale: {
          en: {
            title: 'English source',
            detailsMarkdown: 'English details',
            provenance: null
          },
          jp: {
            title: '旧日本語タイトル',
            detailsMarkdown: '旧日本語本文',
            provenance: null
          }
        }
      },
      'ja',
      board
    )?.title,
    '旧日本語タイトル'
  );

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_both_jp_ja',
        contentByLocale: {
          jp: {
            title: '旧日本語タイトル',
            detailsMarkdown: '旧日本語本文',
            provenance: null
          },
          ja: {
            title: '正規の日本語タイトル',
            detailsMarkdown: '正規の日本語本文',
            provenance: null
          }
        }
      },
      'ja',
      board
    )?.title,
    '正規の日本語タイトル'
  );
});

test('getCardContentVariant reads explicit localized variants and listCardLocales canonicalizes keys', () => {
  const card = {
    id: 'card_1',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:30:00.000Z',
          includesHumanInput: true
        })
      },
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

  assert.deepEqual(listCardLocales(card), ['en', 'es-CL', 'ja']);
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

test('getCardContentVariant returns null when a card has not been normalized to localized content', () => {
  const card = {
    id: 'card_1',
    title: 'Legacy English title',
    detailsMarkdown: 'Legacy English details'
  };

  assert.equal(
    getCardContentVariant(card, 'en', {
      languagePolicy: {
        sourceLocale: 'en',
        defaultLocale: 'en'
      }
    }),
    null
  );
});

test('getCardContentVariant falls back from requested locale to default, then source, then first available locale', () => {
  const board = {
    languagePolicy: {
      sourceLocale: 'en',
      defaultLocale: 'es-CL',
      supportedLocales: ['en', 'es-CL', 'ja'],
      requiredLocales: ['en']
    }
  };

  assert.deepEqual(
    getCardContentVariant(
      {
        id: 'card_default',
        contentByLocale: {
          'es-CL': {
            title: 'Titulo por defecto',
            detailsMarkdown: 'Detalles por defecto',
            provenance: createCardContentProvenance({
              actor: { type: 'agent', id: 'translator_default' },
              timestamp: '2026-03-31T10:00:00.000Z',
              includesHumanInput: false
            })
          },
          en: {
            title: 'English source',
            detailsMarkdown: 'English details',
            provenance: createCardContentProvenance({
              actor: { type: 'human', id: 'viewer_123' },
              timestamp: '2026-03-31T09:00:00.000Z',
              includesHumanInput: true
            })
          }
        }
      },
      'fr',
      board
    ),
    {
      locale: 'es-CL',
      title: 'Titulo por defecto',
      detailsMarkdown: 'Detalles por defecto',
      provenance: {
        actor: { type: 'agent', id: 'translator_default' },
        timestamp: '2026-03-31T10:00:00.000Z',
        includesHumanInput: false
      },
      isFallback: true,
      source: 'localized'
    }
  );

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_source',
        contentByLocale: {
          en: {
            title: 'English source',
            detailsMarkdown: 'English details',
            provenance: createCardContentProvenance({
              actor: { type: 'human', id: 'viewer_123' },
              timestamp: '2026-03-31T09:00:00.000Z',
              includesHumanInput: true
            })
          }
        }
      },
      'fr',
      board
    )?.locale,
    'en'
  );

  assert.equal(
    getCardContentVariant(
      {
        id: 'card_first',
        contentByLocale: {
          ja: {
            title: '日本語タイトル',
            detailsMarkdown: '日本語本文',
            provenance: createCardContentProvenance({
              actor: { type: 'human', id: 'viewer_123' },
              timestamp: '2026-03-31T11:00:00.000Z',
              includesHumanInput: true
            })
          }
        }
      },
      'fr',
      board
    )?.locale,
    'ja'
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

test('applyGeneratedCardLocalization stores automated provenance and clears an open locale request', () => {
  const card = {
    id: 'card_1',
    localeRequests: {
      ja: {
        locale: 'ja',
        status: 'open',
        requestedBy: {
          type: 'human',
          id: 'viewer_123'
        },
        requestedAt: '2026-03-31T09:45:00.000Z'
      }
    },
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:30:00.000Z',
          includesHumanInput: true
        })
      }
    }
  };

  const localizedCard = applyGeneratedCardLocalization(
    card,
    'ja',
    {
      title: '日本語タイトル',
      detailsMarkdown: '日本語本文'
    },
    {
      actor: { type: 'agent', id: 'openai-localizer' },
      timestamp: '2026-03-31T10:00:00.000Z'
    }
  );

  assert.deepEqual(localizedCard.contentByLocale.ja, {
    title: '日本語タイトル',
    detailsMarkdown: '日本語本文',
    provenance: {
      actor: { type: 'agent', id: 'openai-localizer' },
      timestamp: '2026-03-31T10:00:00.000Z',
      includesHumanInput: false
    }
  });
  assert.deepEqual(localizedCard.localeRequests, {});
});

test('applyGeneratedCardLocalization rejects overwriting human-authored localized content', () => {
  const card = {
    id: 'card_1',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:30:00.000Z',
          includesHumanInput: true
        })
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_999' },
          timestamp: '2026-03-31T10:00:00.000Z',
          includesHumanInput: true
        })
      }
    }
  };

  assert.throws(
    () => applyGeneratedCardLocalization(
      card,
      'ja',
      {
        title: '更新済みタイトル',
        detailsMarkdown: '更新済み本文'
      },
      {
        actor: { type: 'agent', id: 'openai-localizer' },
        timestamp: '2026-03-31T10:30:00.000Z'
      }
    ),
    (error) => {
      assert.equal(error instanceof CardLocalizationGenerationConflictError, true);
      assert.equal(error.code, 'LOCALIZATION_HUMAN_AUTHORED_CONFLICT');
      return true;
    }
  );
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
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details',
        provenance: createCardContentProvenance({
          actor: { type: 'human', id: 'viewer_123' },
          timestamp: '2026-03-31T09:30:00.000Z',
          includesHumanInput: true
        })
      },
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
