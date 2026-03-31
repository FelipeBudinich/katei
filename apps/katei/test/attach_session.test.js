import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttachSessionMiddleware } from '../src/middleware/attach_session.js';
import {
  createSessionPayload,
  createSignedSessionCookieValue,
  KATEI_SESSION_COOKIE_NAME
} from '../src/auth/session_cookie.js';

const config = {
  sessionSecret: 'test-session-secret',
  sessionTtlSeconds: 300,
  isProduction: false
};

test('createAttachSessionMiddleware attaches the session viewer including verified email metadata', () => {
  const now = new Date();
  const payload = createSessionPayload(
    {
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester',
      picture: 'https://example.com/avatar.png'
    },
    config.sessionTtlSeconds,
    now
  );
  const request = {
    cookies: {
      [KATEI_SESSION_COOKIE_NAME]: createSignedSessionCookieValue(payload, config.sessionSecret)
    }
  };
  const response = createResponseDouble();
  let nextCallCount = 0;

  createAttachSessionMiddleware(config)(request, response, () => {
    nextCallCount += 1;
  });

  assert.deepEqual(request.kateiSession, payload);
  assert.deepEqual(request.viewer, {
    sub: 'sub_123',
    email: 'tester@example.com',
    name: 'Tester',
    picture: 'https://example.com/avatar.png'
  });
  assert.deepEqual(response.locals.viewer, request.viewer);
  assert.equal(response.clearCookieCalls.length, 0);
  assert.equal(nextCallCount, 1);
});

test('createAttachSessionMiddleware clears invalid cookies and leaves viewer null', () => {
  const request = {
    cookies: {
      [KATEI_SESSION_COOKIE_NAME]: 'invalid.cookie'
    }
  };
  const response = createResponseDouble();

  createAttachSessionMiddleware(config)(request, response, () => {});

  assert.equal(request.kateiSession, null);
  assert.equal(request.viewer, null);
  assert.equal(response.locals.viewer, null);
  assert.equal(response.clearCookieCalls.length, 1);
  assert.equal(response.clearCookieCalls[0].name, KATEI_SESSION_COOKIE_NAME);
});

function createResponseDouble() {
  return {
    locals: {},
    clearCookieCalls: [],
    clearCookie(name, options) {
      this.clearCookieCalls.push({ name, options });
    }
  };
}
