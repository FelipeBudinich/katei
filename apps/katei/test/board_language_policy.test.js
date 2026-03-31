import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeContentLocale,
  createDefaultBoardLanguagePolicy,
  normalizeBoardLanguagePolicy,
  validateBoardLanguagePolicy
} from '../public/js/domain/board_language_policy.js';

test('canonicalizeContentLocale normalizes content locales deterministically', () => {
  assert.equal(canonicalizeContentLocale(' es_cl '), 'es-CL');
  assert.equal(canonicalizeContentLocale('JA'), 'ja');
  assert.equal(canonicalizeContentLocale('not a locale'), null);
  assert.equal(canonicalizeContentLocale('*'), null);
});

test('validateBoardLanguagePolicy accepts canonicalizable language policies', () => {
  const policy = {
    defaultLocale: 'es_cl',
    requiredLocales: ['es-CL', 'ja'],
    allowedLocales: ['ja', 'es_cl', 'en']
  };

  assert.equal(validateBoardLanguagePolicy(policy), true);
  assert.deepEqual(normalizeBoardLanguagePolicy(policy), {
    defaultLocale: 'es-CL',
    requiredLocales: ['es-CL', 'ja'],
    allowedLocales: ['ja', 'es-CL', 'en']
  });
});

test('createDefaultBoardLanguagePolicy returns a fresh default object', () => {
  const firstPolicy = createDefaultBoardLanguagePolicy();
  const secondPolicy = createDefaultBoardLanguagePolicy();

  firstPolicy.requiredLocales.push('ja');

  assert.deepEqual(secondPolicy, {
    defaultLocale: null,
    requiredLocales: [],
    allowedLocales: null
  });
});

test('validateBoardLanguagePolicy rejects invalid language policies', () => {
  assert.equal(
    validateBoardLanguagePolicy({
      defaultLocale: 'en',
      allowedLocales: ['ja']
    }),
    false
  );

  assert.equal(
    validateBoardLanguagePolicy({
      requiredLocales: ['ja', 'JA']
    }),
    false
  );

  assert.equal(
    validateBoardLanguagePolicy({
      requiredLocales: ['not a locale']
    }),
    false
  );
});
