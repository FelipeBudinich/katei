import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachUiLocaleMiddleware } from '../src/middleware/attach_ui_locale.js';

const config = {
  isProduction: false
};

test('createAttachUiLocaleMiddleware builds picker options in each locale native language', () => {
  const request = {
    query: {
      lang: 'ja'
    },
    cookies: {},
    path: '/boards'
  };
  const response = createResponseDouble();
  let nextCallCount = 0;

  createAttachUiLocaleMiddleware(config)(request, response, () => {
    nextCallCount += 1;
  });

  assert.equal(request.uiLocale, 'ja');
  assert.deepEqual(response.locals.uiLocaleCurrent, {
    value: 'ja',
    label: '日本語',
    selected: true
  });
  assert.deepEqual(response.locals.uiLocaleOptions, [
    {
      value: 'en',
      label: 'English',
      selected: false
    },
    {
      value: 'es-CL',
      label: 'Español (Chile)',
      selected: false
    },
    {
      value: 'ja',
      label: '日本語',
      selected: true
    }
  ]);
  assert.deepEqual(response.cookieCalls, [
    {
      name: 'katei_ui_locale',
      value: 'ja',
      options: {
        httpOnly: false,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 365
      }
    }
  ]);
  assert.equal(nextCallCount, 1);
});

function createResponseDouble() {
  return {
    locals: {},
    cookieCalls: [],
    cookie(name, value, options) {
      this.cookieCalls.push({ name, value, options });
    }
  };
}
