import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  KATEI_SESSION_COOKIE_NAME,
  createSessionPayload,
  createSignedSessionCookieValue
} from '../src/auth/session_cookie.js';

function createTestApp({ env = {}, googleTokenVerifier } = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      ...env
    },
    googleTokenVerifier
  });
}

function createSessionCookieHeader(viewer, { ttlSeconds = 300, now = '2099-01-01T00:00:00Z' } = {}) {
  const payload = createSessionPayload(viewer, ttlSeconds, new Date(now));
  const value = createSignedSessionCookieValue(payload, 'test-session-secret');
  return `${KATEI_SESSION_COOKIE_NAME}=${value}`;
}

test('GET / renders the landing page for anonymous users', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/');

  assert.equal(response.status, 200);
  assert.match(response.text, /Private tester preview/);
  assert.match(response.text, /google-identity-script/);
  assert.doesNotMatch(response.text, /\/vendor\/easymde\/easymde\.min\.css/);
  assert.doesNotMatch(response.text, /\/vendor\/marked\/marked\.umd\.js/);
  assert.doesNotMatch(response.text, /\/vendor\/dompurify\/purify\.min\.js/);
  assert.doesNotMatch(response.text, /\/vendor\/easymde\/easymde\.min\.js/);
});

test('GET / redirects authenticated users to /boards', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .get('/')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/boards');
});

test('GET /boards redirects anonymous users to /', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/boards');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
});

test('GET /boards renders the workspace shell and viewer bootstrap for authenticated users', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));

  assert.equal(response.status, 200);
  assert.match(response.text, /data-workspace-viewer-sub-value="sub_123"/);
  assert.match(response.text, /Logout/);
  assert.match(response.text, /Tester/);
  assert.match(response.text, /data-card-field="preview"/);
  assert.match(response.text, /data-workspace-target="viewCardBody"/);
  assert.match(response.text, /markdown-rendered/);
  assert.match(response.text, /<link rel="stylesheet" href="\/vendor\/easymde\/easymde\.min\.css">/);
  assert.match(response.text, /<script defer src="\/vendor\/marked\/marked\.umd\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/dompurify\/purify\.min\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/easymde\/easymde\.min\.js"><\/script>/);
});

test('POST /auth/google returns 400 when the request body is invalid', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).post('/auth/google').send({});

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Google credential is required.'
  });
});

test('POST /auth/google returns 400 for malformed JSON bodies', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Content-Type', 'application/json')
    .send('{"credential":');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Invalid request body.'
  });
});

test('POST /auth/google returns 401 when the Google credential cannot be verified', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => {
      throw new Error('verification failed');
    }
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'invalid-token' });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Unable to verify the Google credential.'
  });
});

test('POST /auth/google returns 403 when the request origin does not match APP_BASE_URL', async () => {
  const app = createTestApp({
    env: {
      APP_BASE_URL: 'https://katei.example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Origin', 'https://evil.example.com')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Sign-in request origin is not allowed.'
  });
});

test('POST /auth/google returns 403 when the verified tester sub is not on the allowlist', async () => {
  const app = createTestApp({
    env: {
      GOOGLE_ALLOWLIST_SUBS: 'sub_allowed'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_denied' })
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'This Google account is not enabled for private testing.'
  });
});

test('POST /auth/google sets the Katei session cookie and returns /boards on success', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      name: 'Tester',
      picture: 'https://example.com/avatar.png'
    })
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/boards'
  });
  assert.match(response.headers['set-cookie'][0], /katei_session=/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
});

test('POST /auth/google allows any verified Google account when GOOGLE_ALLOWLIST_SUBS is blank', async () => {
  const app = createTestApp({
    env: {
      GOOGLE_ALLOWLIST_SUBS: '   '
    },
    googleTokenVerifier: async () => ({ sub: 'sub_any' })
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
});

test('POST /auth/logout clears the Katei session and returns /', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .post('/auth/logout')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123' }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/'
  });
  assert.match(response.headers['set-cookie'][0], /katei_session=;/);
});

test('GET /health still returns { ok: true }', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});
