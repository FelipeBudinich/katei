import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBoardLocalizationGlossary,
  validateBoardLocalizationGlossary
} from '../public/js/domain/board_localization_glossary.js';

test('normalizeBoardLocalizationGlossary canonicalizes supported locale translations', () => {
  const glossary = normalizeBoardLocalizationGlossary(
    [
      {
        source: 'Omen of Sorrow',
        translations: {
          es_cl: 'Omen of Sorrow'
        }
      }
    ],
    {
      supportedLocales: ['en', 'es-CL']
    }
  );

  assert.deepEqual(glossary, [
    {
      source: 'Omen of Sorrow',
      translations: {
        'es-CL': 'Omen of Sorrow'
      }
    }
  ]);
});

test('normalizeBoardLocalizationGlossary rejects duplicate source terms', () => {
  assert.throws(
    () =>
      normalizeBoardLocalizationGlossary(
        [
          {
            source: 'Omen of Sorrow',
            translations: {
              es: 'Omen of Sorrow'
            }
          },
          {
            source: 'omen of sorrow',
            translations: {
              es: 'Omen of Sorrow'
            }
          }
        ],
        {
          supportedLocales: ['en', 'es']
        }
      ),
    /Localization glossary source terms must be unique/
  );
});

test('validateBoardLocalizationGlossary rejects translations for unsupported locales', () => {
  assert.equal(
    validateBoardLocalizationGlossary(
      [
        {
          source: 'Omen of Sorrow',
          translations: {
            ja: 'Omen of Sorrow'
          }
        }
      ],
      {
        supportedLocales: ['en', 'es']
      }
    ),
    false
  );
});
