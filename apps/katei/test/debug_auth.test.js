import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { KATEI_SESSION_COOKIE_NAME } from '../src/auth/session_cookie.js';
import { createCard } from '../public/js/domain/workspace.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord
} from '../src/workspaces/workspace_record.js';

function createTestApp({ env = {} } = {}) {
  const viewerSub = normalizeOptionalString(env.KATEI_DEBUG_AUTH_VIEWER_SUB) || 'debug_sub';

  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: 'katei_test',
      ...env
    },
    googleTokenVerifier: async () => ({ sub: 'google_sub_unused' }),
    workspaceRecordRepository: createWorkspaceRecordRepositoryDouble({ viewerSub })
  });
}

test('POST /__debug/login returns 404 when hosted debug auth is disabled', async () => {
  const app = createTestApp();

  const response = await request(app)
    .post('/__debug/login')
    .set('x-katei-debug-auth', 'debug-secret');

  assert.equal(response.status, 404);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(findSetCookie(response, KATEI_SESSION_COOKIE_NAME), null);
});

test('POST /__debug/login returns 403 when the hosted debug auth secret is invalid', async () => {
  const app = createTestApp({
    env: {
      KATEI_DEBUG_AUTH_ENABLED: 'true',
      KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
      KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub'
    }
  });

  const response = await request(app)
    .post('/__debug/login')
    .set('x-katei-debug-auth', 'wrong-secret');

  assert.equal(response.status, 403);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(findSetCookie(response, KATEI_SESSION_COOKIE_NAME), null);
});

test('POST /__debug/login returns a normal Katei session cookie and viewer payload when allowed', async () => {
  const app = createTestApp({
    env: {
      KATEI_DEBUG_AUTH_ENABLED: 'true',
      KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
      KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub',
      KATEI_DEBUG_AUTH_VIEWER_EMAIL: 'debug@example.com',
      KATEI_DEBUG_AUTH_VIEWER_NAME: 'Debug User'
    }
  });

  const response = await request(app)
    .post('/__debug/login')
    .set('x-katei-debug-auth', 'debug-secret');

  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/boards',
    viewer: {
      sub: 'debug_sub',
      email: 'debug@example.com',
      name: 'Debug User'
    }
  });
  assert.match(findSetCookie(response, KATEI_SESSION_COOKIE_NAME) ?? '', /katei_session=/);
});

test('a debug login session cookie can reach the authenticated boards UI', async () => {
  const app = createTestApp({
    env: {
      KATEI_DEBUG_AUTH_ENABLED: 'true',
      KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
      KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub',
      KATEI_DEBUG_AUTH_VIEWER_EMAIL: 'debug@example.com',
      KATEI_DEBUG_AUTH_VIEWER_NAME: 'Debug User'
    }
  });

  const loginResponse = await request(app)
    .post('/__debug/login')
    .set('x-katei-debug-auth', 'debug-secret');
  const sessionCookie = findSetCookie(loginResponse, KATEI_SESSION_COOKIE_NAME);
  const boardsResponse = await request(app)
    .get('/boards')
    .set('Cookie', sessionCookie);

  assert.equal(boardsResponse.status, 200);
  assert.match(boardsResponse.text, /data-workspace-viewer-sub-value="debug_sub"/);
  assert.match(boardsResponse.text, /Debug board/);
  assert.match(boardsResponse.text, /Smoke test card/);
});

function createWorkspaceRecordRepositoryDouble({ viewerSub = 'debug_sub' } = {}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId: createHomeWorkspaceId(viewerSub),
    now: '2026-04-02T10:00:00.000Z'
  });
  let workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = 'Debug board';
  workspace = createCard(workspace, 'main', {
    title: 'Smoke test card',
    detailsMarkdown: 'Authenticated debug fixture'
  });

  const record = createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: '2026-04-02T11:00:00.000Z'
  });

  return {
    async loadOrCreateWorkspaceRecord() {
      return structuredClone(record);
    },

    async loadOrCreateAuthoritativeWorkspaceRecord() {
      return structuredClone(record);
    },

    async listPendingWorkspaceInvitesForViewer() {
      return [];
    },

    async listAccessibleWorkspacesForViewer() {
      return [];
    }
  };
}

function findSetCookie(response, name) {
  const setCookieHeaders = response.headers['set-cookie'];

  if (!Array.isArray(setCookieHeaders)) {
    return null;
  }

  return setCookieHeaders.find((value) => typeof value === 'string' && value.startsWith(`${name}=`)) ?? null;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
