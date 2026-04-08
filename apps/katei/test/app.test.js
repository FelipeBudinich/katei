import test from 'node:test';
import assert from 'node:assert/strict';
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
        agentProposalCount: 1
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

  const response = await request(app)
    .get('/portfolio')
    .set('Cookie', createSessionCookieHeader({
      sub: 'sub_123',
      name: 'Tester',
      email: 'tester@example.com'
    }));

  assert.equal(response.status, 200);
  assert.match(response.text, /<title>過程 \(katei\) · Portfolio<\/title>/);
  assert.match(response.text, /Super admin portfolio/);
  assert.match(response.text, /Back to boards/);
  assert.match(response.text, /Summary/);
  assert.match(response.text, /Board directory/);
  assert.match(response.text, /Search portfolio/);
  assert.match(response.text, /Executive roadmap/);
  assert.match(response.text, /workspace_portfolio_alpha/);
  assert.match(response.text, /1 matching boards/);
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
  assert.match(response.text, /<section class="portfolio-hero paper-panel grid gap-4 px-5 py-4">/);
  assert.match(response.text, /<header class="top-bar border-0 bg-transparent px-0 py-0 shadow-none">/);
  assert.match(response.text, /<div class="top-bar-heading-group items-start">/);
  assert.match(response.text, /<p class="field-label text-sm font-semibold">Super admin portfolio<\/p>/);
  assert.match(response.text, /<h1 class="top-bar-title font-serif text-3xl leading-tight text-strong">Portfolio<\/h1>/);
  assert.match(response.text, /<div class="top-bar-actions">/);
  assert.match(response.text, /data-action="portfolio#openProfileOptions"/);
  assert.match(
    response.text,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="portfolio#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.doesNotMatch(response.text, /class="portfolio-header"/);
  assert.doesNotMatch(response.text, /class="portfolio-actions"/);
  assert.match(response.text, /class="portfolio-workspace-group portfolio-directory-card paper-panel"/);
  assert.ok(countMatches(response.text, /class="portfolio-workspace-group paper-panel"/g) >= 7);
  assert.match(response.text, /href="\/boards\?workspaceId=workspace_portfolio_alpha&amp;boardId=main"/);
  assert.match(response.text, /Tester/);
  assert.match(response.text, /data-controller="profile-options"/);
  assert.match(response.text, /data-controller="session"/);
  assert.match(response.text, /data-session-target="logoutButton"/);
  assert.match(response.text, /session#openLogoutConfirm/);
  assert.match(response.text, /id="portfolio-ui-locale-picker"/);
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({ surface: 'portfolio' })))
  );
  assert.doesNotMatch(response.text, /data-controller="workspace"/);
  assert.doesNotMatch(response.text, /id="workspace-bootstrap"/);
  assert.deepEqual(workspaceRecordRepository.loadCalls, []);
  assert.deepEqual(portfolioReadModel.loadCalls, [{ viewerSub: 'sub_123' }]);

  const profileOptionsDialog = extractDialogHtml(response.text, 'profile-options');

  assert.match(profileOptionsDialog, /class="ui-locale-badge"/);
  assert.match(profileOptionsDialog, /<span class="ui-locale-badge-value">\s*English\s*<\/span>/);
  assert.match(
    profileOptionsDialog,
    /<form[\s\S]*?method="get"[\s\S]*?action="\/portfolio"[\s\S]*?class="ui-locale-picker ui-locale-picker--icon-menu"[\s\S]*?data-controller="ui-locale-picker"/
  );
  assert.match(profileOptionsDialog, /aria-haspopup="dialog"/);
  assert.match(profileOptionsDialog, /data-ui-locale-picker-target="dialog"/);
  assert.match(profileOptionsDialog, /class="viewer-chip"/);
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
  assert.match(response.text, /data-portfolio-target="dialog"/);
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
  assert.doesNotMatch(html, /data-portfolio-board-role-form/);
  assert.doesNotMatch(html, /My role on this board/);
  assert.doesNotMatch(html, /data-portfolio-target="dialog"/);
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
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: null,
      workspaceId: null
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
  assert.match(response.text, /data-workspace-viewer-super-admin-value="false"/);
  assert.match(response.text, />\s*Options\s*</);
  assert.match(
    response.text,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="workspace#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.match(response.text, /id="profile-options-ui-locale-picker"/);
  assert.match(
    response.text,
    /<form[\s\S]*?method="get"[\s\S]*?action="\/boards"[\s\S]*?class="ui-locale-picker ui-locale-picker--icon-menu"[\s\S]*?data-controller="ui-locale-picker"/
  );
  assert.match(response.text, /aria-haspopup="dialog"/);
  assert.match(response.text, /data-action="click->ui-locale-picker#openDialog keydown->ui-locale-picker#handleTriggerKeydown"/);
  assert.match(response.text, /class="sheet-dialog confirm-dialog"[\s\S]*?data-ui-locale-picker-target="dialog"/);
  assert.match(response.text, /click->ui-locale-picker#backdropCloseDialog cancel->ui-locale-picker#closeDialog/);
  assert.match(response.text, /class="ui-locale-modal-options mt-6"/);
  assert.match(response.text, /data-board-options-field="inviteAcceptButton"/);
  assert.match(response.text, /data-board-options-field="inviteDeclineButton"/);
  assert.match(response.text, /board-options:accept-invite->workspace#handleAcceptInvite/);
  assert.match(response.text, /board-options:decline-invite->workspace#handleDeclineInvite/);

  const boardOptionsDialog = extractDialogHtml(response.text, 'board-options');
  const boardCollaboratorsDialog = extractDialogHtml(response.text, 'board-collaborators');

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

  assert.match(response.text, /data-controller="profile-options"/);
  assert.match(response.text, /profile-options-locale-slot/);
  assert.match(response.text, /viewer-chip/);
  assert.match(response.text, /data-controller="session"/);
  assert.match(response.text, /data-session-target="logoutButton"/);
  assert.match(response.text, /session#openLogoutConfirm/);
  assert.match(response.text, /class="sheet-dialog confirm-dialog"/);
  assert.match(response.text, /data-session-target="confirmDialog"/);
  assert.match(response.text, /click->session#backdropCloseConfirmDialog cancel->session#closeConfirmDialog/);
  assert.match(response.text, /data-session-target="confirmTitle"/);
  assert.match(response.text, /data-session-target="confirmMessage"/);
  assert.match(response.text, /data-session-target="confirmButton"/);
  assert.match(response.text, /session#confirmLogout/);
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

test('GET /boards redirects super-admin drill-downs back to /portfolio when the requested workspace no longer exists', async () => {
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble();
  const app = createTestApp({
    env: {
      SUPER_ADMINS: 'tester@example.com'
    },
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
  assert.equal(response.headers.location, '/portfolio');
  assert.match(
    findSetCookie(response, KATEI_LAST_SURFACE_COOKIE_NAME) ?? '',
    new RegExp(escapeForRegex(createLastSurfaceCookieValue({ surface: 'portfolio' })))
  );
  assert.deepEqual(workspaceRecordRepository.loadCalls, [
    {
      viewerSub: 'sub_123',
      viewerEmail: 'tester@example.com',
      workspaceId: 'workspace_missing_board_target'
    }
  ]);
});

test('GET /boards renders the Portfolio action in board options for super admins', async () => {
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
    new RegExp(`data-workspace-target="workspaceLabel">\\s*${escapeForRegex(createHomeWorkspaceId('sub_123'))}\\s*<`)
  );
  assert.match(response.text, /board-options:open-portfolio->workspace#openPortfolio/);
  assert.match(response.text, /board-options:board-self-role-updated->workspace#handleBoardSelfRoleUpdated/);
  assert.match(boardOptionsDialog, /data-board-options-field="workspaceTitleButton"/);
  assert.match(boardOptionsDialog, /board-options#openRenameDialog/);
  assert.match(boardOptionsDialog, /data-board-options-target="workspaceTitleEditor"/);
  assert.match(boardOptionsDialog, />\s*Edit workspace title\s*</);
  assert.match(boardOptionsDialog, /data-board-options-target="selfRoleSection"/);
  assert.match(boardOptionsDialog, /data-board-options-target="selfRoleSelect"/);
  assert.match(boardOptionsDialog, />\s*My role on this board\s*</);
  assert.match(boardOptionsDialog, />\s*Save role\s*</);
  assert.match(boardOptionsDialog, /data-board-options-field="portfolioButton"/);
  assert.match(boardOptionsDialog, /board-options#openPortfolio/);
  assert.match(boardOptionsDialog, />\s*Open portfolio\s*</);
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
  board.stages.backlog.cardIds = [cardId];
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
      `<header\\s+class="card-item-toolbar"[\\s\\S]*?data-action="click->workspace#openViewFromToolbar keydown->workspace#openViewFromToolbarKeydown"[\\s\\S]*?data-card-id="${escapeForRegex(cardId)}"[\\s\\S]*?data-stage-id="backlog"[\\s\\S]*?data-column-id="backlog"[\\s\\S]*?role="button"[\\s\\S]*?tabindex="0"[\\s\\S]*?aria-label="カードを表示"`
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
  board.stages.backlog.cardIds = [cardId];
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
  board.stages.backlog.cardIds = [cardId];
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

test('workspace template renders the no-board header with both Options and Profile entry points', () => {
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
  assert.match(html, />\s*Options\s*</);
  assert.match(
    html,
    /class="touch-button-secondary touch-button-secondary--icon"[\s\S]*?data-action="workspace#openProfileOptions"[\s\S]*?aria-label="Profile"[\s\S]*?<img src="\/profile\.svg" alt="" aria-hidden="true" class="touch-button-secondary__icon">/
  );
  assert.match(html, /id="profile-options-ui-locale-picker"/);
  assert.match(html, /data-controller="profile-options"/);
  assert.doesNotMatch(html, /ui-locale-badge/);
  assert.match(
    html,
    /<form[\s\S]*?method="get"[\s\S]*?action="\/boards"[\s\S]*?class="ui-locale-picker ui-locale-picker--icon-menu"[\s\S]*?data-controller="ui-locale-picker"/
  );
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /data-ui-locale-picker-target="dialog"/);
  assert.match(html, /class="ui-locale-modal-options mt-6"/);
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
  assert.match(
    profileOptionsDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-profile-options-initial-focus[\s\S]*?data-action="profile-options#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
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
  assert.doesNotMatch(cardEditorDialog, /Localized content/);
  assert.doesNotMatch(cardEditorDialog, /data-controller="accordion"/);
  assert.doesNotMatch(cardEditorDialog, /data-accordion-/);
  assert.doesNotMatch(cardEditorDialog, /Available localizations/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="localeStatusRegion"/);
  assert.doesNotMatch(cardEditorDialog, /data-card-editor-target="localeStatusTemplate"/);
  assert.match(
    cardEditorDialog,
    /class="touch-button-secondary touch-button-secondary--icon touch-button-secondary--close"[\s\S]*?aria-label="Close"[\s\S]*?data-action="card-editor#close"[\s\S]*?<span class="sr-only">Close<\/span>/
  );
  assert.doesNotMatch(cardEditorDialog, /data-action="card-editor#closeForAction workspace#deleteCard"/);
  assert.doesNotMatch(cardEditorDialog, /class="touch-button-danger"/);

  assert.match(
    cardViewDialog,
    /data-workspace-target="viewCardPrioritySection"[\s\S]*data-workspace-target="viewDeleteButton"[\s\S]*data-workspace-target="viewPromptRunButton"[\s\S]*data-workspace-target="viewLocaleSection"[\s\S]*id="card-view-locale-trigger"[\s\S]*data-workspace-target="viewLocaleButton"[\s\S]*id="card-view-locale-menu"[\s\S]*data-workspace-target="viewLocaleMenu"[\s\S]*id="card-view-locale-select"[\s\S]*data-workspace-target="viewLocaleSelect"[\s\S]*data-workspace-target="viewCopyButton"[\s\S]*data-workspace-target="viewEditButton"[\s\S]*data-workspace-target="viewCardTitle"[\s\S]*data-workspace-target="viewCardBody"[\s\S]*data-workspace-target="viewActionRegion"/
  );
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
  const workspaceRecordRepository = createWorkspaceRecordRepositoryDouble([
    createCrossWorkspaceInviteRecordFixture('workspace_invited_casa')
  ]);
  const app = createTestApp({
    googleTokenVerifier: async () => ({ sub: 'sub_123' }),
    workspaceRecordRepository
  });

  const boardsResponse = await request(app)
    .get('/boards')
    .set('Cookie', createSessionCookieHeader({ sub: 'sub_123', email: 'member@example.com', name: 'Tester' }));
  const apiResponse = await request(app)
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
  assert.deepEqual(bootstrapPayload.accessibleWorkspaces, []);
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
  assert.deepEqual(accessibleBootstrap.accessibleWorkspaces, [
    {
      workspaceId: createHomeWorkspaceId('sub_collab'),
      workspaceTitle: null,
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
  assert.match(response.text, /aria-label="カードを追加"/);
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
    workspaceTitle: null,
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
  const [cardId] = memberBoard.stages.backlog.cardIds;

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
    'ja',
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
  board.stages.backlog.cardIds = [cardId];

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
  board.stages.backlog.cardIds = [cardId];
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
  const match = html.match(
    new RegExp(
      `<dialog[\\s\\S]*?data-controller="${escapeForRegex(controllerName)}"[\\s\\S]*?<\\/dialog>`
    )
  );

  if (!match) {
    throw new Error(`Dialog for controller "${controllerName}" was not rendered.`);
  }

  return match[0];
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
    loadAuthoritativeCalls: [],
    loadSuperAdminTitleManagementCalls: [],
    loadSuperAdminBoardRoleAssignmentCalls: [],
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
      this.loadAuthoritativeCalls.push({
        viewerSub,
        viewerEmail,
        workspaceId
      });

      return loadFullRecord({ viewerSub, viewerEmail, workspaceId });
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

    async listAccessibleWorkspacesForViewer({ viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
      await loadFullRecord({ viewerSub, viewerEmail });
      return listAccessibleWorkspaces(records.values(), { viewerSub, viewerEmail, excludeWorkspaceId });
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

function createPortfolioReadModelDouble({
  summary = {
    totals: {
      workspaces: 0,
      boards: 0,
      cards: 0,
      cardsMissingRequiredLocales: 0,
      openLocaleRequestCount: 0,
      awaitingHumanVerificationCount: 0,
      agentProposalCount: 0
    },
    workspaces: [],
    boardDirectory: []
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

function normalizeOptionalEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
