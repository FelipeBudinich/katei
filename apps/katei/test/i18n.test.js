import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_UI_LOCALE,
  canonicalizeUiLocale,
  parseAcceptLanguage,
  resolveSupportedUiLocale
} from '../public/js/i18n/locales.js';
import { createTranslator } from '../public/js/i18n/translate.js';
import {
  KATEI_UI_LOCALE_COOKIE_NAME,
  resolveRequestUiLocale
} from '../src/i18n/request_ui_locale.js';

test('DEFAULT_UI_LOCALE is English', () => {
  assert.equal(DEFAULT_UI_LOCALE, 'en');
});

test('canonicalizeUiLocale normalizes locale input deterministically', () => {
  assert.equal(canonicalizeUiLocale(' es_cl '), 'es-CL');
  assert.equal(canonicalizeUiLocale('JA-jp'), 'ja-JP');
  assert.equal(canonicalizeUiLocale('*'), null);
  assert.equal(canonicalizeUiLocale('not a locale'), null);
});

test('resolveSupportedUiLocale maps exact and language-only inputs to supported UI locales', () => {
  assert.equal(resolveSupportedUiLocale('en-US'), 'en');
  assert.equal(resolveSupportedUiLocale('es'), 'es-CL');
  assert.equal(resolveSupportedUiLocale('ja-JP'), 'ja');
  assert.equal(resolveSupportedUiLocale('fr-FR'), null);
});

test('parseAcceptLanguage keeps canonical preference order and ignores unsupported noise', () => {
  assert.deepEqual(
    parseAcceptLanguage('es-MX;q=0.4, ja-JP, *;q=0.9, en-US;q=0.8'),
    ['ja-JP', 'en-US', 'es-MX']
  );
});

test('createTranslator resolves dot-path keys, interpolates values, and falls back to the key last', () => {
  const translate = createTranslator('ja-JP');

  assert.equal(translate.locale, 'ja');
  assert.equal(translate('common.close'), 'Close');
  assert.equal(translate('common.welcomeUser', { name: 'Mina' }), 'Welcome, Mina.');
  assert.equal(translate('common.missingKey'), 'common.missingKey');
});

test('resolveRequestUiLocale checks query, then cookie, then Accept-Language, then default English', () => {
  assert.equal(
    resolveRequestUiLocale({
      query: { lang: 'ja' },
      cookies: { [KATEI_UI_LOCALE_COOKIE_NAME]: 'es-CL' },
      headers: { 'accept-language': 'en-US;q=0.8' }
    }),
    'ja'
  );

  assert.equal(
    resolveRequestUiLocale({
      query: { lang: 'fr-FR' },
      cookies: { [KATEI_UI_LOCALE_COOKIE_NAME]: 'es-CL' },
      headers: { 'accept-language': 'ja-JP;q=0.8' }
    }),
    'es-CL'
  );

  assert.equal(
    resolveRequestUiLocale({
      cookies: {},
      headers: { 'accept-language': 'ja-JP, en-US;q=0.8' }
    }),
    'ja'
  );

  assert.equal(resolveRequestUiLocale({}), 'en');
});
