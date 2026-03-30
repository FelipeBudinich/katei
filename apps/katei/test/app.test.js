import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  KATEI_SESSION_COOKIE_NAME,
  createSessionPayload,
  createSignedSessionCookieValue
} from '../src/auth/session_cookie.js';
import { createEmptyWorkspace } from '../public/js/domain/workspace.js';
import { KATEI_UI_LOCALE_COOKIE_NAME } from '../src/i18n/request_ui_locale.js';
import { createTranslator } from '../public/js/i18n/translate.js';
import { buildWorkspacePageModel } from '../src/routes/boards.js';

const WORKSPACE_VENDOR_ASSET_PATHS = [
  '/vendor/easymde/easymde.min.css',
  '/vendor/easymde/easymde.min.js',
  '/vendor/marked/marked.umd.js',
  '/vendor/dompurify/purify.min.js'
];

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
  assert.match(response.text, /<html lang="en" data-ui-locale="en">/);
  assert.match(response.text, /Private tester preview/);
  assert.match(response.text, /google-identity-script/);

  for (const assetPath of WORKSPACE_VENDOR_ASSET_PATHS) {
    assert.doesNotMatch(response.text, new RegExp(escapeForRegex(assetPath)));
  }

  assert.match(response.text, /id="landing-ui-locale-picker"/);
  assert.match(response.text, /<form method="get" action="\/" class="ui-locale-picker">/);
  assert.match(response.text, /<option value="en" selected>\s*English\s*<\/option>/);
  assert.match(response.text, /UI language/);
});

test('GET / localizes landing page chrome for es-CL', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/?lang=es-CL');

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="es-CL" data-ui-locale="es-CL">/);
  assert.match(response.text, /Vista previa privada para testers/);
  assert.match(response.text, /Entra a tus tableros/);
  assert.match(response.text, /Inicia sesión con Google/);
  assert.doesNotMatch(response.text, /Private tester preview/);
});

test('GET / uses Accept-Language when no query param or UI locale cookie is present', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .get('/')
    .set('Accept-Language', 'ja-JP, en-US;q=0.8');

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
});

test('GET /?lang=ja sets the document language and persists the UI locale cookie', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/?lang=ja');

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
  assert.match(findSetCookie(response, KATEI_UI_LOCALE_COOKIE_NAME) ?? '', /katei_ui_locale=ja/);
});

test('GET / can reuse a persisted supported UI locale cookie', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });
  const firstResponse = await request(app).get('/?lang=ja');
  const uiLocaleCookie = findSetCookie(firstResponse, KATEI_UI_LOCALE_COOKIE_NAME);
  const response = await request(app)
    .get('/')
    .set('Cookie', uiLocaleCookie);

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
  assert.match(response.text, /<option value="ja" selected>\s*日本語\s*<\/option>/);
});

test('GET / falls back safely when the requested UI locale is unsupported', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/?lang=fr-FR');

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="en" data-ui-locale="en">/);
  assert.equal(findSetCookie(response, KATEI_UI_LOCALE_COOKIE_NAME), null);
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

  for (const assetPath of WORKSPACE_VENDOR_ASSET_PATHS) {
    assert.match(response.text, new RegExp(escapeForRegex(assetPath)));
  }

  assert.match(response.text, /<link rel="stylesheet" href="\/vendor\/easymde\/easymde\.min\.css">/);
  assert.match(response.text, /<script defer src="\/vendor\/marked\/marked\.umd\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/dompurify\/purify\.min\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/easymde\/easymde\.min\.js"><\/script>/);
  assert.match(response.text, /id="board-options-ui-locale-picker"/);
  assert.match(response.text, /<form method="get" action="\/boards" class="ui-locale-picker">/);
});

test('GET /boards localizes server-rendered chrome for ja without changing user-authored viewer content', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .get('/boards?lang=ja')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
  assert.match(response.text, /サインイン済み/);
  assert.match(response.text, />\s*オプション\s*</);
  assert.match(response.text, />\s*カードを追加\s*</);
  assert.match(response.text, /data-workspace-target="boardTitle">過程</);
  assert.match(response.text, />Tester</);
  assert.match(response.text, />\s*バックログ\s*</);
  assert.match(response.text, /aria-label="0 件のカード"/);
  assert.doesNotMatch(response.text, />Backlog</);
  assert.match(response.text, /<option value="ja" selected>\s*日本語\s*<\/option>/);
  assert.match(response.text, /UI言語/);
});

test('buildWorkspacePageModel localizes fixed labels without rewriting user-authored workspace content', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards[workspace.ui.activeBoardId];
  const cardId = 'card_user_1';

  board.title = 'Roadmap alpha';
  board.cards[cardId] = {
    id: cardId,
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T11:00:00.000Z'
  };
  board.columns.backlog.cardIds = [cardId];

  const viewModel = buildWorkspacePageModel(
    { sub: 'sub_123', name: 'Tester' },
    createTranslator('ja'),
    workspace
  );

  assert.equal(viewModel.board.title, 'Roadmap alpha');
  assert.equal(viewModel.workspace.boards[board.id].columns.backlog.title, 'Backlog');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].title, 'Ship launch checklist');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].detailsMarkdown, 'Owner: Mina');
  assert.equal(viewModel.columnDefinitions.find((column) => column.id === 'backlog')?.title, 'バックログ');
  assert.equal(viewModel.priorityDefinitions.find((priority) => priority.id === 'urgent')?.label, '緊急');
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

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSetCookie(response, cookieName) {
  return response.headers['set-cookie']?.find((value) => value.startsWith(`${cookieName}=`)) ?? null;
}
