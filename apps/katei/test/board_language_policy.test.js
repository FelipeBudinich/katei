import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeContentLocale,
  canonicalizeContentLocaleWithLegacyAliases,
  createDefaultBoardLanguagePolicy,
  normalizeBoardLanguagePolicy,
  validateBoardLanguagePolicy
} from '../public/js/domain/board_language_policy.js';

test('canonicalizeContentLocale normalizes content locales deterministically', () => {
  assert.equal(canonicalizeContentLocale(' es_cl '), 'es-CL');
  assert.equal(canonicalizeContentLocale('JA'), 'ja');
  assert.equal(canonicalizeContentLocale('not a locale'), null);
  assert.equal(canonicalizeContentLocale('*'), null);
  assert.equal(canonicalizeContentLocale('jp'), 'jp');
  assert.equal(canonicalizeContentLocaleWithLegacyAliases('jp'), 'ja');
});

test('validateBoardLanguagePolicy accepts canonicalizable language policies', () => {
  const policy = {
    sourceLocale: 'en',
    defaultLocale: 'es_cl',
    supportedLocales: ['ja', 'es_cl', 'en'],
    requiredLocales: ['es-CL', 'ja']
  };

  assert.equal(validateBoardLanguagePolicy(policy), true);
  assert.deepEqual(normalizeBoardLanguagePolicy(policy), {
    sourceLocale: 'en',
    defaultLocale: 'es-CL',
    supportedLocales: ['ja', 'es-CL', 'en'],
    requiredLocales: ['es-CL', 'ja']
  });

  assert.deepEqual(
    normalizeBoardLanguagePolicy({
      sourceLocale: 'jp',
      defaultLocale: 'jp',
      supportedLocales: ['en', 'jp', 'ja'],
      requiredLocales: ['jp']
    }),
    {
      sourceLocale: 'ja',
      defaultLocale: 'ja',
      supportedLocales: ['en', 'ja'],
      requiredLocales: ['ja']
    }
  );
});

test('createDefaultBoardLanguagePolicy returns a fresh default object', () => {
  const firstPolicy = createDefaultBoardLanguagePolicy();
  const secondPolicy = createDefaultBoardLanguagePolicy();

  firstPolicy.requiredLocales.push('ja');

  assert.deepEqual(secondPolicy, {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en'],
    requiredLocales: ['en']
  });
});

test('validateBoardLanguagePolicy rejects invalid language policies', () => {
  assert.equal(validateBoardLanguagePolicy(null), false);

  assert.equal(
    validateBoardLanguagePolicy({
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['ja']
    }),
    false
  );

  assert.equal(
    validateBoardLanguagePolicy({
      sourceLocale: 'en',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      requiredLocales: ['not a locale']
    }),
    false
  );
});
