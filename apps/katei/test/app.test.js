import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';
import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  KATEI_SESSION_COOKIE_NAME,
  createSessionPayload,
  createSignedSessionCookieValue
} from '../src/auth/session_cookie.js';
import {
  KATEI_LAST_SURFACE_COOKIE_NAME,
  createLastSurfaceCookieValue
} from '../src/auth/last_surface_cookie.js';
import {
  createCard,
  createEmptyWorkspace,
  migrateWorkspaceSnapshot,
  validateWorkspaceShape
} from '../public/js/domain/workspace.js';
import { KATEI_UI_LOCALE_COOKIE_NAME } from '../src/i18n/request_ui_locale.js';
import { createTranslator } from '../public/js/i18n/translate.js';
import { buildWorkspacePageModel } from '../src/routes/boards.js';
import { buildPortfolioPageModel } from '../src/routes/portfolio.js';
import { encryptBoardSecret } from '../src/security/board_secret_crypto.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  createWorkspaceRecord
} from '../src/workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceBoardRoleAssignmentPermissionError,
  WorkspaceCreationPermissionError,
  WorkspaceRevisionConflictError,
  WorkspaceTitleManagementPermissionError
} from '../src/workspaces/workspace_record_repository.js';
import { canViewerAccessWorkspace, filterWorkspaceForViewer } from '../src/workspaces/workspace_access.js';

const WORKSPACE_VENDOR_ASSET_PATHS = [
  '/vendor/easymde/easymde.min.css',
  '/vendor/easymde/easymde.min.js',
  '/vendor/marked/marked.umd.js',
  '/vendor/dompurify/purify.min.js'
];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_VIEWS_PATH = path.join(__dirname, '../src/views');
const kateiBuildMeta = JSON.parse(
  await fs.readFile(new URL('../public/build-meta.json', import.meta.url), 'utf8')
);
const EXPECTED_LOCAL_SW_BUILD_ID = kateiBuildMeta.pwaBuildId;
const EXPECTED_LOCAL_PWA_BUILD_ID_SHORT = kateiBuildMeta.pwaBuildIdShort;

function createTestApp({ env = {}, googleTokenVerifier, workspaceRecordRepository, portfolioReadModel } = {}) {
  return createApp({
    env: {
      NODE_ENV: 'test',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      KATEI_SESSION_SECRET: 'test-session-secret',
      KATEI_BOARD_SECRET_ENCRYPTION_KEY: 'test-board-secret-encryption-key',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: 'katei_test',
      ...env
    },
    googleTokenVerifier,
    workspaceRecordRepository: workspaceRecordRepository ?? createWorkspaceRecordRepositoryDouble(),
    portfolioReadModel: portfolioReadModel ?? createPortfolioReadModelDouble()
  });
}

function createSessionCookieHeader(viewer, { ttlSeconds = 300, now = '2099-01-01T00:00:00Z' } = {}) {
  const payload = createSessionPayload(viewer, ttlSeconds, new Date(now));
  const value = createSignedSessionCookieValue(payload, 'test-session-secret');
  return `${KATEI_SESSION_COOKIE_NAME}=${value}`;
}

function createLastSurfaceCookieHeader(memory) {
  return `${KATEI_LAST_SURFACE_COOKIE_NAME}=${createLastSurfaceCookieValue(memory)}`;
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
  assert.match(response.text, /<span class="ui-locale-badge-value">\s*English\s*<\/span>/);
  assert.match(response.text, /<option value="en" selected>\s*English\s*<\/option>/);
  assert.match(response.text, /UI language/);
  assertSharedPwaHeadTags(response.text);
});

test('GET /manifest.webmanifest returns the install manifest', async () => {
  const app = createTestApp();

  const response = await request(app).get('/manifest.webmanifest');

  assert.equal(response.status, 200);
  assert.equal(response.type, 'application/manifest+json');

  const manifest = JSON.parse(response.text);

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.deepEqual(manifest.icons, [
    {
      src: '/icons/icon-192.png',
      sizes: '192x192',
      type: 'image/png'
    },
    {
      src: '/icons/icon-512.png',
      sizes: '512x512',
      type: 'image/png'
    },
    {
      src: '/icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable'
    }
  ]);
});

test('GET /offline.html returns the self-contained offline fallback page', async () => {
  const app = createTestApp();

  const response = await request(app).get('/offline.html');

  assert.equal(response.status, 200);
  assert.match(response.text, /You're offline/);
  assert.match(response.text, /Katei can't reach the network right now\./);
  assert.match(response.text, /Boards and workspace changes are not available offline in this first PWA cut\./);
  assert.match(response.text, /window\.location\.reload\(\)/);
  assert.match(response.text, /<a href="\/">Go to home<\/a>/);
  assert.doesNotMatch(response.text, /\/assets\/app\.css/);
  assert.doesNotMatch(response.text, /\/js\/app\.js/);
});

test('GET /sw.js returns the Katei service worker', async () => {
  const app = createTestApp();

  const response = await request(app).get('/sw.js');

  assert.equal(response.status, 200);
  assert.match(
    response.text,
    new RegExp(`const BUILD_ID = ["']${escapeForRegex(EXPECTED_LOCAL_SW_BUILD_ID)}["'];`)
  );
  assert.match(response.text, /katei-static-/);
  assert.match(response.text, /const OFFLINE_URL = '\/offline\.html';/);
  assert.doesNotMatch(response.text, /const CACHE_VERSION = 'v1';/);
  assert.doesNotMatch(response.text, /'BUILD_ID'/);
  assert.doesNotMatch(response.text, /\/\* PRECACHE_URLS \*\//);
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

test('GET / ignores remembered board destinations for authenticated non-super-admin users', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/')
    .set('Cookie', [
      createSessionCookieHeader({
        sub: 'sub_123',
        name: 'Tester',
        email: 'tester@example.com'
      }),
      createLastSurfaceCookieHeader({
        surface: 'board',
        workspaceId: 'workspace_shared_ignored_for_member',
        boardId: 'notes'
      })
    ]);

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/boards');
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
});

test('GET / redirects authenticated super admins to /portfolio when no remembered board destination exists', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/portfolio');
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
});

test('GET / redirects authenticated super admins to a remembered board workspace when it remains accessible', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_portfolio_redirect', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/')
    .set('Cookie', [
      createSessionCookieHeader({
        sub: 'sub_123',
        name: 'Tester',
        email: 'tester@example.com'
      }),
      createLastSurfaceCookieHeader({
        surface: 'board',
        workspaceId: 'workspace_shared_portfolio_redirect',
        boardId: 'notes'
      })
    ]);

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/boards?workspaceId=workspace_shared_portfolio_redirect&boardId=notes');
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      workspaceId: 'workspace_shared_portfolio_redirect'
    }
  ]);
});

test('GET / falls back to /portfolio for super admins when the remembered board no longer exists', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_portfolio_missing_board', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/')
    .set('Cookie', [
      createSessionCookieHeader({
        sub: 'sub_123',
        name: 'Tester',
        email: 'tester@example.com'
      }),
      createLastSurfaceCookieHeader({
        surface: 'board',
        workspaceId: 'workspace_shared_portfolio_missing_board',
        boardId: 'archived'
      })
    ]);

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/portfolio');
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      workspaceId: 'workspace_shared_portfolio_missing_board'
    }
  ]);
});

test('GET /vendor/stimulus/stimulus.js serves the vendored library asset', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/vendor/stimulus/stimulus.js');

  assert.equal(response.status, 200);
  assert.match(response.text, /Stimulus 3\.2\./);
  assert.match(response.text, /class Controller/);
  assert.doesNotMatch(response.text, /node_modules\/@hotwired\/stimulus\/dist\/stimulus\.js/);
});

test('GET /boards redirects anonymous users to /', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/boards');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
});

test('GET /portfolio redirects anonymous users to /', async () => {
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' })
  });

  const response = await request(app).get('/portfolio');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
});

test('GET /portfolio redirects authenticated non-super-admin users to /boards', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const portfolioReadModel = createPortfolioReadModelDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/boards');
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
  assert.deepEqual(portfolioReadModel.loadCalls, []);
});

test('GET /portfolio renders the dedicated portfolio shell for super admins', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: {
      totals: {
        workspaces: 1,
        boards: 1,
        cards: 3,
        cardsMissingRequiredLocales: 1,
        openLocaleRequestCount: 2,
        awaitingHumanVerificationCount: 1,
        agentProposalCount: 1,
        pendingCardReviewCount: 1
      },
      workspaces: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardCount: 2,
          timestamps: {
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-03T12:00:00.000Z'
          }
        }
      ],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          viewerRole: null,
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 1,
            openLocaleRequestCount: 2,
            awaitingHumanVerificationCount: 1,
            agentProposalCount: 1
          },
          aging: {
            oldestMissingRequiredLocaleUpdatedAt: '2026-04-03T10:30:00.000Z',
            oldestOpenLocaleRequestAt: '2026-04-03T10:15:00.000Z',
            oldestAwaitingHumanVerificationAt: '2026-04-03T10:45:00.000Z',
            oldestAgentProposalAt: '2026-04-03T09:30:00.000Z'
          },
          timestamps: {
            workspaceCreatedAt: '2026-04-01T09:00:00.000Z',
            workspaceUpdatedAt: '2026-04-03T12:00:00.000Z',
            boardCreatedAt: '2026-04-01T09:05:00.000Z',
            boardUpdatedAt: '2026-04-03T11:45:00.000Z'
          }
        }
      ],
      awaitingHumanVerificationItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_awaiting',
          cardTitle: 'Await approval',
          localizedTitle: '確認待ち',
          locale: 'ja',
          cardUpdatedAt: '2026-04-03T10:40:00.000Z',
          verificationRequestedAt: '2026-04-03T10:45:00.000Z'
        }
      ],
      agentProposalItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_agent',
          cardTitle: 'Check glossaries',
          localizedTitle: '用語集を確認',
          locale: 'ja',
          cardUpdatedAt: '2026-04-03T09:20:00.000Z',
          proposedAt: '2026-04-03T09:30:00.000Z'
        }
      ],
      pendingCardReviewItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_pending_review',
          cardTitle: 'Approve launch brief',
          cardUpdatedAt: '2026-04-03T10:20:00.000Z',
          stageId: 'review',
          stageTitle: 'Final review'
        }
      ],
      missingRequiredLocalizationItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_missing',
          cardTitle: 'Translate hero copy',
          cardUpdatedAt: '2026-04-03T10:30:00.000Z',
          missingLocales: ['ja']
        }
      ]
    }
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });
  const translator = createTranslator('en');

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /<title>過程 \(katei\) · Portfolio<\/title>/);
  assert.match(
    response.text,
    /<main[\s\S]*?class="mx-auto grid min-h-screen w-full max-w-7xl content-start gap-4 px-4 pb-10 pt-4 sm:px-6 lg:px-8"[\s\S]*?data-controller="portfolio"/
  );
  assert.match(response.text, /Back to boards/);
  assert.match(response.text, /Board directory/);
  assert.match(response.text, /Search portfolio/);
  assert.match(response.text, /data-action="portfolio#openCreateDialog"/);
  assert.match(response.text, />\s*Create workspace\s*</);
  assert.match(response.text, /Executive roadmap/);
  assert.match(response.text, /workspace_portfolio_alpha/);
  assert.match(response.text, /1 matching boards/);
  assert.match(response.text, /Pending review/);
  assert.match(response.text, /Approve launch brief/);
  assert.match(response.text, /Final review/);
  assert.match(response.text, /Awaiting approval/);
  assert.match(response.text, /Verification requested/);
  assert.match(response.text, /Await approval/);
  assert.match(response.text, /確認待ち/);
  assert.match(response.text, /2026-04-03T10:45:00.000Z/);
  assert.match(response.text, /Proposed/);
  assert.match(response.text, /Check glossaries/);
  assert.match(response.text, /用語集を確認/);
  assert.match(response.text, /2026-04-03T09:30:00.000Z/);
  assert.match(response.text, /Missing required localizations/);
  assert.match(response.text, /Translate hero copy/);
  assert.match(response.text, /ja/);
  assert.match(response.text, /Incomplete locale coverage/);
  assert.match(response.text, /Oldest missing required locale/);
  assert.match(response.text, /Aging and bottlenecks/);
  assert.match(response.text, /Oldest awaiting approval/);
  assert.match(response.text, /Oldest open locale requests/);
  assert.match(response.text, /Oldest missing required locales/);
  assert.match(response.text, /2026-04-03T10:15:00.000Z/);
  assert.match(response.text, /2026-04-03T10:30:00.000Z/);
  assert.match(response.text, /Board ID/);
  assert.match(response.text, /Locale coverage/);
  assert.match(response.text, /Key counts/);
  assert.match(response.text, /Source locale/);
  assert.match(response.text, /Default locale/);
  assert.match(response.text, /Supported locales/);
  assert.match(response.text, /Required locales/);
  assert.match(response.text, /Cards missing required locales/);
  assert.match(response.text, /Open locale requests/);
  assert.match(response.text, /Awaiting human verification/);
  assert.match(response.text, /Agent proposals/);
  assert.match(response.text, /My role on this board/);
  assert.match(response.text, /Choose role/);
  assert.match(response.text, /Assign yourself a role to open this board\./);
  assert.match(response.text, /data-portfolio-board-role-form/);
  assert.match(response.text, /aria-disabled="true"/);
  assert.match(response.text, /Open board/);
  assert.match(response.text, /Needs locales/);
  assert.match(response.text, /3 cards/);
  assert.match(response.text, /<header class="top-bar">/);
  assert.match(response.text, /<div class="top-bar-heading-group">/);
  assert.match(response.text, /<h1 class="top-bar-title font-serif text-3xl leading-tight text-strong">Portfolio<\/h1>/);
  assert.match(response.text, /<div class="top-bar-actions">/);
  assert.match(response.text, /data-action="portfolio#openProfileOptions"/);
  assert.match(
    response.text,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="portfolio#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.doesNotMatch(response.text, /class="portfolio-hero"/);
  assert.doesNotMatch(response.text, /class="portfolio-header"/);
  assert.doesNotMatch(response.text, /class="portfolio-actions"/);
  assert.match(response.text, /class="portfolio-workspace-group portfolio-directory-card paper-panel"/);
  assert.ok(countMatches(response.text, /class="portfolio-workspace-group paper-panel"/g) >= 7);
  assert.match(response.text, /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main"/);
  assert.match(response.text, /Tester/);
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({ surface: 'portfolio' })))
  );
  assert.doesNotMatch(response.text, /data-controller="workspace"/);
  assert.doesNotMatch(response.text, /id="workspace-bootstrap"/);
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
  assert.deepEqual(portfolioReadModel.loadCalls, [{ viewerSub: 'sub_123' }]);

  const portfolioHeader = response.text.match(/<header class="top-bar">[\s\S]*?<\/header>/)?.[0] ?? '';
  const portfolioSummaryGrid = response.text.match(
    /<section class="env-inventory-status-grid">[\s\S]*?<\/section>/
  )?.[0] ?? '';
  const boardDirectorySection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.directory.heading')
  );
  const pendingSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.pendingCardReviews.heading')
  );
  const awaitingApprovalSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.awaitingApproval.heading')
  );
  const agentProposalsSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.agentProposals.heading')
  );
  const missingRequiredLocalizationsSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.missingRequiredLocalizations.heading')
  );
  const incompleteCoverageSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.incompleteCoverage.heading')
  );
  const agingSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.aging.heading')
  );
  const profileOptionsDialog = extractDialogHtml(response.text, 'profile-options');

  assert.doesNotMatch(portfolioHeader, /field-label text-sm font-semibold/);
  assert.doesNotMatch(portfolioHeader, /max-w-3xl text-base leading-7 text-muted sm:text-lg/);
  assert.doesNotMatch(portfolioHeader, /portfolio-meta-row/);
  assert.doesNotMatch(portfolioHeader, /portfolio-badge-row/);
  assert.doesNotMatch(portfolioHeader, /class="viewer-chip"/);
  assert.match(
    response.text,
    /<header class="top-bar">[\s\S]*?<\/header>\s*<section class="env-inventory-status-grid">[\s\S]*?<\/section>\s*<section class="paper-panel portfolio-section inventory-panel">[\s\S]*?<h2 class="font-serif text-3xl text-strong">Board directory<\/h2>/
  );
  assert.ok(countMatches(response.text, /class="paper-panel portfolio-section inventory-panel"/g) >= 6);
  assert.ok(countMatches(portfolioSummaryGrid, /class="paper-panel env-inventory-status-card env-inventory-status-card--good"/g) >= 7);
  assert.match(portfolioSummaryGrid, /class="env-inventory-status-label">Workspaces</);
  assert.match(portfolioSummaryGrid, /class="env-inventory-status-value">1</);
  assert.doesNotMatch(portfolioSummaryGrid, /Summary/);
  assert.doesNotMatch(portfolioSummaryGrid, /portfolio-summary-grid/);
  assert.doesNotMatch(portfolioSummaryGrid, /portfolio-summary-card/);
  assert.match(boardDirectorySection, /<form method="get" action="\/portfolio" class="env-inventory-controls">/);
  assert.match(boardDirectorySection, /<label class="env-inventory-field" for="portfolio-search">/);
  assert.match(boardDirectorySection, /id="portfolio-search"[\s\S]*?name="q"[\s\S]*?class="field-control"/);
  assert.match(boardDirectorySection, /class="env-inventory-control-actions"/);
  assert.match(boardDirectorySection, />\s*Apply\s*</);
  assert.match(boardDirectorySection, /<div class="text-sm leading-6 text-muted">\s*1 matching boards\s*<\/div>/);
  assert.match(
    pendingSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main&amp;cardId=card_pending_review&amp;view=card"/
  );
  assert.match(
    awaitingApprovalSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main&amp;cardId=card_awaiting&amp;view=card"/
  );
  assert.match(
    agentProposalsSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main&amp;cardId=card_agent&amp;view=card"/
  );
  assert.match(
    missingRequiredLocalizationsSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main&amp;cardId=card_missing&amp;view=card"/
  );
  assert.match(
    incompleteCoverageSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main"/
  );
  assert.doesNotMatch(incompleteCoverageSection, /cardId=/);
  assert.match(
    agingSection,
    /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main"/
  );
  assert.doesNotMatch(agingSection, /cardId=/);
  assert.doesNotMatch(boardDirectorySection, /portfolio-toolbar/);
  assert.doesNotMatch(boardDirectorySection, /portfolio-search-form/);
  assert.doesNotMatch(boardDirectorySection, /portfolio-search-input/);
  assert.doesNotMatch(boardDirectorySection, /portfolio-search-actions/);
  assertSharedProfileOptionsDialog(profileOptionsDialog, {
    localeFormAction: '/portfolio',
    localePickerId: 'portfolio-ui-locale-picker'
  });
});

test('GET /portfolio renders one workspace title action per workspace group for super admins', async () => {
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: {
      totals: {
        workspaces: 1,
        boards: 2,
        cards: 4,
        cardsMissingRequiredLocales: 0,
        openLocaleRequestCount: 0,
        awaitingHumanVerificationCount: 0,
        agentProposalCount: 0
      },
      workspaces: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardCount: 2,
          timestamps: {
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-03T12:00:00.000Z'
          }
        }
      ],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          viewerRole: 'viewer',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 0,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        },
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'ops',
          boardTitle: 'Operations',
          viewerRole: 'editor',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'en',
            supportedLocales: ['en'],
            requiredLocales: []
          },
          cardCounts: {
            total: 1,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 0,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        }
      ],
      awaitingHumanVerificationItems: [],
      agentProposalItems: [],
      missingRequiredLocalizationItems: []
    }
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    portfolioReadModel
  });

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /data-controller="portfolio"/);
  assert.match(response.text, /Studio HQ/);
  assert.match(response.text, /Executive roadmap/);
  assert.match(response.text, /Operations/);
  assert.match(response.text, /Current role: Viewer/);
  assert.match(response.text, /Current role: Editor/);
  assert.match(response.text, /Workspace ID: workspace_portfolio_alpha/);
  assert.equal(countMatches(response.text, /data-portfolio-action="rename-workspace-title"/g), 1);
  assert.equal(countMatches(response.text, /data-portfolio-action="delete-workspace"/g), 1);
  assert.equal(countMatches(response.text, /data-portfolio-action="delete-board"/g), 2);
  assert.match(response.text, /data-board-count="2"/);
  assert.match(response.text, /data-portfolio-target="dialog"/);
  assert.match(response.text, /data-portfolio-target="confirmDialog"/);
  assert.match(response.text, /data-portfolio-target="confirmTitle"/);
  assert.match(response.text, /data-portfolio-target="confirmMessage"/);
  assert.match(response.text, /data-portfolio-target="confirmButton"/);
  assert.equal(countMatches(response.text, /data-portfolio-board-role-form/g), 2);
});

test('portfolio template hides workspace title editing controls for non-super-admin viewers', () => {
  const html = renderPortfolioPage(
    buildPortfolioPageModel({
      viewer: {
        sub: 'sub_123',
        name: 'Tester',
        email: 'tester@example.com',
        isSuperAdmin: false
      },
      t: createTranslator('en'),
      portfolio: {
        totals: {
          workspaces: 1,
          boards: 1,
          cards: 3,
          cardsMissingRequiredLocales: 0,
          openLocaleRequestCount: 0,
          awaitingHumanVerificationCount: 0,
          agentProposalCount: 0
        },
        workspaces: [
          {
            workspaceId: 'workspace_portfolio_alpha',
            workspaceTitle: null,
            boardCount: 1,
            timestamps: {
              createdAt: '2026-04-01T09:00:00.000Z',
              updatedAt: '2026-04-03T12:00:00.000Z'
            }
          }
        ],
        boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          viewerRole: null,
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
            },
            cardCounts: {
              total: 3,
              byStage: null
            },
            localizationSummary: {
              cardsMissingRequiredLocales: 0,
              openLocaleRequestCount: 0,
              awaitingHumanVerificationCount: 0,
              agentProposalCount: 0
            }
          }
        ],
        awaitingHumanVerificationItems: [],
        agentProposalItems: [],
        missingRequiredLocalizationItems: []
      }
    })
  );

  assert.match(html, /data-controller="portfolio"/);
  assert.match(html, /workspace_portfolio_alpha/);
  assert.doesNotMatch(html, /data-portfolio-action="rename-workspace-title"/);
  assert.doesNotMatch(html, /data-portfolio-action="delete-workspace"/);
  assert.doesNotMatch(html, /data-portfolio-action="delete-board"/);
  assert.doesNotMatch(html, /data-portfolio-board-role-form/);
  assert.doesNotMatch(html, /My role on this board/);
  assert.doesNotMatch(html, /data-portfolio-target="dialog"/);
  assert.doesNotMatch(html, /data-portfolio-target="confirmDialog"/);
});

test('buildPortfolioPageModel falls back to workspaceId labels when workspaceTitle is absent', () => {
  const viewModel = buildPortfolioPageModel({
    viewer: {
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com',
      isSuperAdmin: true
    },
    t: createTranslator('en'),
    portfolio: {
      totals: {
        workspaces: 1,
        boards: 1,
        cards: 2,
        cardsMissingRequiredLocales: 1,
        openLocaleRequestCount: 0,
        awaitingHumanVerificationCount: 1,
        agentProposalCount: 0
      },
      workspaces: [
        {
          workspaceId: 'workspace_portfolio_untitled',
          workspaceTitle: null,
          boardCount: 1,
          timestamps: {
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-03T12:00:00.000Z'
          }
        }
      ],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_untitled',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Operations',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 2,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 1,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 1,
            agentProposalCount: 0
          },
          aging: {
            oldestMissingRequiredLocaleUpdatedAt: '2026-04-03T10:30:00.000Z',
            oldestOpenLocaleRequestAt: null,
            oldestAwaitingHumanVerificationAt: '2026-04-03T10:45:00.000Z',
            oldestAgentProposalAt: null
          },
          timestamps: {
            workspaceCreatedAt: '2026-04-01T09:00:00.000Z',
            workspaceUpdatedAt: '2026-04-03T12:00:00.000Z',
            boardCreatedAt: '2026-04-01T09:05:00.000Z',
            boardUpdatedAt: '2026-04-03T11:45:00.000Z'
          }
        }
      ],
      awaitingHumanVerificationItems: [
        {
          workspaceId: 'workspace_portfolio_untitled',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Operations',
          cardId: 'card_awaiting',
          cardTitle: 'Await approval',
          localizedTitle: '確認待ち',
          locale: 'ja',
          cardUpdatedAt: '2026-04-03T10:40:00.000Z',
          verificationRequestedAt: '2026-04-03T10:45:00.000Z'
        }
      ],
      agentProposalItems: [],
      missingRequiredLocalizationItems: [
        {
          workspaceId: 'workspace_portfolio_untitled',
          workspaceTitle: null,
          boardId: 'main',
          boardTitle: 'Operations',
          cardId: 'card_missing',
          cardTitle: 'Translate hero copy',
          cardUpdatedAt: '2026-04-03T10:30:00.000Z',
          missingLocales: ['ja']
        }
      ]
    }
  });
  const html = renderPortfolioPage(viewModel);

  assert.equal(viewModel.boardDirectoryEntries[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.boardDirectoryWorkspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.awaitingApprovalEntries[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.awaitingApprovalWorkspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.missingRequiredLocalizationEntries[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.missingRequiredLocalizationWorkspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.incompleteCoverageEntries[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.incompleteCoverageWorkspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.agingSections[0].workspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.equal(viewModel.agingSections[2].workspaceGroups[0].workspaceLabel, 'workspace_portfolio_untitled');
  assert.match(html, /workspace_portfolio_untitled/);
});

test('buildPortfolioPageModel keeps the workspace boardCount from portfolio summaries when directory rows are filtered', () => {
  const viewModel = buildPortfolioPageModel({
    viewer: {
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com',
      isSuperAdmin: true
    },
    t: createTranslator('en'),
    searchQuery: 'operations',
    portfolio: {
      totals: {
        workspaces: 1,
        boards: 2,
        cards: 4,
        cardsMissingRequiredLocales: 0,
        openLocaleRequestCount: 0,
        awaitingHumanVerificationCount: 0,
        agentProposalCount: 0,
        pendingCardReviewCount: 0
      },
      workspaces: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardCount: 2,
          timestamps: {
            createdAt: '2026-04-01T09:00:00.000Z',
            updatedAt: '2026-04-03T12:00:00.000Z'
          }
        }
      ],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 0,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        },
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'ops',
          boardTitle: 'Operations',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'en',
            supportedLocales: ['en'],
            requiredLocales: []
          },
          cardCounts: {
            total: 1,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 0,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        }
      ],
      awaitingHumanVerificationItems: [],
      agentProposalItems: [],
      pendingCardReviewItems: [],
      missingRequiredLocalizationItems: []
    }
  });

  assert.equal(viewModel.boardDirectoryEntries.length, 1);
  assert.equal(viewModel.boardDirectoryEntries[0].boardId, 'ops');
  assert.equal(viewModel.boardDirectoryWorkspaceGroups[0].boardCount, 2);
});

test('buildPortfolioPageModel groups non-directory portfolio sections by workspace', () => {
  const viewModel = buildPortfolioPageModel({
    viewer: {
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com',
      isSuperAdmin: true
    },
    t: createTranslator('en'),
    portfolio: {
      totals: {
        workspaces: 2,
        boards: 2,
        cards: 6,
        cardsMissingRequiredLocales: 3,
        openLocaleRequestCount: 1,
        awaitingHumanVerificationCount: 2,
        agentProposalCount: 1
      },
      workspaces: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ'
        },
        {
          workspaceId: 'workspace_portfolio_beta',
          workspaceTitle: null
        }
      ],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 2,
            openLocaleRequestCount: 1,
            awaitingHumanVerificationCount: 1,
            agentProposalCount: 0
          },
          aging: {
            oldestMissingRequiredLocaleUpdatedAt: '2026-04-03T10:30:00.000Z',
            oldestOpenLocaleRequestAt: '2026-04-03T10:15:00.000Z',
            oldestAwaitingHumanVerificationAt: '2026-04-03T10:45:00.000Z'
          }
        },
        {
          workspaceId: 'workspace_portfolio_beta',
          workspaceTitle: null,
          boardId: 'research',
          boardTitle: 'Research board',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'fr',
            supportedLocales: ['en', 'fr'],
            requiredLocales: ['fr']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 1,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 1,
            agentProposalCount: 1
          },
          aging: {
            oldestMissingRequiredLocaleUpdatedAt: '2026-04-03T11:00:00.000Z',
            oldestOpenLocaleRequestAt: null,
            oldestAwaitingHumanVerificationAt: '2026-04-03T10:50:00.000Z'
          }
        }
      ],
      awaitingHumanVerificationItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_alpha_awaiting',
          cardTitle: 'Await approval',
          locale: 'ja',
          verificationRequestedAt: '2026-04-03T10:45:00.000Z'
        },
        {
          workspaceId: 'workspace_portfolio_beta',
          workspaceTitle: null,
          boardId: 'research',
          boardTitle: 'Research board',
          cardId: 'card_beta_awaiting',
          cardTitle: 'Await translation review',
          locale: 'fr',
          verificationRequestedAt: '2026-04-03T10:50:00.000Z'
        }
      ],
      agentProposalItems: [
        {
          workspaceId: 'workspace_portfolio_beta',
          workspaceTitle: null,
          boardId: 'research',
          boardTitle: 'Research board',
          cardId: 'card_beta_agent',
          cardTitle: 'Check terminology',
          locale: 'fr',
          proposedAt: '2026-04-03T09:30:00.000Z'
        }
      ],
      missingRequiredLocalizationItems: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Studio HQ',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          cardId: 'card_alpha_missing',
          cardTitle: 'Translate hero copy',
          cardUpdatedAt: '2026-04-03T10:30:00.000Z',
          missingLocales: ['ja']
        },
        {
          workspaceId: 'workspace_portfolio_beta',
          workspaceTitle: null,
          boardId: 'research',
          boardTitle: 'Research board',
          cardId: 'card_beta_missing',
          cardTitle: 'Translate findings',
          cardUpdatedAt: '2026-04-03T11:00:00.000Z',
          missingLocales: ['fr']
        }
      ]
    }
  });

  assert.deepEqual(
    viewModel.awaitingApprovalWorkspaceGroups.map((group) => [group.workspaceId, group.entries.length]),
    [
      ['workspace_portfolio_alpha', 1],
      ['workspace_portfolio_beta', 1]
    ]
  );
  assert.deepEqual(
    viewModel.agentProposalWorkspaceGroups.map((group) => [group.workspaceId, group.entries.length]),
    [['workspace_portfolio_beta', 1]]
  );
  assert.deepEqual(
    viewModel.missingRequiredLocalizationWorkspaceGroups.map((group) => [group.workspaceId, group.entries.length]),
    [
      ['workspace_portfolio_alpha', 1],
      ['workspace_portfolio_beta', 1]
    ]
  );
  assert.deepEqual(
    viewModel.incompleteCoverageWorkspaceGroups.map((group) => [group.workspaceId, group.entries.length]),
    [
      ['workspace_portfolio_alpha', 1],
      ['workspace_portfolio_beta', 1]
    ]
  );
  assert.deepEqual(
    viewModel.agingSections.map((section) => section.workspaceGroups.length),
    [2, 1, 2]
  );
});

test('GET /portfolio renders the empty state cleanly for super admins when no summaries exist', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const portfolioReadModel = createPortfolioReadModelDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /No portfolio data yet/);
  assert.doesNotMatch(response.text, /portfolio-directory-card/);
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
  assert.deepEqual(portfolioReadModel.loadCalls, [{ viewerSub: 'sub_123' }]);
});

test('GET /portfolio filters the board directory by the search query', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: {
      totals: {
        workspaces: 1,
        boards: 2,
        cards: 5,
        cardsMissingRequiredLocales: 1,
        openLocaleRequestCount: 1,
        awaitingHumanVerificationCount: 0,
        agentProposalCount: 0
      },
      workspaces: [],
      boardDirectory: [
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Alpha workspace',
          boardId: 'main',
          boardTitle: 'Executive roadmap',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'ja',
            supportedLocales: ['en', 'ja'],
            requiredLocales: ['ja']
          },
          cardCounts: {
            total: 3,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 1,
            openLocaleRequestCount: 1,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        },
        {
          workspaceId: 'workspace_portfolio_alpha',
          workspaceTitle: 'Alpha workspace',
          boardId: 'research',
          boardTitle: 'Research board',
          localePolicy: {
            sourceLocale: 'en',
            defaultLocale: 'en',
            supportedLocales: ['en'],
            requiredLocales: ['en']
          },
          cardCounts: {
            total: 2,
            byStage: null
          },
          localizationSummary: {
            cardsMissingRequiredLocales: 0,
            openLocaleRequestCount: 0,
            awaitingHumanVerificationCount: 0,
            agentProposalCount: 0
          }
        }
      ]
    }
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });

  const response = await request(app)
    .get('/portfolio?q=ja')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /value="ja"/);
  assert.match(response.text, /1 matching boards/);
  assert.match(response.text, /Executive roadmap/);
  assert.doesNotMatch(response.text, /Research board/);
});

test('GET /portfolio renders the pending card reviews section and summary count', async () => {
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: createPendingCardReviewPortfolioSummary()
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    portfolioReadModel
  });
  const translator = createTranslator('en');

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);

  const pendingSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.pendingCardReviews.heading')
  );
  const boardDirectorySection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.directory.heading')
  );
  const portfolioSummaryGrid = response.text.match(
    /<section class="env-inventory-status-grid">[\s\S]*?<\/section>/
  )?.[0] ?? '';

  assert.match(pendingSection, /Editorial roadmap/);
  assert.match(pendingSection, /Approve launch brief/);
  assert.match(pendingSection, /Final review/);
  assert.match(pendingSection, /Pending review/);
  assert.match(pendingSection, /workflow review/);
  assert.doesNotMatch(pendingSection, /Verification requested/);
  assert.match(pendingSection, /2026-04-03T10:20:00.000Z/);
  assert.match(pendingSection, /Open board/);
  assert.match(
    pendingSection,
    /\/boards\?workspaceId=workspace_portfolio_reviews&amp;boardId=main&amp;cardId=card_pending_review&amp;view=card/
  );
  assert.match(pendingSection, /workspaceId=workspace_portfolio_reviews/);
  assert.match(pendingSection, /boardId=main/);
  assert.match(pendingSection, /cardId=card_pending_review/);
  assert.match(pendingSection, /view=card/);
  assert.match(
    boardDirectorySection,
    /href="\/boards\?workspaceId=workspace_portfolio_reviews&amp;boardId=main"/
  );
  assert.doesNotMatch(boardDirectorySection, /cardId=/);
  assert.match(
    portfolioSummaryGrid,
    new RegExp(
      `<article class="paper-panel env-inventory-status-card env-inventory-status-card--good">[\\s\\S]*?<div class="env-inventory-status-label">${escapeForRegex(translator('portfolio.summary.pendingCardReviewCountLabel'))}<\\/div>[\\s\\S]*?<div class="env-inventory-status-value">1<\\/div>[\\s\\S]*?<\\/article>`
    )
  );
  assertSectionOrder(response.text, [
    translator('portfolio.directory.heading'),
    translator('portfolio.pendingCardReviews.heading'),
    translator('portfolio.awaitingApproval.heading')
  ]);
});

test('GET /portfolio keeps pending card review rows visible when the search matches the stage title', async () => {
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: createPendingCardReviewPortfolioSummary()
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    portfolioReadModel
  });
  const translator = createTranslator('en');

  const response = await request(app)
    .get('/portfolio?q=final review')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /value="final review"/);

  const pendingSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.pendingCardReviews.heading')
  );
  const boardDirectorySection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.directory.heading')
  );

  assert.match(pendingSection, /1 matching boards/);
  assert.match(pendingSection, /Editorial roadmap/);
  assert.match(pendingSection, /Approve launch brief/);
  assert.match(pendingSection, /Final review/);
  assert.match(boardDirectorySection, /No boards match this search/);
});

test('GET /portfolio shows the filtered empty state for pending card reviews when the search excludes them', async () => {
  const portfolioReadModel = createPortfolioReadModelDouble({
    summary: createPendingCardReviewPortfolioSummary()
  });
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    portfolioReadModel
  });
  const translator = createTranslator('en');

  const response = await request(app)
    .get('/portfolio?q=backlog')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);

  const pendingSection = extractPortfolioSectionHtml(
    response.text,
    translator('portfolio.pendingCardReviews.heading')
  );

  assert.match(pendingSection, new RegExp(escapeForRegex(translator('portfolio.pendingCardReviews.emptyFiltered.heading'))));
  assert.match(pendingSection, new RegExp(escapeForRegex(translator('portfolio.pendingCardReviews.emptyFiltered.description'))));
  assert.doesNotMatch(pendingSection, /Approve launch brief/);
  assert.doesNotMatch(pendingSection, /Final review/);
});

test('GET /boards renders the server workspace and bootstrap payload for authenticated users', async () => {
  const workspace = createCard(createEmptyWorkspace(), 'main', {
    title: 'Ship launch checklist',
    detailsMarkdown: 'Owner: Mina </script><img src=x onerror=1>',
    priority: 'urgent'
  });
  workspace.title = 'Operations HQ';
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
  const portfolioReadModel = createPortfolioReadModelDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assertSharedPwaHeadTags(response.text);
  assert.match(response.text, /data-workspace-viewer-sub-value="sub_123"/);
  assert.match(response.text, /Logout/);
  assert.match(response.text, /Tester/);
  assert.match(response.text, /Roadmap alpha/);
  assert.match(response.text, /data-workspace-target="workspaceLabel">\s*Operations HQ\s*</);
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
      workspaceTitle: 'Operations HQ',
      isHomeWorkspace: true
    },
    meta: {
      revision: 1,
      updatedAt: '2026-04-02T11:00:00.000Z',
      lastChangedBy: 'sub_123',
      isPristine: false,
      workspaceId: record.workspaceId,
      workspaceTitle: 'Operations HQ',
      isHomeWorkspace: true
    },
    pendingWorkspaceInvites: [],
    accessibleWorkspaces: []
  });
  assert.equal(bootstrapPayload.workspace.boards.main.title, 'Roadmap alpha');
  assert.equal(
    bootstrapPayload.workspace.boards.main.cards[Object.keys(bootstrapPayload.workspace.boards.main.cards)[0]].contentByLocale
      .en.title,
    'Ship launch checklist'
  );
  assert.deepEqual(workspaceRecordRepository.resolveCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      viewerName: 'Tester',
      requestedWorkspaceId: null
    }
  ]);
  assert.deepEqual(portfolioReadModel.loadCalls, []);

  for (const assetPath of WORKSPACE_VENDOR_ASSET_PATHS) {
    assert.match(response.text, new RegExp(escapeForRegex(assetPath)));
  }

  assert.match(response.text, /<link rel="stylesheet" href="\/vendor\/easymde\/easymde\.min\.css">/);
  assert.match(response.text, /<script defer src="\/vendor\/marked\/marked\.umd\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/dompurify\/purify\.min\.js"><\/script>/);
  assert.match(response.text, /<script defer src="\/vendor\/easymde\/easymde\.min\.js"><\/script>/);
  assert.match(response.text, /data-action="workspace#openBoardOptions"/);
  assert.match(response.text, /data-action="workspace#openProfileOptions"/);
  assert.doesNotMatch(response.text, /data-action="workspace#openPortfolio"/);
  assert.match(response.text, /data-workspace-viewer-super-admin-value="false"/);
  assert.match(response.text, />\s*Boards\s*</);
  assert.match(
    response.text,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="workspace#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.match(response.text, /data-board-options-field="inviteAcceptButton"/);
  assert.match(response.text, /data-board-options-field="inviteDeclineButton"/);
  assert.match(response.text, /board-options:accept-invite->workspace#handleAcceptInvite/);
  assert.match(response.text, /board-options:decline-invite->workspace#handleDeclineInvite/);

  const boardOptionsDialog = extractDialogHtml(response.text, 'board-options');
  const boardCollaboratorsDialog = extractDialogHtml(response.text, 'board-collaborators');
  const profileOptionsDialog = extractDialogHtml(response.text, 'profile-options');

  assert.doesNotMatch(boardOptionsDialog, /ui-locale-control-row/);
  assert.doesNotMatch(boardOptionsDialog, /session#logout/);
  assert.match(boardOptionsDialog, /class="dialog-actions board-options-actions mt-6"/);
  assert.match(boardOptionsDialog, /board-options#createBoard/);
  assert.match(boardOptionsDialog, /board-options#openCollaborators/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#openPortfolio/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#openRenameDialog/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="selfRoleSection"/);
  assert.doesNotMatch(boardOptionsDialog, /My role on this board/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-field="workspaceTitleButton"/);
  assert.match(boardOptionsDialog, /data-board-options-field="collaboratorsButton"/);
  assert.match(boardOptionsDialog, /data-board-options-field="collaboratorsButton"[\s\S]*?board-options#openCollaborators/);
  assert.match(
    boardOptionsDialog,
    /class="touch-button-secondary touch-button-secondary--icon-with-badge touch-button-secondary--team"[\s\S]*?aria-label="Collaborators"[\s\S]*?<span class="sr-only">Collaborators<\/span>/
  );
  assert.match(boardOptionsDialog, /data-board-options-field="collaboratorBadge"/);
  assert.match(boardOptionsDialog, /data-board-options-field="editButton"/);
  assert.match(
    boardOptionsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--edit"[\s\S]*?aria-label="Edit Board"[\s\S]*?data-board-options-field="editButton"[\s\S]*?data-action="board-options#editBoard"[\s\S]*?<span class="sr-only">Edit Board<\/span>/
  );
  assert.doesNotMatch(
    boardOptionsDialog,
    /class="dialog-actions board-options-actions mt-6"[\s\S]*?data-board-options-target="editButton"/
  );
  assert.doesNotMatch(boardOptionsDialog, /board-options#resetBoard/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="resetButton"/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="collaboratorsButton"/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="collaboratorBadge"/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="deleteButton"/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-field="deleteButton"/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#deleteBoard/);
  assert.doesNotMatch(
    boardOptionsDialog,
    /class="dialog-actions board-options-actions mt-6"[\s\S]*?board-options#openCollaborators/
  );
  assert.doesNotMatch(
    boardOptionsDialog,
    /class="dialog-actions board-options-actions mt-6"[\s\S]*?board-options#deleteBoard/
  );
  assert.match(
    boardOptionsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-board-options-initial-focus[\s\S]*?data-action="board-options#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.doesNotMatch(response.text, /board-options:delete-board->workspace#confirmDeleteBoard/);
  assert.doesNotMatch(response.text, /board-options:open-portfolio->workspace#openPortfolio/);
  assert.match(boardCollaboratorsDialog, /type="email"[\s\S]*?name="email"[\s\S]*?autocomplete="email"/);
  assert.match(
    boardCollaboratorsDialog,
    /<select[\s\S]*?name="role"[\s\S]*?data-board-collaborators-field="memberRoleSelect"/
  );
  assert.match(
    boardCollaboratorsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-board-collaborators-initial-focus[\s\S]*?data-action="board-collaborators#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );

  assertSharedProfileOptionsDialog(profileOptionsDialog, {
    localeFormAction: '/boards',
    localePickerId: 'profile-options-ui-locale-picker'
  });
});

test('GET /boards stores a default workspace title on first home-workspace bootstrap', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', email: 'felipe@example.com', name: 'Felipe Budinich' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /data-workspace-target="workspaceLabel">\s*Felipe Budinich 1\s*</);
  assert.equal(bootstrapPayload.workspace.title, 'Felipe Budinich 1');
  assert.equal(bootstrapPayload.activeWorkspace.workspaceTitle, 'Felipe Budinich 1');
  assert.equal(bootstrapPayload.meta.workspaceTitle, 'Felipe Budinich 1');
});

test('GET /boards selects the requested board from the query string for first paint and last-surface memory', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_board_query', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?workspaceId=workspace_shared_board_query&boardId=notes')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1 class="top-bar-title[\s\S]*?>Shared notes<\/h1>/);
  assert.equal(bootstrapPayload.workspace.ui.activeBoardId, 'notes');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({
      surface: 'board',
      workspaceId: 'workspace_shared_board_query',
      boardId: 'notes'
    })))
  );
});

test('GET /boards ignores an invalid requested board for non-super-admin viewers', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_board_invalid_query', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?workspaceId=workspace_shared_board_invalid_query&boardId=archived')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1 class="top-bar-title[\s\S]*?>Shared notes<\/h1>/);
  assert.equal(bootstrapPayload.workspace.ui.activeBoardId, 'notes');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({
      surface: 'board',
      workspaceId: 'workspace_shared_board_invalid_query',
      boardId: 'notes'
    })))
  );
});

test('GET /boards redirects super-admin drill-downs back to /portfolio when the requested board no longer exists', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_board_missing_target', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?workspaceId=workspace_shared_board_missing_target&boardId=archived')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/portfolio');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({ surface: 'portfolio' })))
  );
});

test('GET /boards redirects stale workspace requests to the canonical fallback invite workspace URL', async () => {
  const olderInviteRecord = createSharedWorkspaceRecordFixture('workspace_other_invite', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com'
  });
  const newerInviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_casa', {
    viewerSub: 'sub_123',
    viewerEmail: 'tester@example.com'
  });

  newerInviteRecord.workspace.boards.casa.collaboration.invites[0].invitedAt = '2026-04-02T10:20:00.000Z';

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    olderInviteRecord,
    newerInviteRecord
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?workspaceId=workspace_missing_board_target&boardId=notes')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/boards?workspaceId=workspace_other_invite&boardId=invite');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({
      surface: 'board',
      workspaceId: 'workspace_other_invite',
      boardId: 'invite'
    })))
  );
  assert.deepEqual(workspaceRecordRepository.resolveCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      requestedWorkspaceId: 'workspace_missing_board_target'
    }
  ]);
});

test('GET /boards repairs a deleted last-board home workspace into a fresh default board', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_deleted_home',
    workspaceTitle: 'Deleted home',
    boardTitle: 'Only board'
  });

  homeRecord.workspace.boardOrder = [];
  homeRecord.workspace.boards = {};
  homeRecord.workspace.ui.activeBoardId = null;

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([homeRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_deleted_home' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_deleted_home',
      name: 'Deleted Home User',
      email: 'deleted-home@example.com'
    }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.deepEqual(bootstrapPayload.activeWorkspace, {
    workspaceId: createHomeWorkspaceId('sub_deleted_home'),
    workspaceTitle: 'Deleted home',
    isHomeWorkspace: true
  });
  assert.deepEqual(bootstrapPayload.workspace.boardOrder, ['main']);
  assert.equal(bootstrapPayload.workspace.ui.activeBoardId, 'main');
  assert.equal(bootstrapPayload.workspace.boards.main.title, '過程');
  assert.deepEqual(bootstrapPayload.workspace.boards.main.cards, {});
});

test('GET /boards lands on the oldest invite when the viewer home workspace was deleted', async () => {
  const olderInviteRecord = createSharedWorkspaceRecordFixture('workspace_other_invite', {
    memberSub: 'sub_deleted_invited',
    memberEmail: 'deleted@example.com'
  });
  const newerInviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_casa', {
    viewerSub: 'sub_deleted_invited',
    viewerEmail: 'deleted@example.com'
  });

  newerInviteRecord.workspace.boards.casa.collaboration.invites[0].invitedAt = '2026-04-02T10:20:00.000Z';

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    olderInviteRecord,
    newerInviteRecord
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_deleted_invited' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_deleted_invited',
      name: 'Deleted Invitee',
      email: 'deleted@example.com'
    }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.equal(bootstrapPayload.activeWorkspace.workspaceId, 'workspace_other_invite');
  assert.equal(bootstrapPayload.activeWorkspace.isHomeWorkspace, false);
  assert.equal(bootstrapPayload.workspace.ui.activeBoardId, 'invite');
});

test('GET /boards lands on an invited workspace when the viewer no longer owns a home workspace', async () => {
  const inviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_casa', {
    viewerSub: 'sub_orphaned',
    viewerEmail: 'orphaned@example.com'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([inviteRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_orphaned' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_orphaned',
      name: 'Orphaned User',
      email: 'orphaned@example.com'
    }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.deepEqual(bootstrapPayload.activeWorkspace, {
    workspaceId: 'workspace_invited_casa',
    workspaceTitle: null,
    isHomeWorkspace: false
  });
  assert.equal(bootstrapPayload.workspace.ui.activeBoardId, 'casa');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({
      surface: 'board',
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa'
    })))
  );
});

test('GET /boards redirects a stale deleted workspaceId to the canonical fallback URL instead of 404', async () => {
  const inviteRecord = createCrossWorkspaceInviteRecordFixture('workspace_invited_casa', {
    viewerSub: 'sub_orphaned',
    viewerEmail: 'orphaned@example.com'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([inviteRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_orphaned' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get(`/boards?workspaceId=${createHomeWorkspaceId('sub_orphaned')}&boardId=main`)
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_orphaned',
      name: 'Orphaned User',
      email: 'orphaned@example.com'
    }));

  assert.equal(response.status, 302);
  assert.notEqual(response.status, 404);
  assert.equal(response.headers.location, '/boards?workspaceId=workspace_invited_casa&boardId=casa');
  assert.deepEqual(workspaceRecordRepository.resolveCalls, [
    {
      viewerSub: 'sub_orphaned',
      viewerEmail: 'orphaned@example.com',
      viewerName: 'Orphaned User',
      requestedWorkspaceId: createHomeWorkspaceId('sub_orphaned')
    }
  ]);
});

test('GET /boards renders the Portfolio action in the workspace top bar for super admins', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const portfolioReadModel = createPortfolioReadModelDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository,
    portfolioReadModel
  });

  const response = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));
  const boardOptionsDialog = extractDialogHtml(response.text, 'board-options');

  assert.equal(response.status, 200);
  assert.match(response.text, /data-workspace-viewer-super-admin-value="true"/);
  assert.match(
    response.text,
    /data-workspace-target="workspaceLabel">\s*Tester 1\s*</
  );
  assert.match(
    response.text,
    /class="top-bar-actions"[\s\S]*?data-action="workspace#openBoardOptions"[\s\S]*?data-action="workspace#openPortfolio"[\s\S]*?data-action="workspace#openProfileOptions"/
  );
  assert.match(response.text, /data-action="workspace#openPortfolio"/);
  assert.match(response.text, />\s*Portfolio\s*</);
  assert.doesNotMatch(response.text, /board-options:open-portfolio->workspace#openPortfolio/);
  assert.doesNotMatch(response.text, /board-options:board-self-role-updated->workspace#handleBoardSelfRoleUpdated/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-field="workspaceTitleButton"/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#openRenameDialog/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="workspaceTitleEditor"/);
  assert.doesNotMatch(boardOptionsDialog, />\s*Edit workspace title\s*</);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="selfRoleSection"/);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-target="selfRoleSelect"/);
  assert.doesNotMatch(boardOptionsDialog, />\s*My role on this board\s*</);
  assert.doesNotMatch(boardOptionsDialog, />\s*Save role\s*</);
  assert.doesNotMatch(boardOptionsDialog, /data-board-options-field="portfolioButton"/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#openPortfolio/);
  assert.deepEqual(portfolioReadModel.loadCalls, []);
});

test('GET /boards?lang=ja renders localized card content in server HTML and keeps bootstrap content aligned', async () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;
  const cardId = 'card_localized_ja';

  board.cards[cardId] = {
    id: cardId,
    priority: 'urgent',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English checklist',
        detailsMarkdown: 'English preview'
      },
      ja: {
        title: '日本語チェックリスト',
        detailsMarkdown: '日本語プレビュー'
      }
    },
    localeRequests: {}
  };
  board.stages.todo.cardIds = [cardId];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_ja_cards', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { id: 'sub_ja_cards' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([record]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_ja_cards' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?lang=ja')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_ja_cards', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
  assert.match(response.text, /<option value="ja" selected>\s*日本語\s*<\/option>/);
  assert.match(
    response.text,
    new RegExp(
      `<header\\s+class="card-item-toolbar"[\\s\\S]*?data-action="click->workspace#openViewFromToolbar keydown->workspace#openViewFromToolbarKeydown"[\\s\\S]*?data-card-id="${escapeForRegex(cardId)}"[\\s\\S]*?data-stage-id="todo"[\\s\\S]*?data-column-id="todo"[\\s\\S]*?role="button"[\\s\\S]*?tabindex="0"[\\s\\S]*?aria-label="カードを表示"`
    )
  );
  assert.match(response.text, /<h3 class="card-item-title text-base text-strong" data-card-field="title">日本語チェックリスト<\/h3>/);
  assert.match(response.text, /<p\s+class="text-sm leading-6 text-muted"[\s\S]*>\s*日本語プレビュー\s*<\/p>/);
  assert.doesNotMatch(response.text, /data-action="workspace#openView"/);
  assert.doesNotMatch(response.text, /card-item-view-icon/);
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].contentByLocale.ja.title, '日本語チェックリスト');
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].contentByLocale.ja.detailsMarkdown, '日本語プレビュー');
});

test('GET /boards?lang=es-CL renders same-language card content when only generic Spanish content exists', async () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;
  const cardId = 'card_localized_es';

  board.cards[cardId] = {
    id: cardId,
    priority: 'urgent',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English checklist',
        detailsMarkdown: 'English preview'
      },
      es: {
        title: 'Lista en español',
        detailsMarkdown: 'Vista previa en español'
      }
    },
    localeRequests: {}
  };
  board.stages.todo.cardIds = [cardId];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'es'],
    requiredLocales: ['en']
  };

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_es_cards', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { id: 'sub_es_cards' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([record]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_es_cards' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?lang=es-CL')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_es_cards', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="es-CL" data-ui-locale="es-CL">/);
  assert.match(response.text, /<option value="es-CL" selected>\s*Español \(Chile\)\s*<\/option>/);
  assert.match(response.text, /<h3 class="card-item-title text-base text-strong" data-card-field="title">Lista en español<\/h3>/);
  assert.match(response.text, /<p\s+class="text-sm leading-6 text-muted"[\s\S]*>\s*Vista previa en español\s*<\/p>/);
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].contentByLocale.es.title, 'Lista en español');
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].contentByLocale.es.detailsMarkdown, 'Vista previa en español');
});

test('GET /boards?lang=ja repairs legacy jp card content and language policy for first paint', async () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards.main;
  const cardId = 'card_legacy_jp';

  board.cards[cardId] = {
    id: cardId,
    priority: 'urgent',
    createdAt: '2026-04-02T10:00:00.000Z',
    updatedAt: '2026-04-02T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English checklist',
        detailsMarkdown: 'English preview'
      },
      jp: {
        title: '旧日本語チェックリスト',
        detailsMarkdown: '旧日本語プレビュー'
      }
    },
    localeRequests: {
      jp: {
        locale: 'jp',
        requestedBy: { type: 'human', id: 'sub_translator_jp' },
        requestedAt: '2026-04-02T10:30:00.000Z'
      }
    }
  };
  board.stages.todo.cardIds = [cardId];
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'jp',
    supportedLocales: ['en', 'jp'],
    requiredLocales: ['jp']
  };

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_jp_cards', {
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { id: 'sub_jp_cards' },
      now: '2026-04-02T11:00:00.000Z'
    }
  );
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([record]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_jp_cards' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?lang=ja')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_jp_cards', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(response.text);

  assert.equal(response.status, 200);
  assert.match(response.text, /<html lang="ja" data-ui-locale="ja">/);
  assert.match(response.text, /<h3 class="card-item-title text-base text-strong" data-card-field="title">旧日本語チェックリスト<\/h3>/);
  assert.match(response.text, /<p\s+class="text-sm leading-6 text-muted"[\s\S]*>\s*旧日本語プレビュー\s*<\/p>/);
  assert.deepEqual(bootstrapPayload.workspace.boards.main.languagePolicy, {
    sourceLocale: 'en',
    defaultLocale: 'ja',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['ja']
  });
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].contentByLocale.ja.title, '旧日本語チェックリスト');
  assert.equal(bootstrapPayload.workspace.boards.main.cards[cardId].localeRequests.ja.locale, 'ja');
});

test('workspace template renders the no-board header with both Boards and Profile entry points', () => {
  const workspace = createEmptyWorkspace();
  workspace.ui.activeBoardId = 'missing_board';

  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_empty',
        name: 'No Boards Viewer'
      },
      createTranslator('en'),
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_empty',
        isPristine: false,
        workspaceId: 'workspace_empty_render',
        isHomeWorkspace: true
      }
    )
  );

  assert.match(html, /No visible boards/);
  assert.match(html, /This workspace no longer has any boards you can open\./);
  assert.match(html, /data-action="workspace#openBoardOptions"/);
  assert.match(html, /data-action="workspace#openProfileOptions"/);
  assert.doesNotMatch(html, /data-action="workspace#openPortfolio"/);
  assert.match(html, />\s*Boards\s*</);
  assert.match(
    html,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="workspace#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.match(html, /<option value="en" selected>\s*English\s*<\/option>/);
  assert.match(html, /role="menuitemradio"/);
  assert.match(html, /No Boards Viewer/);

  const boardOptionsDialog = extractDialogHtml(html, 'board-options');
  const boardCollaboratorsDialog = extractDialogHtml(html, 'board-collaborators');
  const profileOptionsDialog = extractDialogHtml(html, 'profile-options');

  assert.match(
    boardOptionsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-board-options-initial-focus[\s\S]*?data-action="board-options#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.match(
    boardCollaboratorsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-board-collaborators-initial-focus[\s\S]*?data-action="board-collaborators#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assertSharedProfileOptionsDialog(profileOptionsDialog, {
    localeFormAction: '/boards',
    localePickerId: 'profile-options-ui-locale-picker'
  });
});

test('workspace template renders the Portfolio top-bar action for super admins with no visible boards', () => {
  const workspace = createEmptyWorkspace();
  workspace.ui.activeBoardId = 'missing_board';

  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_empty_super_admin',
        name: 'No Boards Super Admin',
        isSuperAdmin: true
      },
      createTranslator('en'),
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_empty_super_admin',
        isPristine: false,
        workspaceId: 'workspace_empty_super_admin_render',
        isHomeWorkspace: true
      }
    )
  );

  assert.match(html, /No visible boards/);
  assert.match(
    html,
    /class="top-bar-actions"[\s\S]*?data-action="workspace#openBoardOptions"[\s\S]*?data-action="workspace#openPortfolio"[\s\S]*?data-action="workspace#openProfileOptions"/
  );
  assert.match(html, />\s*Portfolio\s*</);

  const boardOptionsDialog = extractDialogHtml(html, 'board-options');

  assert.doesNotMatch(boardOptionsDialog, /data-board-options-field="portfolioButton"/);
  assert.doesNotMatch(boardOptionsDialog, /board-options#openPortfolio/);
});

test('workspace template nests the column chevron inside the count chip', () => {
  const workspace = createEmptyWorkspace();
  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_column_chip',
        name: 'Column Chip Viewer'
      },
      createTranslator('en'),
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_column_chip',
        isPristine: false,
        workspaceId: 'workspace_column_chip',
        isHomeWorkspace: true
      }
    )
  );

  assert.match(
    html,
    /<span class="count-chip px-3 py-1 text-sm font-medium" aria-label="[^"]*">[\s\S]*<span class="column-header-chevron" aria-hidden="true">▾<\/span>[\s\S]*<\/span>/
  );
  assert.doesNotMatch(
    html,
    /<button[^>]*class="column-header-toggle"[\s\S]*>\s*<span class="column-header-chevron" aria-hidden="true">▾<\/span>/
  );
});

test('workspace template renders edit localization controls and a simplified localized view dialog', () => {
  const workspace = createEmptyWorkspace();
  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_locale_editor',
        name: 'Locale Editor'
      },
      createTranslator('en'),
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_locale_editor',
        isPristine: false,
        workspaceId: 'workspace_locale_editor',
        isHomeWorkspace: true
      }
    )
  );
  const cardEditorDialog = extractDialogHtml(html, 'card-editor');
  const cardViewDialog = extractDialogByTarget(html, 'viewDialog');

  assert.match(
    cardEditorDialog,
    /data-card-editor-target="localeSection"[\s\S]*<select[\s\S]*name="locale"[\s\S]*data-card-editor-target="localeSelect"[\s\S]*data-card-editor-target="generateLocaleButton"[\s\S]*data-card-editor-target="discardLocaleButton"[\s\S]*data-card-editor-target="requestLocaleButton"[\s\S]*data-card-editor-target="clearLocaleRequestButton"[\s\S]*data-card-editor-target="generateLocaleHelp"/
  );
  assert.match(cardEditorDialog, /data-card-editor-target="workflowReviewSection"/);
  assert.match(cardEditorDialog, /data-card-editor-target="workflowReviewCreateRow"/);
  assert.match(cardEditorDialog, /data-card-editor-target="workflowReviewStatusRow"/);
  assert.match(cardEditorDialog, /data-card-editor-target="workflowReviewStatus"/);
  assert.match(cardEditorDialog, /name="requiresReview"/);
  assert.match(cardEditorDialog, /data-card-editor-target="requiresReviewInput"/);
  assert.match(cardEditorDialog, /data-card-editor-target="approveReviewButton"/);
  assert.match(cardEditorDialog, /data-card-editor-target="rejectReviewButton"/);
  assert.match(cardEditorDialog, /data-action="card-editor#approveReview"/);
  assert.match(cardEditorDialog, /data-action="card-editor#rejectReview"/);
  assert.match(html, /card-editor:approve-review->workspace#handleApproveCardReview/);
  assert.match(html, /card-editor:reject-review->workspace#handleRejectCardReview/);
  assert.match(
    cardEditorDialog,
    /class="dialog-header-row mt-4"[\s\S]*data-card-editor-target="heading"[\s\S]*data-card-editor-target="submitActions"[\s\S]*data-card-editor-target="statusSection"[\s\S]*id="card-editor-status-trigger"[\s\S]*data-card-editor-target="statusButton"[\s\S]*<img src="\/switch\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">[\s\S]*id="card-editor-status-menu"[\s\S]*data-card-editor-target="statusMenu"[\s\S]*data-card-editor-target="statusOptionTemplate"[\s\S]*data-card-editor-target="statusOption"[\s\S]*role="menuitem"[\s\S]*id="card-editor-status-select"[\s\S]*form="card-editor-form"[\s\S]*data-card-editor-target="statusSelect"[\s\S]*data-card-editor-target="prioritySection"[\s\S]*id="card-editor-priority-trigger"[\s\S]*data-card-editor-target="priorityButton"[\s\S]*<img src="\/traffic\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">[\s\S]*id="card-editor-priority-menu"[\s\S]*data-card-editor-target="priorityMenu"[\s\S]*role="menuitemradio"[\s\S]*data-card-editor-target="priorityOption"[\s\S]*id="card-editor-priority-select"[\s\S]*name="priority"[\s\S]*form="card-editor-form"[\s\S]*data-card-editor-target="priorityInput prioritySelect"[\s\S]*touch-button-secondary--close/
  );
  assert.doesNotMatch(cardEditorDialog, /priority-dot-group/);
  assert.doesNotMatch(cardEditorDialog, /Localized content/);
  assert.doesNotMatch(cardEditorDialog, /data-controller="accordion"/);
  assert.doesNotMatch(cardEditorDialog, /data-accordion-/);
  assert.doesNotMatch(cardEditorDialog, /Available localizations/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="localeStatusRegion"/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="localeStatusTemplate"/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="moveOptionRegion"/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="moveOptionTemplate"/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="editActions"/);
  assert.match(
    cardEditorDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-action="card-editor#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.doesNotMatch(cardEditorDialog, /data-action="card-editor#closeForAction workspace#deleteCard"/);
  assert.doesNotMatch(cardEditorDialog, /class="touch-button-danger"/);

  assert.match(
    cardViewDialog,
    /class="dialog-handle mx-auto h-1\.5 w-16 rounded-full lg:hidden"[\s\S]*data-workspace-target="viewDialogHandle"[\s\S]*data-workspace-target="viewDeleteButton"[\s\S]*data-workspace-target="viewPromptRunButton"[\s\S]*data-workspace-target="viewStatusSection"[\s\S]*id="card-view-status-trigger"[\s\S]*data-workspace-target="viewStatusButton"[\s\S]*id="card-view-status-menu"[\s\S]*data-workspace-target="viewStatusMenu"[\s\S]*data-workspace-target="viewStatusOptionTemplate"[\s\S]*data-workspace-target="viewStatusOption"[\s\S]*role="menuitem"[\s\S]*id="card-view-status-select"[\s\S]*data-workspace-target="viewStatusSelect"[\s\S]*data-workspace-target="viewLocaleSection"[\s\S]*id="card-view-locale-trigger"[\s\S]*data-workspace-target="viewLocaleButton"[\s\S]*id="card-view-locale-menu"[\s\S]*data-workspace-target="viewLocaleMenu"[\s\S]*id="card-view-locale-select"[\s\S]*data-workspace-target="viewLocaleSelect"[\s\S]*data-workspace-target="viewCopyButton"[\s\S]*data-workspace-target="viewEditButton"[\s\S]*data-workspace-target="viewCardTitle"[\s\S]*data-workspace-target="viewCardBody"[\s\S]*data-workspace-target="viewActionRegion"/
  );
  assert.doesNotMatch(cardViewDialog, /data-workspace-target="viewCardPrioritySection"/);
  assert.doesNotMatch(cardViewDialog, /data-workspace-target="viewCardPriority"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="titleInput"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="markdownInput"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="localeSummary"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="localeFallbackNotice"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="localeEditSummary"/);
  assert.doesNotMatch(cardViewDialog, /data-card-editor-target="localeReadOnlyNotice"/);
  assert.match(
    cardViewDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--copy"[\s\S]*?hidden[\s\S]*?disabled[\s\S]*?aria-label="Copy card details"[\s\S]*?data-workspace-target="viewCopyButton"[\s\S]*?data-action="workspace#copyViewCardDetails"[\s\S]*?aria-disabled="true"[\s\S]*?<span class="sr-only">Copy card details<\/span>/
  );
  assert.match(
    cardViewDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--edit"[\s\S]*?hidden[\s\S]*?disabled[\s\S]*?aria-disabled="true"[\s\S]*?aria-label="Edit"[\s\S]*?data-workspace-target="viewEditButton"[\s\S]*?data-action="workspace#openEditFromView"[\s\S]*?<span class="sr-only">Edit<\/span>/
  );
  assert.match(
    cardViewDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--prompt"[\s\S]*?aria-label="Run prompt"[\s\S]*?data-workspace-target="viewPromptRunButton"[\s\S]*?data-action="workspace#handleRunStagePromptFromView"[\s\S]*?<span class="sr-only">Run prompt<\/span>/
  );
  assert.match(
    cardViewDialog,
    /class="touch-button-danger"[\s\S]*?data-workspace-target="viewDeleteButton"[\s\S]*?data-action="workspace#deleteCard"[\s\S]*?Delete/
  );
  assert.match(
    cardViewDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-view-dialog-initial-focus[\s\S]*?data-action="workspace#closeViewDialog"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.doesNotMatch(html, /data-card-field="editButton"/);
  assert.doesNotMatch(html, /data-card-field="promptRunButton"/);
});

test('workspace template renders the board editor without a templates field', () => {
  const workspace = createEmptyWorkspace();
  workspace.boards.main.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  };
  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_board_editor',
        name: 'Board Editor Viewer'
      },
      createTranslator('en'),
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_board_editor',
        isPristine: false,
        workspaceId: 'workspace_board_editor',
        isHomeWorkspace: true
      }
    )
  );
  const boardEditorDialog = extractDialogHtml(html, 'board-editor');
  const boardStageConfigDialog = extractDialogHtml(html, 'board-stage-config');

  assert.match(boardEditorDialog, /name="aiProvider"/);
  assert.match(boardEditorDialog, /name="openAiApiKey"/);
  assert.match(boardEditorDialog, /name="clearOpenAiApiKey"/);
  assert.match(boardEditorDialog, /name="localizationGlossary"/);
  assert.match(boardEditorDialog, /name="stageDefinitions"/);
  assert.match(boardEditorDialog, /data-board-editor-target="aiSection"/);
  assert.match(boardEditorDialog, /data-board-editor-target="apiKeyStatus"/);
  assert.match(boardEditorDialog, /data-board-editor-target="localizationGlossaryInput"/);
  assert.match(boardEditorDialog, /data-board-editor-target="stageDefinitionsInput"/);
  assert.match(boardEditorDialog, /data-board-editor-target="stageSummary"/);
  assert.match(boardEditorDialog, /data-board-editor-target="configureStagesButton"/);
  assert.match(boardEditorDialog, /data-board-editor-target="deleteActions"/);
  assert.match(boardEditorDialog, /data-board-editor-target="deleteButton"/);
  assert.match(boardEditorDialog, /board-stage-config:apply@window->board-editor#applyStageConfig/);
  assert.match(boardEditorDialog, /board-editor#openStageConfig/);
  assert.match(boardEditorDialog, /board-editor#closeForAction workspace#confirmDeleteBoard/);
  assert.match(
    boardEditorDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-action="board-editor#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.doesNotMatch(boardEditorDialog, /name="templates"/);
  assert.doesNotMatch(boardEditorDialog, /data-board-editor-target="templatesInput"/);
  assert.doesNotMatch(boardEditorDialog, />\s*Templates\s*</);
  assert.match(boardStageConfigDialog, /workspace:open-board-stage-config@window->board-stage-config#openFromEvent/);
  assert.match(boardStageConfigDialog, /data-board-stage-config-target="definitionsInput"/);
  assert.match(boardStageConfigDialog, /data-board-stage-config-target="error"/);
  assert.match(boardStageConfigDialog, /placeholder="review \| Review \| doing, done \| card\.review"/);
  assert.match(boardStageConfigDialog, /Example: review \| Review \| doing, done \| card\.review/);
  assert.match(
    boardStageConfigDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-action="board-stage-config#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.match(
    boardStageConfigDialog,
    /<div class="dialog-actions pt-2">[\s\S]*?<button type="button" class="touch-button-secondary" data-action="board-stage-config#close">\s*Cancel\s*<\/button>/
  );
});

test('GET /boards bootstraps only safe board AI metadata and never serialized secrets', async () => {
  const workspace = createEmptyWorkspace();
  workspace.boards.main.aiLocalization = {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  };
  workspace.boards.main.aiLocalizationSecrets = {
    openAiApiKeyEncrypted: encryptBoardSecret('sk-secret-1234', {
      boardSecretEncryptionKey: 'test-board-secret-encryption-key'
    })
  };
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
  assert.deepEqual(bootstrapPayload.workspace.boards.main.aiLocalization, {
    provider: 'openai',
    hasApiKey: true,
    apiKeyLast4: '1234'
  });
  assert.equal(bootstrapPayload.workspace.boards.main.aiLocalizationSecrets, undefined);
  assert.doesNotMatch(response.text, /openAiApiKeyEncrypted/);
  assert.doesNotMatch(response.text, /sk-secret-1234/);
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
  assert.deepEqual(bootstrapPayload.pendingWorkspaceInvites, []);
});

test('GET /boards bootstrap includes pendingWorkspaceInvites and matches the API payload field', async () => {
  const initialRecords = [
    createCrossWorkspaceInviteRecordFixture('workspace_invited_casa')
  ];
  const boardsApp = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository: createWorkspaceRecordRepositoryDouble(initialRecords)
  });
  const apiApp = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository: createWorkspaceRecordRepositoryDouble(initialRecords)
  });

  const boardsResponse = await request(boardsApp)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', email: 'member@example.com', name: 'Tester' }));
  const apiResponse = await request(apiApp)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', email: 'member@example.com', name: 'Tester' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(boardsResponse.text);

  assert.equal(boardsResponse.status, 200);
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(bootstrapPayload.pendingWorkspaceInvites, apiResponse.body.pendingWorkspaceInvites);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, apiResponse.body.accessibleWorkspaces);
  assert.deepEqual(bootstrapPayload.pendingWorkspaceInvites, [
    {
      workspaceId: 'workspace_invited_casa',
      boardId: 'casa',
      boardTitle: 'Casa',
      inviteId: 'invite_casa_1',
      role: 'editor',
      invitedAt: '2026-04-02T10:20:00.000Z',
      invitedBy: {
        id: 'sub_owner_casa',
        email: 'owner-casa@example.com',
        displayName: 'Casa owner'
      }
    }
  ]);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, [
    {
      workspaceId: createHomeWorkspaceId('sub_123'),
      workspaceTitle: 'Tester 1',
      isHomeWorkspace: true,
      boards: [
        {
          boardId: 'main',
          boardTitle: '過程',
          role: 'admin'
        }
      ]
    }
  ]);
});

test('GET /boards bootstrap includes accessibleWorkspaces and matches the API payload field', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member',
    workspaceTitle: 'Member home',
    boardTitle: 'Home board'
  });
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_notes', {
    workspaceTitle: 'Shared notes workspace',
    viewerSub: 'sub_owner_notes',
    memberSub: 'sub_member',
    memberEmail: 'member@example.com',
    memberRole: 'editor',
    memberBoardId: 'notes',
    memberBoardTitle: 'Notes board',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    sharedRecord
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_member' }),
    workspaceRecordRepository
  });

  const boardsResponse = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));
  const apiResponse = await request(app)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(boardsResponse.text);

  assert.equal(boardsResponse.status, 200);
  assert.equal(apiResponse.status, 200);
  assert.equal(bootstrapPayload.activeWorkspace.workspaceTitle, 'Member home');
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, apiResponse.body.accessibleWorkspaces);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, [
    {
      workspaceId: 'workspace_shared_notes',
      workspaceTitle: 'Shared notes workspace',
      isHomeWorkspace: false,
      boards: [
        {
          boardId: 'notes',
          boardTitle: 'Notes board',
          role: 'editor'
        }
      ]
    }
  ]);
});

test('GET /boards bootstrap treats another viewer home workspace as an external accessible workspace', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_member',
    boardTitle: '過程'
  });
  const foreignHomeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_owner_casa',
    boardTitle: 'Casa'
  });
  foreignHomeRecord.workspace.boards.main.collaboration.memberships.push({
    actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
    role: 'viewer',
    joinedAt: '2026-04-02T10:05:00.000Z'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    foreignHomeRecord
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_member' }),
    workspaceRecordRepository
  });

  const boardsResponse = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));
  const apiResponse = await request(app)
    .get('/api/workspace')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com', name: 'Member' }));
  const bootstrapPayload = readWorkspaceBootstrapPayload(boardsResponse.text);

  assert.equal(boardsResponse.status, 200);
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, apiResponse.body.accessibleWorkspaces);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, [
    {
      workspaceId: foreignHomeRecord.workspaceId,
      workspaceTitle: null,
      isHomeWorkspace: false,
      boards: [
        {
          boardId: 'main',
          boardTitle: 'Casa',
          role: 'viewer'
        }
      ]
    }
  ]);
});

test('GET /boards loads an accessible shared workspace by workspaceId and falls back to a new home when inaccessible', async () => {
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
  assert.deepEqual(accessibleBootstrap.accessibleWorkspaces, [
    {
      workspaceId: createHomeWorkspaceId('sub_collab'),
      workspaceTitle: 'Workspace 1',
      isHomeWorkspace: true,
      boards: [
        {
          boardId: 'main',
          boardTitle: '過程',
          role: 'admin'
        }
      ]
    }
  ]);
  assert.deepEqual(workspaceRecordRepository.resolveCalls[0], {
    viewerSub: 'sub_collab',
    viewerEmail: null,
    viewerName: null,
    requestedWorkspaceId: 'workspace_shared_1'
  });

  const inaccessibleResponse = await request(app)
    .get('/boards?workspaceId=workspace_shared_1')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_blocked' }));

  assert.equal(inaccessibleResponse.status, 302);
  assert.equal(inaccessibleResponse.headers.location, '/boards?boardId=main');
});

test('GET /boards keeps workspaceId in the canonical redirect when the fallback target is another viewer home workspace', async () => {
  const foreignHomeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_owner_casa',
    workspaceTitle: 'Casa workspace',
    boardTitle: 'Casa'
  });

  foreignHomeRecord.workspace.boards.main.collaboration.memberships.push({
    actor: { type: 'human', id: 'sub_member', email: 'member@example.com' },
    role: 'viewer',
    joinedAt: '2026-04-02T10:05:00.000Z'
  });
  foreignHomeRecord.createdAt = '2026-03-01T09:00:00.000Z';
  foreignHomeRecord.workspace.boards.main.createdAt = '2026-03-01T09:05:00.000Z';

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([foreignHomeRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_member' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .get('/boards?workspaceId=workspace_missing_foreign_home')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_member',
      name: 'Member',
      email: 'member@example.com'
    }));

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, `/boards?workspaceId=${createHomeWorkspaceId('sub_owner_casa')}&boardId=main`);
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
  assert.match(response.text, />\s*ボード\s*</);
  assert.match(response.text, /aria-label="カードを追加"/);
  assert.match(response.text, /data-workspace-target="boardTitle">過程</);
  assert.match(response.text, />Tester</);
  assert.match(response.text, />\s*Todo\s*</);
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
    workspaceTitle: 'Tester 1',
    isHomeWorkspace: true
  });
  assert.deepEqual(response.body.meta, {
    revision: 0,
    updatedAt: '2026-04-02T10:00:00.000Z',
    lastChangedBy: null,
    isPristine: true
  });
  assert.deepEqual(workspaceRecordRepository.resolveCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      viewerName: 'Tester',
      requestedWorkspaceId: null
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
    workspaceTitle: null,
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
      viewerName: 'Tester',
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

test('POST /api/workspace/commands applies workspace.title.set through the command pipeline for super admins', async () => {
  const existingRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_admin',
    workspaceTitle: 'Old workspace title'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([existingRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_admin', email: 'admin@example.com' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      command: {
        clientMutationId: 'workspace_title_command_1',
        type: 'workspace.title.set',
        payload: {
          title: '  Studio HQ  '
        }
      },
      expectedRevision: existingRecord.revision
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.workspace.title, 'Studio HQ');
  assert.equal(response.body.activeWorkspace.workspaceTitle, 'Studio HQ');
  assert.deepEqual(response.body.result, {
    clientMutationId: 'workspace_title_command_1',
    type: 'workspace.title.set',
    noOp: false,
    workspaceId: existingRecord.workspaceId,
    workspaceTitle: 'Studio HQ'
  });
  assert.equal(response.body.meta.revision, existingRecord.revision + 1);
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: existingRecord.workspaceId
    }
  ]);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.equal(
    workspaceRecordRepository.replaceRecordCalls[0].record.commandReceipts.at(-1)?.commandType,
    'workspace.title.set'
  );
  assert.deepEqual(workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1), {
    id: workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1).id,
    type: 'workspace.title.updated',
    actor: {
      type: 'human',
      id: 'sub_admin'
    },
    createdAt: workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1).createdAt,
    revision: existingRecord.revision + 1,
    entity: {
      kind: 'workspace',
      boardId: null,
      cardId: null
    },
    details: {
      workspaceId: existingRecord.workspaceId,
      workspaceTitle: 'Studio HQ'
    }
  });
});

test('POST /api/workspace/commands applies board.self.role.set through the dedicated super-admin board role seam', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_self_role_command', {
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_admin', email: 'admin@example.com' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' }))
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'board_self_role_command_1',
        type: 'board.self.role.set',
        payload: {
          boardId: 'main',
          role: 'viewer'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.workspace.boardOrder, ['main']);
  assert.deepEqual(Object.keys(response.body.workspace.boards), ['main']);
  assert.equal(response.body.workspace.boards.member, undefined);
  assert.deepEqual(response.body.result, {
    clientMutationId: 'board_self_role_command_1',
    type: 'board.self.role.set',
    noOp: false,
    boardId: 'main',
    targetActor: {
      type: 'human',
      id: 'sub_admin',
      email: 'admin@example.com',
      displayName: 'Admin'
    },
    role: 'viewer'
  });
  assert.deepEqual(workspaceRecordRepository.loadAuthoritativeCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminTitleManagementCalls, []);
  assert.deepEqual(workspaceRecordRepository.loadSuperAdminBoardRoleAssignmentCalls, [
    {
      viewerIsSuperAdmin: true,
      workspaceId: sharedRecord.workspaceId
    }
  ]);
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.equal(
    workspaceRecordRepository.replaceRecordCalls[0].record.commandReceipts.at(-1)?.commandType,
    'board.self.role.set'
  );
  assert.deepEqual(
    workspaceRecordRepository.replaceRecordCalls[0].record.workspace.boards.main.collaboration.memberships.find(
      (membership) => membership.actor.id === 'sub_admin'
    ),
    {
      actor: {
        type: 'human',
        id: 'sub_admin',
        email: 'admin@example.com',
        displayName: 'Admin'
      },
      role: 'viewer',
      joinedAt: workspaceRecordRepository.replaceRecordCalls[0].record.updatedAt
    }
  );
});

test('board.self.role.set makes the workspace appear in normal accessible-workspace reads and board bootstraps', async () => {
  const homeRecord = createHomeWorkspaceRecordFixture({
    viewerSub: 'sub_admin',
    workspaceTitle: 'Admin home',
    boardTitle: 'Home board'
  });
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_self_role_followup', {
    workspaceTitle: 'Shared studio',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    homeRecord,
    sharedRecord
  ]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'admin@example.com'
    },
    googleTokenVerifier: async () => ({ sub: 'sub_admin', email: 'admin@example.com' }),
    workspaceRecordRepository
  });
  const cookie = createSessionCookieHeader({ sub: 'sub_admin', email: 'admin@example.com', name: 'Admin' });

  const commandResponse = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', cookie)
    .send({
      workspaceId: sharedRecord.workspaceId,
      command: {
        clientMutationId: 'board_self_role_followup_1',
        type: 'board.self.role.set',
        payload: {
          boardId: 'main',
          role: 'viewer'
        }
      },
      expectedRevision: sharedRecord.revision
    });

  const homeApiResponse = await request(app)
    .get('/api/workspace')
    .set('Cookie', cookie);
  const boardsResponse = await request(app)
    .get(`/boards?workspaceId=${sharedRecord.workspaceId}`)
    .set('Cookie', cookie);
  const bootstrapPayload = readWorkspaceBootstrapPayload(boardsResponse.text);

  assert.equal(commandResponse.status, 200);
  assert.equal(homeApiResponse.status, 200);
  assert.equal(boardsResponse.status, 200);
  assert.deepEqual(homeApiResponse.body.accessibleWorkspaces, [
    {
      workspaceId: sharedRecord.workspaceId,
      workspaceTitle: 'Shared studio',
      isHomeWorkspace: false,
      boards: [
        {
          boardId: 'main',
          boardTitle: 'Owner board',
          role: 'viewer'
        }
      ]
    }
  ]);
  assert.equal(bootstrapPayload.activeWorkspace.workspaceId, sharedRecord.workspaceId);
  assert.deepEqual(bootstrapPayload.workspace.boardOrder, ['main']);
  assert.deepEqual(Object.keys(bootstrapPayload.workspace.boards), ['main']);
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, [
    {
      workspaceId: homeRecord.workspaceId,
      workspaceTitle: 'Admin home',
      isHomeWorkspace: true,
      boards: [
        {
          boardId: 'main',
          boardTitle: 'Home board',
          role: 'admin'
        }
      ]
    }
  ]);
});

test('POST /api/workspace/commands persists locale review activity for viewer verification requests', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_review_request', {
    memberRole: 'viewer',
    includeInvite: false
  });
  const memberBoard = sharedRecord.workspace.boards.member;
  const [cardId] = memberBoard.stages.todo.cardIds;

  memberBoard.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  memberBoard.cards[cardId].contentByLocale.ja = {
    title: 'AI draft',
    detailsMarkdown: 'AI body',
    provenance: {
      actor: { type: 'agent', id: 'translator_1' },
      timestamp: '2026-04-02T10:20:00.000Z',
      includesHumanInput: false
    },
    review: {
      origin: 'ai',
      verificationRequestedBy: null,
      verificationRequestedAt: null,
      verifiedBy: null,
      verifiedAt: null
    }
  };

  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_member', email: 'member@example.com' }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/api/workspace/commands')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_member', email: 'member@example.com' }))
    .send({
      workspaceId: 'workspace_shared_review_request',
      command: {
        clientMutationId: 'review_request_1',
        type: 'card.locale.review.request',
        payload: {
          boardId: 'member',
          cardId,
          locale: 'ja'
        }
      },
      expectedRevision: 1
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.result.type, 'card.locale.review.request');
  assert.equal(response.body.workspace.boards.member.cards[cardId].contentByLocale.ja.review.verificationRequestedBy.id, 'sub_member');
  assert.equal(workspaceRecordRepository.replaceRecordCalls.length, 1);
  assert.deepEqual(workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1), {
    id: workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1).id,
    type: 'workspace.card.locale.review.requested',
    actor: {
      type: 'human',
      id: 'sub_member'
    },
    createdAt: workspaceRecordRepository.replaceRecordCalls[0].record.activityEvents.at(-1).createdAt,
    revision: 2,
    entity: {
      kind: 'card',
      boardId: 'member',
      cardId
    },
    details: {
      locale: 'ja',
      reviewAction: 'request',
      reviewStatus: 'needs-human-verification'
    }
  });
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
      viewerName: 'Tester',
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
  board.stages.todo.cardIds = [cardId];

  const viewModel = buildWorkspacePageModel(
    { sub: 'sub_123', name: 'Tester' },
    createTranslator('ja'),
    'ja',
    workspace
  );

  assert.equal(viewModel.board.title, 'Roadmap alpha');
  assert.equal(viewModel.workspace.boards[board.id].stages.todo.title, 'Todo');
  assert.equal(viewModel.board.cards[cardId].title, 'Ship launch checklist');
  assert.equal(viewModel.board.cards[cardId].detailsMarkdown, 'Owner: Mina');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].contentByLocale.en.title, 'Ship launch checklist');
  assert.equal(viewModel.workspace.boards[board.id].cards[cardId].contentByLocale.en.detailsMarkdown, 'Owner: Mina');
  assert.equal(viewModel.columnDefinitions.find((column) => column.id === 'todo')?.title, 'やること');
  assert.equal(viewModel.priorityDefinitions.find((priority) => priority.id === 'urgent')?.label, '緊急');
});

test('buildWorkspacePageModel uses the ui locale for server-rendered card content', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards[workspace.ui.activeBoardId];
  const cardId = 'card_localized_1';

  board.cards[cardId] = {
    id: cardId,
    priority: 'important',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details'
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文'
      }
    },
    localeRequests: {}
  };
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  board.stages.todo.cardIds = [cardId];

  const viewModel = buildWorkspacePageModel(
    { sub: 'sub_ja', name: 'Tester' },
    createTranslator('ja'),
    'ja',
    workspace
  );

  assert.equal(viewModel.board.cards[cardId].title, '日本語タイトル');
  assert.equal(viewModel.board.cards[cardId].detailsMarkdown, '日本語本文');
});

test('workspace page first paint uses the active ui locale for rendered board cards', () => {
  const workspace = createEmptyWorkspace();
  const board = workspace.boards[workspace.ui.activeBoardId];
  const cardId = 'card_localized_render';

  board.cards[cardId] = {
    id: cardId,
    priority: 'important',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T11:00:00.000Z',
    contentByLocale: {
      en: {
        title: 'English source',
        detailsMarkdown: 'English details'
      },
      ja: {
        title: '日本語タイトル',
        detailsMarkdown: '日本語本文'
      }
    },
    localeRequests: {}
  };
  board.languagePolicy = {
    sourceLocale: 'en',
    defaultLocale: 'en',
    supportedLocales: ['en', 'ja'],
    requiredLocales: ['en']
  };
  board.stages.todo.cardIds = [cardId];
  board.collaboration.memberships = [
    {
      actor: {
        type: 'human',
        id: 'sub_locale_render'
      },
      role: 'editor'
    }
  ];

  const html = renderWorkspacePage(
    buildWorkspacePageModel(
      {
        sub: 'sub_locale_render',
        name: 'Locale Render Viewer'
      },
      createTranslator('ja'),
      'ja',
      workspace,
      {
        revision: 1,
        updatedAt: '2026-04-02T11:00:00.000Z',
        lastChangedBy: 'sub_locale_render',
        isPristine: false,
        workspaceId: 'workspace_locale_render',
        isHomeWorkspace: true
      }
    ),
    { uiLocale: 'ja' }
  );

  assert.match(html, /<h3 class="card-item-title text-base text-strong" data-card-field="title">日本語タイトル<\/h3>/);
  assert.match(html, /<p\s+class="text-sm leading-6 text-muted"[\s\S]*>\s*日本語本文\s*<\/p>/);
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

test('POST /auth/google lands super admins on /portfolio when no remembered board destination exists', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/auth/google')
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/portfolio'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
});

test('POST /auth/google resumes the remembered board workspace for super admins when it remains accessible', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_login_resume', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes'
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Cookie', createLastSurfaceCookieHeader({
      surface: 'board',
      workspaceId: 'workspace_shared_login_resume',
      boardId: 'notes'
    }))
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/boards?workspaceId=workspace_shared_login_resume&boardId=notes'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      workspaceId: 'workspace_shared_login_resume'
    }
  ]);
});

test('POST /auth/google falls back to /portfolio for super admins when the remembered board no longer exists', async () => {
  const sharedRecord = createSharedWorkspaceRecordFixture('workspace_shared_login_missing_board', {
    memberSub: 'sub_123',
    memberEmail: 'tester@example.com',
    memberBoardId: 'notes',
    memberBoardTitle: 'Shared notes',
    includeInvite: false
  });
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([sharedRecord]);
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Cookie', createLastSurfaceCookieHeader({
      surface: 'board',
      workspaceId: 'workspace_shared_login_missing_board',
      boardId: 'archived'
    }))
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/portfolio'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      workspaceId: 'workspace_shared_login_missing_board'
    }
  ]);
});

test('POST /auth/google falls back to /portfolio for super admins when the remembered board workspace is invalid', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Cookie', createLastSurfaceCookieHeader({
      surface: 'board',
      workspaceId: 'workspace_missing_resume_target',
      boardId: 'notes'
    }))
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/portfolio'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      viewerName: 'Tester',
      workspaceId: 'workspace_missing_resume_target'
    }
  ]);
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

test('POST /auth/google ignores remembered board destinations for non-super-admin users', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const response = await request(app)
    .post('/auth/google')
    .set('Cookie', createLastSurfaceCookieHeader({
      surface: 'board',
      workspaceId: 'workspace_shared_ignored_after_login',
      boardId: 'notes'
    }))
    .send({ credential: 'valid-token' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    redirectTo: '/boards'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
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

test('POST /auth/logout clears last-surface memory so the next super-admin login lands on /portfolio', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
    googleTokenVerifier: async () => ({
      sub: 'sub_123',
      email: 'tester@example.com',
      name: 'Tester'
    }),
    workspaceRecordRepository
  });

  const logoutResponse = await request(app)
    .post('/auth/logout')
    .set('Cookie', [
      createSessionCookieHeader({
        sub: 'sub_123',
        name: 'Tester',
        email: 'tester@example.com'
      }),
      createLastSurfaceCookieHeader({
        surface: 'board',
        workspaceId: 'workspace_shared_login_resume',
        boardId: 'notes'
      })
    ]);

  assert.equal(logoutResponse.status, 200);
  assert.deepEqual(logoutResponse.body, {
    ok: true,
    redirectTo: '/'
  });
  assert.match(findSetCookie(logoutResponse, KATEI_SESSION_COOKIE_NAME) ?? '', /katei_session=;/);
  assert.match(findSetCookie(logoutResponse, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '', /katei_last_surface=;/);

  const loginResponse = await request(app)
    .post('/auth/google')
    .send({ credential: 'valid-token' });

  assert.equal(loginResponse.status, 200);
  assert.deepEqual(loginResponse.body, {
    ok: true,
    redirectTo: '/portfolio'
  });
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
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

function extractDialogHtml(html, controllerName) {
  const startPattern = new RegExp(
    `<dialog\\b[^>]*data-controller="${escapeForRegex(controllerName)}"[^>]*>`,
    's'
  );
  const match = startPattern.exec(html);

  if (!match) {
    throw new Error(`Dialog for controller "${controllerName}" was not rendered.`);
  }

  const startIndex = match.index;
  const dialogTokenPattern = /<dialog\b|<\/dialog>/g;
  dialogTokenPattern.lastIndex = startIndex;
  let depth = 0;
  let tokenMatch = null;

  while ((tokenMatch = dialogTokenPattern.exec(html))) {
    depth += tokenMatch[0] === '<dialog' ? 1 : -1;

    if (depth === 0) {
      return html.slice(startIndex, dialogTokenPattern.lastIndex);
    }
  }

  throw new Error(`Dialog for controller "${controllerName}" was not fully rendered.`);
}

function extractDialogByTarget(html, targetName) {
  const match = html.match(
    new RegExp(
      `<dialog\\b(?:(?!<\\/dialog>).)*data-workspace-target="${escapeForRegex(targetName)}"(?:(?!<\\/dialog>).)*<\\/dialog>`,
      's'
    )
  );

  if (!match) {
    throw new Error(`Dialog for workspace target "${targetName}" was not rendered.`);
  }

  return match[0];
}

function extractPortfolioSectionHtml(html, heading) {
  const sectionMarker = '<section class="paper-panel portfolio-section inventory-panel">';
  const headingMarker = `<h2 class="font-serif text-3xl text-strong">${heading}</h2>`;
  const headingIndex = html.indexOf(headingMarker);

  if (headingIndex === -1) {
    throw new Error(`Portfolio section "${heading}" was not rendered.`);
  }

  const sectionStart = html.lastIndexOf(sectionMarker, headingIndex);

  if (sectionStart === -1) {
    throw new Error(`Portfolio section "${heading}" could not be located.`);
  }

  const nextSectionStart = html.indexOf(sectionMarker, headingIndex + headingMarker.length);

  return nextSectionStart === -1
    ? html.slice(sectionStart)
    : html.slice(sectionStart, nextSectionStart);
}

function assertSectionOrder(html, headings) {
  let previousIndex = -1;

  for (const heading of headings) {
    const currentIndex = html.indexOf(`<h2 class="font-serif text-3xl text-strong">${heading}</h2>`);

    if (currentIndex === -1) {
      throw new Error(`Section heading "${heading}" was not rendered.`);
    }

    assert.ok(
      currentIndex > previousIndex,
      `Expected section "${heading}" to render after the previous section heading.`
    );
    previousIndex = currentIndex;
  }
}

function assertSharedProfileOptionsDialog(dialogHtml, {
  localeFormAction,
  localePickerId,
  pwaBuildId = EXPECTED_LOCAL_SW_BUILD_ID,
  pwaBuildIdShort = EXPECTED_LOCAL_PWA_BUILD_ID_SHORT
}) {
  assert.match(dialogHtml, /class="sheet-panel"/);
  assert.match(dialogHtml, /class="dialog-handle mx-auto h-1\.5 w-16 rounded-full lg:hidden"/);
  assert.match(dialogHtml, /class="dialog-header-row mt-4"/);
  assert.match(dialogHtml, /field-label text-sm font-semibold">\s*Profile\s*</);
  assert.match(
    dialogHtml,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-profile-options-initial-focus[\s\S]*?data-action="profile-options#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.match(dialogHtml, /class="profile-options-identity-row mt-4"/);
  assert.match(dialogHtml, /class="viewer-chip"/);
  assert.match(dialogHtml, /class="profile-options-locale-slot"/);
  assert.match(dialogHtml, /class="profile-options-badge-stack"/);
  assert.match(dialogHtml, new RegExp(`id="${escapeForRegex(localePickerId)}"`));
  assert.match(dialogHtml, /class="ui-locale-badge ui-locale-badge--with-picker"/);
  assert.match(
    dialogHtml,
    new RegExp(
      `<form[\\s\\S]*?method="get"[\\s\\S]*?action="${escapeForRegex(localeFormAction)}"[\\s\\S]*?class="ui-locale-picker ui-locale-picker--icon-menu"[\\s\\S]*?data-controller="ui-locale-picker"[\\s\\S]*?<div class="ui-locale-badge ui-locale-badge--with-picker">[\\s\\S]*?<span class="ui-locale-badge-value">\\s*English\\s*<\\/span>[\\s\\S]*?<div class="view-locale-picker">`
    )
  );
  assert.match(dialogHtml, /class="ui-locale-badge ui-locale-badge--build"/);
  assert.match(dialogHtml, /<span class="ui-locale-badge-label">\s*Build\s*<\/span>/);
  assert.match(dialogHtml, new RegExp(`title="${escapeForRegex(pwaBuildId)}"`));
  assert.match(dialogHtml, new RegExp(`aria-label="${escapeForRegex(`Build ${pwaBuildId}`)}"`));
  assert.match(
    dialogHtml,
    new RegExp(
      `<span[\\s\\S]*?class="ui-locale-badge-value"[\\s\\S]*?>\\s*${escapeForRegex(pwaBuildIdShort)}\\s*<\\/span>`
    )
  );
  assert.match(dialogHtml, /aria-haspopup="dialog"/);
  assert.match(dialogHtml, /data-action="click->ui-locale-picker#openDialog keydown->ui-locale-picker#handleTriggerKeydown"/);
  assert.match(
    dialogHtml,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--language"/
  );
  assert.match(dialogHtml, /data-ui-locale-picker-target="dialog"/);
  assert.doesNotMatch(dialogHtml, /backdropCloseDialog/);
  assert.doesNotMatch(dialogHtml, /cancel->ui-locale-picker#closeDialog/);
  assert.match(dialogHtml, /class="ui-locale-modal-options mt-6"/);
  assert.match(dialogHtml, /data-controller="session"/);
  assert.match(dialogHtml, /data-session-target="logoutButton"/);
  assert.match(dialogHtml, /session#openLogoutConfirm/);
  assert.match(dialogHtml, /data-session-target="confirmDialog"/);
  assert.doesNotMatch(dialogHtml, /backdropCloseConfirmDialog/);
  assert.doesNotMatch(dialogHtml, /cancel->session#closeConfirmDialog/);
  assert.match(dialogHtml, /data-session-target="confirmTitle"/);
  assert.match(dialogHtml, /data-session-target="confirmMessage"/);
  assert.match(dialogHtml, /data-session-target="confirmButton"/);
  assert.match(dialogHtml, /session#confirmLogout/);
}

function assertSharedPwaHeadTags(html) {
  assert.match(html, /<meta name="application-name" content="過程 \(katei\)">/);
  assert.match(html, /<meta name="theme-color" content="#f5f1f0">/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/icon-192\.png">/);
}

function renderPortfolioPage(viewModel, { uiLocale = 'en' } = {}) {
  const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(WORKSPACE_VIEWS_PATH), {
    autoescape: true
  });
  const uiLocaleLabels = {
    en: 'English',
    'es-CL': 'Español (Chile)',
    ja: '日本語'
  };

  return environment.render('pages/portfolio.njk', {
    uiLocale,
    uiLocaleCurrent: {
      value: uiLocale,
      label: uiLocaleLabels[uiLocale] ?? uiLocale
    },
    uiLocaleOptions: [
      {
        value: 'en',
        label: 'English',
        selected: uiLocale === 'en'
      },
      {
        value: 'es-CL',
        label: 'Español (Chile)',
        selected: uiLocale === 'es-CL'
      },
      {
        value: 'ja',
        label: '日本語',
        selected: uiLocale === 'ja'
      }
    ],
    uiLocalePickerAction: '/portfolio',
    pwaBuildId: EXPECTED_LOCAL_SW_BUILD_ID,
    pwaBuildIdShort: EXPECTED_LOCAL_PWA_BUILD_ID_SHORT,
    t: createTranslator(uiLocale),
    ...viewModel
  });
}

function renderWorkspacePage(viewModel, { uiLocale = 'en' } = {}) {
  const environment = new nunjucks.Environment(new nunjucks.FileSystemLoader(WORKSPACE_VIEWS_PATH), {
    autoescape: true
  });
  const uiLocaleLabels = {
    en: 'English',
    'es-CL': 'Español (Chile)',
    ja: '日本語'
  };

  return environment.render('pages/workspace.njk', {
    uiLocale,
    uiLocaleCurrent: {
      value: uiLocale,
      label: uiLocaleLabels[uiLocale] ?? uiLocale
    },
    uiLocaleOptions: [
      {
        value: 'en',
        label: 'English',
        selected: uiLocale === 'en'
      },
      {
        value: 'es-CL',
        label: 'Español (Chile)',
        selected: uiLocale === 'es-CL'
      },
      {
        value: 'ja',
        label: '日本語',
        selected: uiLocale === 'ja'
      }
    ],
    uiLocalePickerAction: '/boards',
    pwaBuildId: EXPECTED_LOCAL_SW_BUILD_ID,
    pwaBuildIdShort: EXPECTED_LOCAL_PWA_BUILD_ID_SHORT,
    t: createTranslator(uiLocale),
    ...viewModel
  });
}

function countMatches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
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

function createHomeWorkspaceRecordFixture({
  viewerSub = 'sub_123',
  workspaceTitle = null,
  boardTitle = 'Home board'
} = {}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId: createHomeWorkspaceId(viewerSub),
    now: '2026-04-02T09:30:00.000Z'
  });
  const workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = boardTitle;
  workspace.title = workspaceTitle;

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: '2026-04-02T09:45:00.000Z'
  });
}

function createWorkspaceRecordRepositoryDouble(initialRecords = []) {
  const records = new Map(
    initialRecords.map((record) => [record.workspaceId, structuredClone(record)])
  );

  function findExistingHomeRecord(viewerSub) {
    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);

    return records.get(homeWorkspaceId)
      ?? records.get(viewerSub)
      ?? [...records.values()].find((record) => record.viewerSub === viewerSub && record.isHomeWorkspace);
  }

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

  function resolveVisibleBoardId(workspace) {
    const activeBoardId =
      typeof workspace?.ui?.activeBoardId === 'string' && workspace.ui.activeBoardId.trim()
        ? workspace.ui.activeBoardId.trim()
        : null;

    if (activeBoardId && workspace?.boards?.[activeBoardId]) {
      return activeBoardId;
    }

    return Array.isArray(workspace?.boardOrder) && workspace.boardOrder.length > 0
      ? workspace.boardOrder[0]
      : null;
  }

  function createResolvedWorkspaceResult(record, { viewerSub, resolvedBoardId, resolution } = {}) {
    const normalizedBoardId = typeof resolvedBoardId === 'string' && resolvedBoardId.trim()
      ? resolvedBoardId.trim()
      : null;
    const normalizedRecord = structuredClone(record);

    if (!normalizedBoardId || !normalizedRecord?.workspace?.boards?.[normalizedBoardId]) {
      return null;
    }

    normalizedRecord.isHomeWorkspace = normalizedRecord.workspaceId === createHomeWorkspaceId(viewerSub);
    normalizedRecord.workspace.ui = {
      ...(normalizedRecord.workspace.ui ?? {}),
      activeBoardId: normalizedBoardId
    };

    return {
      record: normalizedRecord,
      resolvedWorkspaceId: normalizedRecord.workspaceId,
      resolvedBoardId: normalizedBoardId,
      resolution
    };
  }

  function createHomeRecord(viewerSub, viewerName = null, viewerEmail = null) {
    return createInitialWorkspaceRecord(viewerSub, {
      title: typeof viewerName === 'string' && viewerName.trim() ? `${viewerName.trim()} 1` : 'Workspace 1',
      now: '2026-04-02T10:00:00.000Z',
      creator: {
        email: viewerEmail,
        displayName: viewerName
      }
    });
  }

  function repairHomeRecord(existingRecord, viewerSub, viewerName = null, viewerEmail = null) {
    const homeWorkspaceId = createHomeWorkspaceId(viewerSub);
    const repairedRecord = createHomeRecord(viewerSub, viewerName, viewerEmail);
    repairedRecord.workspaceId = homeWorkspaceId;
    repairedRecord.workspace.workspaceId = homeWorkspaceId;
    repairedRecord.workspace.title = existingRecord?.workspace?.title ?? repairedRecord.workspace.title;
    repairedRecord.createdAt = existingRecord?.createdAt ?? repairedRecord.createdAt;
    repairedRecord.updatedAt = '2026-04-02T11:00:00.000Z';
    repairedRecord.revision = (Number.isInteger(existingRecord?.revision) ? existingRecord.revision : 0) + 1;
    repairedRecord.isHomeWorkspace = true;
    return repairedRecord;
  }

  async function resolvePreferredWorkspace({ viewerSub, viewerEmail = null, viewerName = null, requestedWorkspaceId = null } = {}) {
    const normalizedRequestedWorkspaceId =
      typeof requestedWorkspaceId === 'string' && requestedWorkspaceId.trim()
        ? requestedWorkspaceId.trim()
        : null;

    if (normalizedRequestedWorkspaceId) {
      try {
        const requestedRecord = projectRecord(
          await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId: normalizedRequestedWorkspaceId }),
          { viewerSub, viewerEmail }
        );
        const requestedBoardId = resolveVisibleBoardId(requestedRecord.workspace);

        if (requestedBoardId) {
          return createResolvedWorkspaceResult(requestedRecord, {
            viewerSub,
            resolvedBoardId: requestedBoardId,
            resolution: 'requested-workspace'
          });
        }
      } catch (error) {
        if (!(error instanceof WorkspaceAccessDeniedError)) {
          throw error;
        }
      }
    } else {
      const existingHomeRecord = findExistingHomeRecord(viewerSub);

      if (existingHomeRecord) {
        const projectedHomeRecord = projectRecord(existingHomeRecord, { viewerSub, viewerEmail });
        const homeBoardId = resolveVisibleBoardId(projectedHomeRecord.workspace);

        if (homeBoardId) {
          return createResolvedWorkspaceResult(projectedHomeRecord, {
            viewerSub,
            resolvedBoardId: homeBoardId,
            resolution: 'fallback-existing-home'
          });
        }
      }
    }

    const pendingInvite = listPendingWorkspaceInvites(records.values(), { viewerSub, viewerEmail })
      .sort(compareInviteSummaries)[0] ?? null;

    if (pendingInvite) {
      const inviteRecord = projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId: pendingInvite.workspaceId }),
        { viewerSub, viewerEmail }
      );

      if (inviteRecord.workspace.boards?.[pendingInvite.boardId]) {
        return createResolvedWorkspaceResult(inviteRecord, {
          viewerSub,
          resolvedBoardId: pendingInvite.boardId,
          resolution: 'fallback-pending-invite'
        });
      }
    }

    const accessibleBoardCandidates = [];

    for (const record of records.values()) {
      const projectedRecord = projectRecord(record, { viewerSub, viewerEmail });

      if (projectedRecord.workspaceId === createHomeWorkspaceId(viewerSub)) {
        continue;
      }

      for (const boardId of projectedRecord.workspace.boardOrder ?? []) {
        const board = projectedRecord.workspace.boards?.[boardId];
        const membership = board?.collaboration?.memberships?.find((entry) => entry?.actor?.id === viewerSub);

        if (!board?.title || !membership?.role) {
          continue;
        }

        accessibleBoardCandidates.push({
          record: projectedRecord,
          workspaceId: projectedRecord.workspaceId,
          boardId,
          workspaceCreatedAt: projectedRecord.createdAt ?? '',
          boardCreatedAt: board.createdAt ?? ''
        });
      }
    }

    accessibleBoardCandidates.sort(compareAccessibleBoardCandidates);

    if (accessibleBoardCandidates.length > 0) {
      const firstCandidate = accessibleBoardCandidates[0];

      return createResolvedWorkspaceResult(firstCandidate.record, {
        viewerSub,
        resolvedBoardId: firstCandidate.boardId,
        resolution: 'fallback-accessible-board'
      });
    }

    if (normalizedRequestedWorkspaceId) {
      const existingHomeRecord = findExistingHomeRecord(viewerSub);

      if (existingHomeRecord) {
        const projectedHomeRecord = projectRecord(existingHomeRecord, { viewerSub, viewerEmail });
        const homeBoardId = resolveVisibleBoardId(projectedHomeRecord.workspace);

        if (homeBoardId) {
          return createResolvedWorkspaceResult(projectedHomeRecord, {
            viewerSub,
            resolvedBoardId: homeBoardId,
            resolution: 'fallback-existing-home'
          });
        }
      }
    }

    const existingHomeRecord = findExistingHomeRecord(viewerSub);

    if (!existingHomeRecord) {
      const createdHomeRecord = await loadFullRecord({ viewerSub, viewerEmail, viewerName });
      const projectedHomeRecord = projectRecord(createdHomeRecord, { viewerSub, viewerEmail });

      return createResolvedWorkspaceResult(projectedHomeRecord, {
        viewerSub,
        resolvedBoardId: resolveVisibleBoardId(projectedHomeRecord.workspace),
        resolution: 'fallback-created-home'
      });
    }

    const repairedHomeRecord = repairHomeRecord(existingHomeRecord, viewerSub, viewerName, viewerEmail);
    records.set(repairedHomeRecord.workspaceId, structuredClone(repairedHomeRecord));
    const projectedRepairedHomeRecord = projectRecord(repairedHomeRecord, { viewerSub, viewerEmail });

    return createResolvedWorkspaceResult(projectedRepairedHomeRecord, {
      viewerSub,
      resolvedBoardId: resolveVisibleBoardId(projectedRepairedHomeRecord.workspace),
      resolution: 'fallback-repaired-home'
    });
  }

  async function loadFullRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
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
    const existingHomeRecord = findExistingHomeRecord(viewerSub);

    if (existingHomeRecord) {
      return createWorkspaceRecord(existingHomeRecord);
    }

    if (!records.has(homeWorkspaceId)) {
      records.set(homeWorkspaceId, createHomeRecord(viewerSub, viewerName, viewerEmail));
    }

    return createWorkspaceRecord(records.get(homeWorkspaceId));
  }

  async function loadRecordForSuperAdminTitleManagement(workspaceId) {
    const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    const record = normalizedWorkspaceId ? records.get(normalizedWorkspaceId) : null;

    if (!record) {
      throw new WorkspaceAccessDeniedError();
    }

    return createWorkspaceRecord(record);
  }

  async function loadRecordForSuperAdminBoardRoleAssignment(workspaceId) {
    const normalizedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : '';
    const record = normalizedWorkspaceId ? records.get(normalizedWorkspaceId) : null;

    if (!record) {
      throw new WorkspaceAccessDeniedError();
    }

    return createWorkspaceRecord(record);
  }

  return {
    loadCalls: [],
    resolveCalls: [],
    loadAuthoritativeCalls: [],
    loadSuperAdminTitleManagementCalls: [],
    loadSuperAdminBoardRoleAssignmentCalls: [],
    createWorkspaceForSuperAdminCalls: [],
    replaceCalls: [],
    replaceRecordCalls: [],
    importCalls: [],

    async loadOrCreateWorkspaceRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
      this.loadCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId
      });

      return projectRecord(
        await loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId }),
        { viewerSub, viewerEmail }
      );
    },

    async resolvePreferredWorkspaceForViewer({
      viewerSub,
      viewerEmail = null,
      viewerName = null,
      requestedWorkspaceId = null
    } = {}) {
      this.resolveCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        requestedWorkspaceId
      });

      return resolvePreferredWorkspace({
        viewerSub,
        viewerEmail,
        viewerName,
        requestedWorkspaceId
      });
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null } = {}) {
      this.loadAuthoritativeCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId
      });

      return loadFullRecord({ viewerSub, viewerEmail, viewerName, workspaceId });
    },

    async createWorkspaceForSuperAdmin({
      viewerIsSuperAdmin = false,
      viewerSub,
      viewerEmail = null,
      viewerName = null,
      title = undefined
    } = {}) {
      this.createWorkspaceForSuperAdminCalls.push({
        viewerIsSuperAdmin,
        viewerSub,
        viewerEmail,
        viewerName,
        title
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceCreationPermissionError('Workspace creation is only available to super admins.');
      }

      const workspaceId = `workspace_created_${this.createWorkspaceForSuperAdminCalls.length}`;
      const record = createInitialWorkspaceRecord(viewerSub, {
        workspaceId,
        title: typeof title === 'string' && title.trim()
          ? title.trim()
          : `${typeof viewerName === 'string' && viewerName.trim() ? viewerName.trim() : 'Workspace'} 1`,
        now: '2026-04-02T10:00:00.000Z',
        creator: {
          email: viewerEmail,
          displayName: viewerName
        }
      });

      record.isHomeWorkspace = false;
      records.set(workspaceId, structuredClone(record));
      return createWorkspaceRecord(record);
    },

    async loadWorkspaceRecordForSuperAdminTitleManagement({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.loadSuperAdminTitleManagementCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceTitleManagementPermissionError();
      }

      return loadRecordForSuperAdminTitleManagement(workspaceId);
    },

    async loadWorkspaceRecordForSuperAdminBoardRoleAssignment({ viewerIsSuperAdmin = false, workspaceId } = {}) {
      this.loadSuperAdminBoardRoleAssignmentCalls.push({
        viewerIsSuperAdmin,
        workspaceId
      });

      if (viewerIsSuperAdmin !== true) {
        throw new WorkspaceBoardRoleAssignmentPermissionError();
      }

      return loadRecordForSuperAdminBoardRoleAssignment(workspaceId);
    },

    async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null } = {}) {
      return listPendingWorkspaceInvites(records.values(), { viewerSub, viewerEmail });
    },

    async listAccessibleWorkspacesForViewer({ viewerSub, viewerEmail = null, viewerName = null, excludeWorkspaceId = null } = {}) {
      await loadFullRecord({ viewerSub, viewerEmail, viewerName });
      return listAccessibleWorkspaces(records.values(), { viewerSub, viewerEmail, excludeWorkspaceId });
    },

    async replaceWorkspaceSnapshot({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null, workspace, actor, expectedRevision }) {
      this.replaceCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId,
        workspace,
        expectedRevision,
        actor
      });

      const currentRecord =
        await this.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub,
          viewerEmail,
          viewerName,
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

    async importWorkspaceSnapshot({ viewerSub, viewerEmail = null, viewerName = null, workspaceId = null, workspace, actor }) {
      this.importCalls.push({
        viewerSub,
        viewerEmail,
        viewerName,
        workspaceId,
        workspace,
        actor
      });

      const currentRecord =
        await this.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub,
          viewerEmail,
          viewerName,
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

function createPortfolioReadModelDouble({
  summary = {
    totals: {
      workspaces: 0,
      boards: 0,
      cards: 0,
      cardsMissingRequiredLocales: 0,
      openLocaleRequestCount: 0,
      awaitingHumanVerificationCount: 0,
      agentProposalCount: 0,
      pendingCardReviewCount: 0
    },
    workspaces: [],
    boardDirectory: [],
    pendingCardReviewItems: []
  }
} = {}) {
  return {
    loadCalls: [],

    async loadPortfolioSummary(options = {}) {
      this.loadCalls.push(structuredClone(options));
      return structuredClone(summary);
    }
  };
}

function createPendingCardReviewPortfolioSummary() {
  return {
    totals: {
      workspaces: 1,
      boards: 1,
      cards: 2,
      cardsMissingRequiredLocales: 0,
      openLocaleRequestCount: 0,
      awaitingHumanVerificationCount: 0,
      agentProposalCount: 0,
      pendingCardReviewCount: 1
    },
    workspaces: [
      {
        workspaceId: 'workspace_portfolio_reviews',
        workspaceTitle: 'Studio HQ',
        boardCount: 1,
        timestamps: {
          createdAt: '2026-04-01T09:00:00.000Z',
          updatedAt: '2026-04-03T12:00:00.000Z'
        }
      }
    ],
    boardDirectory: [
      {
        workspaceId: 'workspace_portfolio_reviews',
        workspaceTitle: 'Studio HQ',
        boardId: 'main',
        boardTitle: 'Editorial roadmap',
        viewerRole: 'editor',
        localePolicy: {
          sourceLocale: 'en',
          defaultLocale: 'en',
          supportedLocales: ['en'],
          requiredLocales: ['en']
        },
        cardCounts: {
          total: 2,
          byStage: null
        },
        localizationSummary: {
          cardsMissingRequiredLocales: 0,
          openLocaleRequestCount: 0,
          awaitingHumanVerificationCount: 0,
          agentProposalCount: 0,
          pendingCardReviewCount: 1
        },
        aging: {
          oldestMissingRequiredLocaleUpdatedAt: null,
          oldestOpenLocaleRequestAt: null,
          oldestAwaitingHumanVerificationAt: null,
          oldestAgentProposalAt: null
        },
        timestamps: {
          workspaceCreatedAt: '2026-04-01T09:00:00.000Z',
          workspaceUpdatedAt: '2026-04-03T12:00:00.000Z',
          boardCreatedAt: '2026-04-01T09:05:00.000Z',
          boardUpdatedAt: '2026-04-03T11:45:00.000Z'
        }
      }
    ],
    awaitingHumanVerificationItems: [],
    agentProposalItems: [],
    pendingCardReviewItems: [
      {
        workspaceId: 'workspace_portfolio_reviews',
        workspaceTitle: 'Studio HQ',
        boardId: 'main',
        boardTitle: 'Editorial roadmap',
        cardId: 'card_pending_review',
        cardTitle: 'Approve launch brief',
        cardUpdatedAt: '2026-04-03T10:20:00.000Z',
        stageId: 'review',
        stageTitle: 'Final review'
      }
    ],
    missingRequiredLocalizationItems: []
  };
}

function listAccessibleWorkspaces(records, { viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
  const summaries = [];
  const seenWorkspaceIds = new Set();

  for (const record of records) {
    const normalizedRecord = createWorkspaceRecord(record);
    const projectedWorkspace = filterWorkspaceForViewer({
      viewerSub,
      viewerEmail,
      ownerSub: normalizedRecord.viewerSub,
      workspace: normalizedRecord.workspace
    });
    const boards = [];

    for (const boardId of projectedWorkspace.boardOrder ?? []) {
      const board = projectedWorkspace.boards?.[boardId];
      const membership = board?.collaboration?.memberships?.find((entry) => entry?.actor?.id === viewerSub);

      if (!board?.title || !membership?.role) {
        continue;
      }

      boards.push({
        boardId,
        boardTitle: board.title,
        role: membership.role
      });
    }

    if (
      !normalizedRecord.workspaceId
      || normalizedRecord.workspaceId === excludeWorkspaceId
      || boards.length === 0
      || seenWorkspaceIds.has(normalizedRecord.workspaceId)
    ) {
      continue;
    }

    seenWorkspaceIds.add(normalizedRecord.workspaceId);
    summaries.push({
      workspaceId: normalizedRecord.workspaceId,
      workspaceTitle:
        typeof projectedWorkspace?.title === 'string' && projectedWorkspace.title.trim()
          ? projectedWorkspace.title.trim()
          : null,
      isHomeWorkspace: normalizedRecord.workspaceId === createHomeWorkspaceId(viewerSub),
      boards
    });
  }

  return summaries.sort((left, right) => {
    if (left.isHomeWorkspace && !right.isHomeWorkspace) {
      return -1;
    }

    if (!left.isHomeWorkspace && right.isHomeWorkspace) {
      return 1;
    }

    return left.workspaceId.localeCompare(right.workspaceId);
  });
}

function createSharedWorkspaceRecordFixture(
  workspaceId,
  {
    workspaceTitle = null,
    viewerSub = 'sub_owner',
    memberSub = 'sub_member',
    memberEmail = 'member@example.com',
    memberRole = 'viewer',
    memberBoardId = 'member',
    memberBoardTitle = 'Member board',
    includeInvite = true
  } = {}
) {
  let workspace = createCard(
    createEmptyWorkspace({
      workspaceId,
      creator: {
        type: 'human',
        id: viewerSub,
        email: 'owner@example.com'
      }
    }),
    'main',
    {
      title: 'Owner board card',
      detailsMarkdown: 'Hidden from the collaborator.',
      priority: 'important'
    }
  );

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: viewerSub, email: 'owner@example.com' },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  workspace = addSharedBoard(workspace, memberBoardId, memberBoardTitle, {
    memberships: [
      {
        actor: { type: 'human', id: memberSub, email: memberEmail },
        role: memberRole,
        joinedAt: '2026-04-02T10:05:00.000Z'
      }
    ],
    card: {
      title: `${memberBoardTitle} card`,
      detailsMarkdown: 'Visible to the collaborator.',
      priority: 'urgent'
    }
  });

  if (includeInvite) {
    workspace = addSharedBoard(workspace, 'invite', 'Invite board', {
      invites: [
        {
          id: 'invite_1',
          email: memberEmail,
          role: 'viewer',
          status: 'pending',
          invitedBy: { type: 'human', id: viewerSub, email: 'owner@example.com' },
          invitedAt: '2026-04-02T10:15:00.000Z'
        }
      ],
      card: {
        title: 'Invite board card',
        detailsMarkdown: 'Should be redacted until the invite is accepted.',
        priority: 'normal'
      }
    });
  }

  workspace.boardOrder = includeInvite ? ['main', memberBoardId, 'invite'] : ['main', memberBoardId];
  workspace.ui.activeBoardId = 'main';
  workspace.title = workspaceTitle;

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord(viewerSub, {
      workspaceId,
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: viewerSub },
      now: '2026-04-02T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function createCrossWorkspaceInviteRecordFixture(
  workspaceId,
  {
    viewerSub = 'sub_123',
    viewerEmail = 'member@example.com',
    inviteStatus = 'pending'
  } = {}
) {
  const ownerActor = {
    type: 'human',
    id: 'sub_owner_casa',
    email: 'owner-casa@example.com',
    displayName: 'Casa owner'
  };
  let workspace = createEmptyWorkspace({
    workspaceId,
    creator: ownerActor
  });

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: ownerActor,
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspaceId}_casa`,
    creator: ownerActor
  }).boards.main;
  const invitedBoard = structuredClone(sourceBoard);
  invitedBoard.id = 'casa';
  invitedBoard.title = 'Casa';
  invitedBoard.collaboration.memberships = [];
  invitedBoard.collaboration.invites = [
    {
      id: 'invite_casa_1',
      actor: { type: 'human', id: viewerSub },
      email: viewerEmail,
      role: 'editor',
      status: inviteStatus,
      invitedBy: ownerActor,
      invitedAt: '2026-04-02T10:20:00.000Z'
    }
  ];
  workspace.boards.casa = invitedBoard;
  workspace.boardOrder = ['main', 'casa'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord('sub_owner_casa', {
      workspaceId,
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: 'sub_owner_casa' },
      now: '2026-04-02T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function addSharedBoard(workspace, boardId, title, { memberships = [], invites = [], card = null } = {}) {
  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspace.workspaceId}_${boardId}`,
    creator: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    }
  }).boards.main;
  const board = structuredClone(sourceBoard);

  board.id = boardId;
  board.title = title;
  board.collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  board.collaboration.invites = invites.map((invite) => structuredClone(invite));
  workspace.boards[boardId] = board;

  if (card) {
    return createCard(workspace, boardId, card);
  }

  return workspace;
}

function listPendingWorkspaceInvites(records, { viewerSub, viewerEmail = null } = {}) {
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const inviteSummaries = [];
  const seenInviteKeys = new Set();

  for (const record of records) {
    const workspace = createWorkspaceRecord(record).workspace;

    for (const [boardId, board] of Object.entries(workspace.boards ?? {})) {
      const invites = Array.isArray(board?.collaboration?.invites) ? board.collaboration.invites : [];

      for (const invite of invites) {
        if (invite?.status !== 'pending') {
          continue;
        }

        const matchesViewer =
          (typeof invite?.actor?.id === 'string' && invite.actor.id.trim() === viewerSub) ||
          (normalizeOptionalEmail(invite?.email) && normalizeOptionalEmail(invite.email) === normalizedViewerEmail);

        if (!matchesViewer) {
          continue;
        }

        const summary = {
          workspaceId: record.workspaceId,
          boardId,
          boardTitle: board.title,
          inviteId: invite.id,
          role: invite.role,
          invitedAt: invite.invitedAt,
          invitedBy: {
            id: invite.invitedBy?.id ?? null,
            email: invite.invitedBy?.email ?? null,
            displayName: invite.invitedBy?.displayName ?? invite.invitedBy?.name ?? null
          }
        };
        const inviteKey = `${summary.workspaceId}:${summary.boardId}:${summary.inviteId}`;

        if (seenInviteKeys.has(inviteKey)) {
          continue;
        }

        seenInviteKeys.add(inviteKey);
        inviteSummaries.push(summary);
      }
    }
  }

  return inviteSummaries;
}

function compareInviteSummaries(left, right) {
  const invitedAtComparison = String(left?.invitedAt ?? '').localeCompare(String(right?.invitedAt ?? ''));

  if (invitedAtComparison !== 0) {
    return invitedAtComparison;
  }

  const workspaceComparison = String(left?.workspaceId ?? '').localeCompare(String(right?.workspaceId ?? ''));

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  const boardComparison = String(left?.boardId ?? '').localeCompare(String(right?.boardId ?? ''));

  if (boardComparison !== 0) {
    return boardComparison;
  }

  return String(left?.inviteId ?? '').localeCompare(String(right?.inviteId ?? ''));
}

function compareAccessibleBoardCandidates(left, right) {
  const workspaceCreatedAtComparison = String(left?.workspaceCreatedAt ?? '').localeCompare(String(right?.workspaceCreatedAt ?? ''));

  if (workspaceCreatedAtComparison !== 0) {
    return workspaceCreatedAtComparison;
  }

  const boardCreatedAtComparison = String(left?.boardCreatedAt ?? '').localeCompare(String(right?.boardCreatedAt ?? ''));

  if (boardCreatedAtComparison !== 0) {
    return boardCreatedAtComparison;
  }

  const workspaceComparison = String(left?.workspaceId ?? '').localeCompare(String(right?.workspaceId ?? ''));

  if (workspaceComparison !== 0) {
    return workspaceComparison;
  }

  return String(left?.boardId ?? '').localeCompare(String(right?.boardId ?? ''));
}

function normalizeOptionalEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
