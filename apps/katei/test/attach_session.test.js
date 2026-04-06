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
  isProduction: false,
  superAdmins: new Set(['tester@example.com'])
};

test('createAttachSessionMiddleware attaches the session viewer and derives isSuperAdmin per request', () => {
  const now = new Date();
  const payload = createSessionPayload(
    {
      sub: 'sub_123',
      email: 'Tester@Example.com',
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
    email: 'Tester@Example.com',
    name: 'Tester',
    picture: 'https://example.com/avatar.png',
    isSuperAdmin: true
  });
  assert.deepEqual(response.locals.viewer, request.viewer);
  assert.equal(response.clearCookieCalls.length, 0);
  assert.equal(nextCallCount, 1);
});

test('createAttachSessionMiddleware keeps isSuperAdmin false when the viewer email is missing', () => {
  const now = new Date();
  const payload = createSessionPayload(
    {
      sub: 'sub_123',
      name: 'Tester'
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

  createAttachSessionMiddleware(config)(request, response, () => {});

  assert.deepEqual(request.viewer, {
    sub: 'sub_123',
    name: 'Tester',
    isSuperAdmin: false
  });
  assert.deepEqual(response.locals.viewer, request.viewer);
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

test('createAttachSessionMiddleware leaves anonymous requests without a viewer', () => {
  const request = { cookies: {} };
  const response = createResponseDouble();

  createAttachSessionMiddleware(config)(request, response, () => {});

  assert.equal(request.kateiSession, null);
  assert.equal(request.viewer, null);
  assert.equal(response.locals.viewer, null);
  assert.equal(response.clearCookieCalls.length, 0);
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
