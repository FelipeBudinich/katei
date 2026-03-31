import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  KATEI_SESSION_COOKIE_NAME,
  createSessionPayload,
  createSignedSessionCookieValue
} from '../src/auth/session_cookie.js';
import {
  createCard,
  createEmptyWorkspace,
  migrateWorkspaceSnapshot,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';
import { KATEI_UI_LOCALE_COOKIE_NAME } from '../src/i18n/request_ui_locale.js';
import { createTranslator } from '../public/js/i18n/translate.js';
import { buildWorkspacePageModel } from '../src/routes/boards.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  createWorkspaceRecord
} from '../src/workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../src/workspaces/workspace_record_repository.js';
import { canViewerAccessWorkspace, filterWorkspaceForViewer } from '../src/workspaces/workspace_access.js';

const WORKSPACE_VENDOR_ASSET_PATHS = [
  '/vendor/easymde/easymde.min.css',
  '/vendor/easymde/easymde.min.js',
  '/vendor/marked/marked.umd.js',
  '/vendor/dompurify/purify.min.js'
];

function createTestApp({ env = {}, googleTokenVerifier, workspaceRecordRepository } = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      ...env
    },
    googleTokenVerifier,
    workspaceRecordRepository: workspaceRecordRepository ?? createWorkspaceRecordRepositoryDouble()
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

test('GET /boards renders the server workspace and bootstrap payload for authenticated users', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina </script><img src=x onerror=1>',
    priority: 'urgent'
  });
  workspace.boards.main.title = 'Roadmap alpha';
  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { id: 'sub_123' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  const normalizedWorkspace = structuredClone(record.workspace);
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([record]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /data-workspace-viewer-sub-value="sub_123"/);
  assert.match(response.text, /Logout/);
  assert.match(response.text, /Tester/);
  assert.match(response.text, /Roadmap alpha/);
  assert.match(response.text, /Ship launch checklist/);
  assert.match(response.text, /Owner: Mina/);
  assert.match(response.text, /data-card-field="preview"/);
  assert.match(response.text, /data-workspace-target="viewCardBody"/);
  assert.match(response.text, /markdown-rendered/);
  assert.match(response.text, /<script type="application\/json" id="workspace-bootstrap">/);
  assert.doesNotMatch(response.text, /<\/script><img src=x onerror=1>/);
  assert.deepEqual(bootstrapPayload, {
    workspace: normalizedWorkspace,
    activeWorkspace: {
      workspaceId: record.workspaceId,
      isHomeWorkspace: true
    },
    meta: {
      revision: 1,
      updatedAt: '2026-04-02T11:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: record.workspaceId,
      isHomeWorkspace: true
    }
  });
  assert.equal(bootstrapPayload.workspace.boards.main.title, 'Roadmap alpha');
  assert.equal(
    bootstrapPayload.workspace.boards.main.cards[Object.keys(bootstrapPayload.workspace.boards.main.cards)[0]].contentByLocale
      .en.title,
    'Ship launch checklist'
  );
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      workspaceId: null
    }
  ]);

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

test('GET /boards bootstraps normalized workspace snapshots when the loaded record is legacy-shaped', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    createLegacyWorkspaceRecord({
      workspace: createLegacyWorkspaceSnapshot({
        version: 5,
        title: 'Legacy bootstrap task',
        detailsMarkdown: 'Rendered from an older snapshot',
        priority: 'important'
      })
    })
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /Legacy bootstrap task/);
  assert.equal(validateWorkspaceShape(bootstrapPayload.workspace), true);
  assert.equal(bootstrapPayload.workspace.boards.main.columnOrder, undefined);
  assert.equal(bootstrapPayload.workspace.boards.main.columns, undefined);
  assert.equal(bootstrapPayload.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(
    bootstrapPayload.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title,
    'Legacy bootstrap task'
  );
});

test('GET /boards loads an accessible shared workspace by workspaceId and rejects inaccessible ones', async () => {
  const sharedWorkspace = createCard(createEmptyWorkspace({ workspaceId: 'workspace_shared_1' }), 'main', {
    title: 'Shared roadmap',
    detailsMarkdown: 'Visible to collaborators',
    priority: 'important'
  });
  sharedWorkspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_collab' },
      role: 'editor'
    }
  ];
  const sharedRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner', {
      workspaceId: 'workspace_shared_1',
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace: sharedWorkspace,
      actor: { id: 'sub_owner' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  sharedRecord.isHomeWorkspace = false;
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_collab' }),
    workspaceRecordRepository
  });

  const accessibleResponse = await request(app)
    .get('/boards?workspaceId=workspace_shared_1')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_collab' }));
  const accessibleBootstrap = readWorkspaceBootstrapPayload(accessibleResponse.text);

  assert.equal(accessibleResponse.status, 200);
  assert.equal(accessibleBootstrap.activeWorkspace.workspaceId, 'workspace_shared_1');
  assert.deepEqual(workspaceRecordRepository.loadCalls[0], {
    viewerSub: 'sub_collab',
    viewerEmail: null,
    workspaceId: 'workspace_shared_1'
  });

  const inaccessibleResponse = await request(app)
    .get('/boards?workspaceId=workspace_shared_1')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_blocked' }));

  assert.equal(inaccessibleResponse.status, 404);
  assert.match(inaccessibleResponse.text, /Workspace not found\./);
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
  assert.match(response.text, />\s*Backlog\s*</);
  assert.match(response.text, /aria-label="0 件のカード"/);
  assert.match(response.text, /<option value="ja" selected>\s*日本語\s*<\/option>/);
  assert.match(response.text, /UI言語/);
});

test('GET /api/workspace returns 401 when the viewer is not authenticated', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository: createWorkspaceRecordRepositoryDouble()
  });

  const response = await request(app).get('/api/workspace');

  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Authentication required.'
  });
});

test('GET /api/workspace returns the authenticated viewer workspace JSON', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.deepEqual(response.body.activeWorkspace, {
    workspaceId: createHomeWorkspaceId('sub_123'),
    isHomeWorkspace: true
  });
  assert.deepEqual(response.body.meta, {
    revision: 0,
    updatedAt: '2026-04-02T10:00:00.000Z',
    lastChangedBy: null,
    isPristine: true
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      workspaceId: null
    }
  ]);
});

test('GET /api/workspace normalizes older persisted snapshots before returning them', async () => {
  const legacyWorkspace = createLegacyWorkspaceSnapshot({
    version: 5,
    title: 'Legacy server task',
    detailsMarkdown: 'Loaded from an older record',
    priority: 'urgent'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    createLegacyWorkspaceRecord({
      workspace: legacyWorkspace
    })
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.deepEqual(response.body.activeWorkspace, {
    workspaceId: createHomeWorkspaceId('sub_123'),
    isHomeWorkspace: true
  });
  assert.equal(response.body.workspace.boards.main.columnOrder, undefined);
  assert.equal(response.body.workspace.boards.main.columns, undefined);
  assert.equal(response.body.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(
    response.body.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title,
    'Legacy server task'
  );
  assert.deepEqual(response.body.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(response.body.workspace.access, {
    kind: 'private'
  });
  assert.equal(response.body.workspace.boards.main.collaboration.memberships.length, 1);
  assert.equal(response.body.workspace.boards.main.collaboration.memberships[0].actor.id, 'sub_123');
  assert.equal(response.body.workspace.boards.main.collaboration.memberships[0].role, 'admin');
  assert.deepEqual(response.body.workspace.boards.main.cards.card_legacy_1.localeRequests, {});
});

test('PUT /api/workspace rejects invalid workspace shapes for authenticated viewers', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .put('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({
      workspace: {
        version: -1
      }
    });

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Cannot save an invalid workspace.'
  });
  assert.equal(workspaceRecordRepository.replaceCalls.length, 0);
});

test('PUT /api/workspace saves a valid full-workspace snapshot for the authenticated viewer', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina',
    priority: 'urgent'
  });
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);

  const response = await request(app)
    .put('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({ workspace, expectedRevision: 0 });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.equal(
    response.body.workspace.boards.main.cards[Object.keys(response.body.workspace.boards.main.cards)[0]].contentByLocale
      .en.title,
    'Ship launch checklist'
  );
  assert.deepEqual(response.body.meta, {
    revision: 1,
    updatedAt: '2026-04-02T11:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.deepEqual(workspaceRecordRepository.replaceCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      workspaceId: null,
      workspace: normalizedWorkspace,
      expectedRevision: 0,
      actor: {
        type: 'human',
        id: 'sub_123'
      }
    }
  ]);
});

test('PUT /api/workspace returns 409 when expectedRevision is stale', async () => {
  const existingWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Server task',
    detailsMarkdown: 'Already persisted',
    priority: 'urgent'
  });
  const existingRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace: existingWorkspace,
      actor: { type: 'human', id: 'sub_123' },
      now: '2026-04-02T11:00:00.000Z',
      createActivityEventId: () => 'activity_saved_existing'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([existingRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .put('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({
      workspace: existingWorkspace,
      expectedRevision: 0
    });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'This workspace changed elsewhere. Refresh to continue.'
  });
});

test('POST /api/workspace/commands applies a valid runtime command for the authenticated viewer', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({
      command: {
        clientMutationId: 'm1',
        type: 'board.create',
        payload: {
          title: 'Roadmap'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.match(response.body.result.boardId, /^board_[a-f0-9]{12}$/);
  assert.equal(response.body.workspace.boardOrder.includes(response.body.result.boardId), true);
  assert.equal(response.body.result.clientMutationId, 'm1');
  assert.equal(response.body.result.type, 'board.create');
  assert.equal(response.body.result.noOp, false);
  assert.equal(response.body.meta.revision, 1);
  assert.match(response.body.meta.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.body.meta.lastChangedBy, 'sub_123');
  assert.equal(response.body.meta.isPristine, false);
  assert.equal(response.body.workspace.boards[response.body.result.boardId].createdAt, response.body.meta.updatedAt);
  assert.equal(response.body.workspace.boards[response.body.result.boardId].updatedAt, response.body.meta.updatedAt);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.equal(workspaceRecordRepository.replaceRecordCalls[0].expectedRevision, 0);
  assert.equal(workspaceRecordRepository.replaceRecordCalls[0].record.commandReceipts.length, 1);
  assert.equal(workspaceRecordRepository.replaceRecordCalls[0].record.commandReceipts[0].clientMutationId, 'm1');
});

test('POST /api/workspace/commands routes mutations by workspaceId for accessible shared workspaces', async () => {
  const sharedWorkspace = createEmptyWorkspace({ workspaceId: 'workspace_shared_2' });
  sharedWorkspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: 'sub_collab' },
      role: 'admin'
    }
  ];
  const sharedRecord = createInitialWorkspaceRecord('sub_owner', {
    workspaceId: 'workspace_shared_2',
    now: '2026-04-02T10:00:00.000Z'
  });
  sharedRecord.isHomeWorkspace = false;
  sharedRecord.workspace = sharedWorkspace;
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_collab' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_collab' }))
    .send({
      workspaceId: 'workspace_shared_2',
      command: {
        clientMutationId: 'shared_m1',
        type: 'board.rename',
        payload: {
          boardId: 'main',
          title: 'Shared board renamed'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.activeWorkspace.workspaceId, 'workspace_shared_2');
  assert.equal(response.body.workspace.boards.main.title, 'Shared board renamed');
  assert.equal(workspaceRecordRepository.replaceRecordCalls[0].record.workspaceId, 'workspace_shared_2');
});

test('POST /api/workspace/commands returns 403 for unauthorized collaboration commands', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared_permissions',
    creator: { type: 'human', id: 'sub_owner' }
  });
  sharedWorkspace.boards.main.collaboration.memberships.push({
    actor: { type: 'human', id: 'sub_editor' },
    role: 'editor'
  });
  const sharedRecord = createInitialWorkspaceRecord('sub_owner', {
    workspaceId: 'workspace_shared_permissions',
    now: '2026-04-02T10:00:00.000Z'
  });
  sharedRecord.isHomeWorkspace = false;
  sharedRecord.workspace = sharedWorkspace;
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_editor' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_editor' }))
    .send({
      workspaceId: 'workspace_shared_permissions',
      command: {
        clientMutationId: 'shared_invite_forbidden',
        type: 'board.invite.create',
        payload: {
          boardId: 'main',
          email: 'invitee@example.com',
          role: 'viewer'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'You do not have permission to administer this board.'
  });
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 0);
});

test('POST /api/workspace/commands accepts matching-email invites and persists the actor email', async () => {
  const sharedWorkspace = createEmptyWorkspace({
    workspaceId: 'workspace_shared_invite_accept',
    creator: { type: 'human', id: 'sub_owner' }
  });
  sharedWorkspace.boards.main.collaboration.invites = [
    {
      id: 'invite_1',
      email: 'invitee@example.com',
      role: 'editor',
      status: 'pending',
      invitedBy: { type: 'human', id: 'sub_owner' },
      invitedAt: '2026-04-02T09:00:00.000Z'
    }
  ];
  const sharedRecord = createInitialWorkspaceRecord('sub_owner', {
    workspaceId: 'workspace_shared_invite_accept',
    now: '2026-04-02T10:00:00.000Z'
  });
  sharedRecord.isHomeWorkspace = false;
  sharedRecord.workspace = sharedWorkspace;
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_invited' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_invited', email: 'invitee@example.com', name: 'Invitee' }))
    .send({
      workspaceId: 'workspace_shared_invite_accept',
      command: {
        clientMutationId: 'shared_invite_accept',
        type: 'board.invite.accept',
        payload: {
          boardId: 'main',
          inviteId: 'invite_1'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.boards.main.collaboration.invites[0].status, 'accepted');
  assert.equal(response.body.workspace.boards.main.collaboration.invites[0].respondedAt, response.body.meta.updatedAt);
  assert.deepEqual(response.body.workspace.boards.main.collaboration.memberships.at(-1), {
    actor: {
      type: 'human',
      id: 'sub_invited',
      email: 'invitee@example.com',
      displayName: 'Invitee'
    },
    role: 'editor',
    joinedAt: response.body.meta.updatedAt,
    invitedBy: {
      type: 'human',
      id: 'sub_owner'
    }
  });
  assert.equal(
    workspaceRecordRepository.replaceRecordCalls[0].record.workspace.boards.main.collaboration.memberships.at(-1).actor.email,
    'invitee@example.com'
  );
});

test('POST /api/workspace/commands replays duplicate clientMutationId safely without duplicating work', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });
  const commandBody = {
    command: {
      clientMutationId: 'dup_1',
      type: 'board.create',
      payload: {
        title: 'Retry-safe board'
      }
    },
    expectedRevision: 0
  };

  const firstResponse = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send(commandBody);
  const secondResponse = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send(commandBody);

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.deepEqual(secondResponse.body.result, firstResponse.body.result);
  assert.equal(secondResponse.body.meta.revision, 1);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.equal(secondResponse.body.workspace.boardOrder.filter((boardId) => boardId === firstResponse.body.result.boardId).length, 1);
});

test('POST /api/workspace/commands returns no-op results without incrementing revision', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({
      command: {
        clientMutationId: 'noop_1',
        type: 'ui.activeBoard.set',
        payload: {
          boardId: 'main'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.noOp, true);
  assert.equal(response.body.meta.revision, 0);
  assert.equal(response.body.meta.isPristine, true);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 0);
});

test('POST /api/workspace/commands returns 409 when expectedRevision is stale', async () => {
  const existingWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Server task',
    detailsMarkdown: 'Already persisted',
    priority: 'urgent'
  });
  const existingRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace: existingWorkspace,
      actor: { type: 'human', id: 'sub_123' },
      now: '2026-04-02T11:00:00.000Z',
      createActivityEventId: () => 'activity_saved_existing'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([existingRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({
      command: {
        clientMutationId: 'm2',
        type: 'board.create',
        payload: {
          title: 'New board'
        }
      },
      expectedRevision: 0
    });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'This workspace changed elsewhere. Refresh to continue.'
  });
});

test('POST /api/workspace/import saves a valid full-workspace snapshot for a pristine server record', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Imported task',
    detailsMarkdown: 'From local v4 storage',
    priority: 'important'
  });
  const normalizedWorkspace = migrateWorkspaceSnapshot(workspace);

  const response = await request(app)
    .post('/api/workspace/import')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({ workspace });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.deepEqual(response.body.meta, {
    revision: 1,
    updatedAt: '2026-04-02T11:00:00.000Z',
    lastChangedBy: 'sub_123',
    isPristine: false
  });
  assert.deepEqual(workspaceRecordRepository.importCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      workspaceId: null,
      workspace: normalizedWorkspace,
      actor: {
        type: 'human',
        id: 'sub_123'
      }
    }
  ]);
});

test('POST /api/workspace/import accepts legacy snapshots and persists the migrated shape', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });
  const legacyWorkspace = createLegacyWorkspaceSnapshot({
    version: 4,
    title: 'Imported legacy task',
    detailsMarkdown: 'Migrated from local v4 storage',
    priority: 'important'
  });

  const response = await request(app)
    .post('/api/workspace/import')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({ workspace: legacyWorkspace });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(validateWorkspaceShape(response.body.workspace), true);
  assert.equal(response.body.workspace.boards.main.columnOrder, undefined);
  assert.equal(response.body.workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(
    response.body.workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title,
    'Imported legacy task'
  );
  assert.deepEqual(response.body.workspace.ownership, {
    owner: {
      type: 'human',
      id: 'sub_123'
    }
  });
  assert.deepEqual(response.body.workspace.access, {
    kind: 'private'
  });
  assert.equal(response.body.workspace.boards.main.collaboration.memberships[0].actor.id, 'sub_123');
  assert.equal(response.body.workspace.boards.main.collaboration.memberships[0].role, 'admin');
  assert.deepEqual(response.body.workspace.boards.main.cards.card_legacy_1.localeRequests, {});
  assert.equal(workspaceRecordRepository.importCalls.length, 1);
  assert.equal(validateWorkspaceShape(workspaceRecordRepository.importCalls[0].workspace), true);
  assert.equal(workspaceRecordRepository.importCalls[0].workspace.boards.main.columnOrder, undefined);
  assert.equal(workspaceRecordRepository.importCalls[0].workspace.boards.main.columns, undefined);
  assert.equal(workspaceRecordRepository.importCalls[0].workspace.boards.main.cards.card_legacy_1.title, undefined);
  assert.equal(
    workspaceRecordRepository.importCalls[0].workspace.boards.main.cards.card_legacy_1.contentByLocale.en.title,
    'Imported legacy task'
  );
  assert.deepEqual(workspaceRecordRepository.importCalls[0].workspace.ownership, {
    owner: {
      type: 'system',
      id: 'workspace-bootstrap'
    }
  });
  assert.deepEqual(workspaceRecordRepository.importCalls[0].workspace.access, {
    kind: 'private'
  });
  assert.deepEqual(workspaceRecordRepository.importCalls[0].workspace.boards.main.cards.card_legacy_1.localeRequests, {});
});

test('POST /api/workspace/import returns 409 when the server workspace is no longer pristine', async () => {
  const existingWorkspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Server task',
    detailsMarkdown: 'Already persisted',
    priority: 'urgent'
  });
  const existingRecord = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_123', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace: existingWorkspace,
      actor: { id: 'sub_123' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([existingRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/import')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }))
    .send({ workspace: createEmptyWorkspace() });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    ok: false,
    error: 'Workspace import is only allowed while the server workspace is still pristine.'
  });
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
  board.stages.backlog.cardIds = [cardId];

  const viewModel = buildWorkspacePageModel(
    { sub: 'sub_123', name: 'Tester' },
    createTranslator('ja'),
    workspace
  );

  assert.equal(viewModel.board.title, 'Roadmap alpha');
  assert.equal(viewModel.workspace.boards[board.id].stages.backlog.title, 'Backlog');
  assert.equal(viewModel.board.cards[cardId].title, 'Ship launch checklist');
  assert.equal(viewModel.board.cards[cardId].detailsMarkdown, 'Owner: Mina');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].contentByLocale.en.title, 'Ship launch checklist');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].contentByLocale.en.detailsMarkdown, 'Owner: Mina');
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

test('POST /auth/google returns 403 for a mismatched origin under the development APP_BASE_URL fallback', async () => {
  const app = createTestApp({
    env: {
      NODE_ENV: 'development'
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

test('POST /auth/google allows the matching localhost origin under the development APP_BASE_URL fallback', async () => {
  const app = createTestApp({
    env: {
      NODE_ENV: 'development',
      PORT: '4567'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Origin', 'http://localhost:4567')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/boards'
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

function readWorkspaceBootstrapPayload(html) {
  const match = html.match(/<script type="application\/json" id="workspace-bootstrap">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error('Workspace bootstrap payload was not rendered.');
  }

  return JSON.parse(match[1]);
}

function createLegacyWorkspaceSnapshot({
  version = 4,
  title = 'Legacy task',
  detailsMarkdown = '',
  priority = 'important'
} = {}) {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;

  return {
    version,
    workspaceId: workspace.workspaceId,
    ui: structuredClone(workspace.ui),
    boardOrder: [...workspace.boardOrder],
    boards: {
      [board.id]: {
        id: board.id,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        columnOrder: ['backlog', 'doing', 'done', 'archived'],
        columns: {
          backlog: {
            id: 'backlog',
            title: 'Backlog',
            cardIds: ['card_legacy_1'],
            allowedTransitionStageIds: ['doing', 'done'],
            templateIds: []
          },
          doing: {
            id: 'doing',
            title: 'Doing',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'done'],
            templateIds: []
          },
          done: {
            id: 'done',
            title: 'Done',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'doing', 'archived'],
            templateIds: []
          },
          archived: {
            id: 'archived',
            title: 'Archived',
            cardIds: [],
            allowedTransitionStageIds: ['backlog', 'doing', 'done'],
            templateIds: []
          }
        },
        cards: {
          card_legacy_1: {
            id: 'card_legacy_1',
            title,
            detailsMarkdown,
            priority,
            createdAt: '2026-04-02T09:00:00.000Z',
            updatedAt: '2026-04-02T09:30:00.000Z'
          }
        }
      }
    }
  };
}

function createLegacyWorkspaceRecord({
  viewerSub = 'sub_123',
  workspaceId = viewerSub,
  workspace = createLegacyWorkspaceSnapshot(),
  revision = 1,
  createdAt = '2026-04-02T10:00:00.000Z',
  updatedAt = '2026-04-02T11:00:00.000Z',
  lastChangedBy = 'sub_123',
  activityEvents = [],
  commandReceipts = []
} = {}) {
  return {
    workspaceId,
    viewerSub,
    isHomeWorkspace: true,
    workspace,
    revision,
    createdAt,
    updatedAt,
    lastChangedBy,
    activityEvents,
    commandReceipts
  };
}

function createWorkspaceRecordRepositoryDouble(initialRecords = []) {
  const records = new Map(
    initialRecords.map((record) => [record.workspaceId, structuredClone(record)])
  );

  function projectRecord(record, { viewerSub, viewerEmail = null } = {}) {
    const normalizedRecord = createWorkspaceRecord(record);

    return {
      ...structuredClone(normalizedRecord),
      workspace: filterWorkspaceForViewer({
        viewerSub,
        viewerEmail,
        ownerSub: normalizedRecord.viewerSub,
        workspace: normalizedRecord.workspace
      })
    };
  }

  async function loadFullRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
    if (workspaceId) {
      const requestedRecord = records.get(workspaceId);

      if (
        !requestedRecord ||
        !canViewerAccessWorkspace({
          viewerSub,
          viewerEmail,
          ownerSub: createWorkspaceRecord(requestedRecord).viewerSub,
          workspace: createWorkspaceRecord(requestedRecord).workspace
        })
      ) {
        throw new WorkspaceAccessDeniedError();
      }

      return createWorkspaceRecord(requestedRecord);
    }

    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);
    const existingHomeRecord =
      records.get(homeWorkspaceId)
      ?? records.get(viewerSub)
      ?? [...records.values()].find((record) => record.viewerSub === viewerSub && record.isHomeWorkspace);

    if (existingHomeRecord) {
      return createWorkspaceRecord(existingHomeRecord);
    }

    if (!records.has(homeWorkspaceId)) {
      records.set(
        homeWorkspaceId,
        createInitialWorkspaceRecord(viewerSub, {
          now: '2026-04-02T10:00:00.000Z'
        })
      );
    }

    return createWorkspaceRecord(records.get(homeWorkspaceId));
  }

  return {
    loadCalls: [],
    replaceCalls: [],
    replaceRecordCalls: [],
    importCalls: [],

    async loadOrCreateWorkspaceRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
      this.loadCalls.push({
        viewerSub,
        viewerEmail,
        workspaceId
      });

      return projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, workspaceId }),
        { viewerSub, viewerEmail }
      );
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, viewerEmail = null, workspaceId = null } = {}) {
      return loadFullRecord({ viewerSub, viewerEmail, workspaceId });
    },

    async replaceWorkspaceSnapshot({ viewerSub, viewerEmail = null, workspaceId = null, workspace, actor, expectedRevision }) {
      this.replaceCalls.push({
        viewerSub,
        viewerEmail,
        workspaceId,
        workspace,
        expectedRevision,
        actor
      });

      const currentRecord =
        await this.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub,
          viewerEmail,
          workspaceId
        });

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: '2026-04-02T11:00:00.000Z',
        createActivityEventId: () => 'activity_saved_test'
      });

      records.set(nextRecord.workspaceId, nextRecord);
      return structuredClone(nextRecord);
    },

    async importWorkspaceSnapshot({ viewerSub, viewerEmail = null, workspaceId = null, workspace, actor }) {
      this.importCalls.push({
        viewerSub,
        viewerEmail,
        workspaceId,
        workspace,
        actor
      });

      const currentRecord =
        await this.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub,
          viewerEmail,
          workspaceId
        });

      if (currentRecord.revision !== 0) {
        throw new WorkspaceImportConflictError();
      }

      const nextRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: '2026-04-02T11:00:00.000Z',
        activityType: 'workspace.imported',
        createActivityEventId: () => 'activity_imported_test'
      });

      records.set(nextRecord.workspaceId, nextRecord);
      return structuredClone(nextRecord);
    },

    async replaceWorkspaceRecord({ record, expectedRevision }) {
      this.replaceRecordCalls.push({
        record,
        expectedRevision
      });

      const currentRecord =
        records.get(record.workspaceId)
        ?? createInitialWorkspaceRecord(record.viewerSub, {
          workspaceId: record.workspaceId,
          now: '2026-04-02T10:00:00.000Z'
        });

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      records.set(record.workspaceId, structuredClone(record));
      return structuredClone(record);
    }
  };
}
