import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCapturedArtifacts } from '../scripts/lib/artifacts.mjs';
import {
  buildEditedStageDefinitions,
  createBoardLifecycleTitles,
  findBoardByTitle,
  summarizeWorkspaceBoards
} from '../scripts/lib/board_lifecycle.mjs';
import { extractCookieValueFromSetCookieHeaders, resolveDebugAuthSecret } from '../scripts/lib/auth.mjs';
import { loadKateiAuthDebugConfig } from '../scripts/lib/config.mjs';

test('loadKateiAuthDebugConfig applies defaults for debug-route auth', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katei-auth-debug-config-'));
  const configPath = path.join(tempDir, 'config.json');

  await fs.writeFile(configPath, JSON.stringify({
    baseUrl: 'https://katei.example.com',
    page: {
      waitForSelector: '[data-controller="workspace"]'
    }
  }));

  const config = await loadKateiAuthDebugConfig({ configPath });

  assert.equal(config.baseUrl, 'https://katei.example.com');
  assert.equal(config.startPath, '/boards');
  assert.equal(config.auth.mode, 'debug-route');
  assert.equal(config.auth.debugLoginPath, '/__debug/login');
  assert.equal(config.auth.secretKeychainService, 'katei-auth-debug');
  assert.equal(config.auth.secretKeychainAccount, 'katei.example.com');
  assert.equal(config.auth.cookieName, 'katei_session');
  assert.equal(config.boardLifecycle.titlePrefix, 'Codex Board Smoke');
  assert.equal(config.boardLifecycle.editedTitleSuffix, 'Edited');
  assert.deepEqual(config.boardLifecycle.supportedLocales, ['en']);
  assert.deepEqual(config.boardLifecycle.requiredLocales, ['en']);
  assert.match(config.boardLifecycle.stageDefinitions[0], /backlog \| Backlog/);
  assert.equal(config.page.inspectSelectors.workspaceRoot.selector, '[data-controller="workspace"]');
});

test('loadKateiAuthDebugConfig preserves explicit cookie auth mode', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katei-auth-debug-config-cookie-'));
  const configPath = path.join(tempDir, 'config.json');

  await fs.writeFile(configPath, JSON.stringify({
    baseUrl: 'https://katei.example.com',
    auth: {
      mode: 'cookie',
      cookieEnvVar: 'CUSTOM_SESSION_COOKIE'
    },
    page: {
      waitForSelector: '#app'
    }
  }));

  const config = await loadKateiAuthDebugConfig({ configPath });

  assert.equal(config.auth.mode, 'cookie');
  assert.equal(config.auth.cookieEnvVar, 'CUSTOM_SESSION_COOKIE');
  assert.equal(config.page.waitForSelector, '#app');
});

test('loadKateiAuthDebugConfig preserves explicit board lifecycle config', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'katei-auth-debug-board-lifecycle-'));
  const configPath = path.join(tempDir, 'config.json');

  await fs.writeFile(configPath, JSON.stringify({
    baseUrl: 'https://katei.example.com',
    boardLifecycle: {
      titlePrefix: 'Hosted smoke',
      editedTitleSuffix: 'Updated',
      sourceLocale: 'es',
      defaultLocale: 'es',
      supportedLocales: ['es', 'en'],
      requiredLocales: ['es'],
      stageDefinitions: [
        'draft | Draft | review',
        'review | Review | draft'
      ]
    },
    page: {
      waitForSelector: '[data-controller="workspace"]'
    }
  }));

  const config = await loadKateiAuthDebugConfig({ configPath });

  assert.equal(config.boardLifecycle.titlePrefix, 'Hosted smoke');
  assert.equal(config.boardLifecycle.editedTitleSuffix, 'Updated');
  assert.equal(config.boardLifecycle.sourceLocale, 'es');
  assert.deepEqual(config.boardLifecycle.supportedLocales, ['es', 'en']);
  assert.deepEqual(config.boardLifecycle.requiredLocales, ['es']);
  assert.deepEqual(config.boardLifecycle.stageDefinitions, [
    'draft | Draft | review',
    'review | Review | draft'
  ]);
});

test('resolveDebugAuthSecret prefers the environment variable when present', async () => {
  const secret = await resolveDebugAuthSecret({
    config: {
      auth: {
        secretEnvVar: 'KATEI_DEBUG_AUTH_SECRET',
        secretKeychainService: 'katei-auth-debug',
        secretKeychainAccount: 'katei.example.com'
      }
    },
    env: {
      KATEI_DEBUG_AUTH_SECRET: 'env-secret'
    },
    execFileImpl: async () => {
      throw new Error('keychain should not be queried when env is present');
    }
  });

  assert.equal(secret, 'env-secret');
});

test('resolveDebugAuthSecret falls back to macOS Keychain when env is missing', async () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin'
  });

  try {
    const secret = await resolveDebugAuthSecret({
      config: {
        auth: {
          secretEnvVar: 'KATEI_DEBUG_AUTH_SECRET',
          secretKeychainService: 'katei-auth-debug',
          secretKeychainAccount: 'katei.example.com'
        }
      },
      env: {},
      execFileImpl: async (command, args) => {
        assert.equal(command, 'security');
        assert.deepEqual(args, [
          'find-generic-password',
          '-w',
          '-s',
          'katei-auth-debug',
          '-a',
          'katei.example.com'
        ]);

        return {
          stdout: 'keychain-secret\n'
        };
      }
    });

    assert.equal(secret, 'keychain-secret');
  } finally {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

test('extractCookieValueFromSetCookieHeaders finds a katei_session value', () => {
  const cookieValue = extractCookieValueFromSetCookieHeaders([
    'other_cookie=abc123; Path=/; HttpOnly',
    'katei_session=session-token-value; Path=/; HttpOnly; SameSite=Lax'
  ], 'katei_session');

  assert.equal(cookieValue, 'session-token-value');
});

test('normalizeCapturedArtifacts returns stable arrays and selector snapshots', () => {
  const artifacts = normalizeCapturedArtifacts({
    consoleEntries: [{ text: 'hello', type: 'log' }],
    pageErrors: null,
    failedRequests: [{ errorText: 'net::ERR_ABORTED', type: 'Fetch' }],
    selectorSnapshots: {
      workspaceRoot: {
        selector: '[data-controller="workspace"]',
        count: 1,
        visible: true,
        text: 'Debug board'
      },
      empty: null
    }
  });

  assert.deepEqual(artifacts.consoleEntries, [{ text: 'hello', type: 'log' }]);
  assert.deepEqual(artifacts.pageErrors, []);
  assert.deepEqual(artifacts.failedRequests, [{ errorText: 'net::ERR_ABORTED', type: 'Fetch' }]);
  assert.deepEqual(artifacts.selectorSnapshots.empty, {
    selector: '',
    count: 0,
    visible: false,
    text: ''
  });
  assert.deepEqual(artifacts.selectorSnapshots.workspaceRoot, {
    selector: '[data-controller="workspace"]',
    count: 1,
    visible: true,
    text: 'Debug board'
  });
});

test('createBoardLifecycleTitles returns deterministic create and edited titles', () => {
  const titles = createBoardLifecycleTitles(
    {
      titlePrefix: 'Hosted smoke',
      editedTitleSuffix: 'Updated'
    },
    {
      now: new Date('2026-04-02T19:21:00.000Z')
    }
  );

  assert.equal(titles.createdTitle, 'Hosted smoke 20260402192100');
  assert.equal(titles.editedTitle, 'Hosted smoke 20260402192100 Updated');
});

test('buildEditedStageDefinitions updates only the first stage title', () => {
  const nextDefinitions = buildEditedStageDefinitions([
    'draft | Draft | review',
    'review | Review | draft'
  ], 'Updated');

  assert.deepEqual(nextDefinitions, [
    'draft | Draft Updated | review',
    'review | Review | draft'
  ]);
});

test('summarizeWorkspaceBoards and findBoardByTitle expose board ids and active board state', () => {
  const workspace = {
    workspaceId: 'workspace_1',
    ui: {
      activeBoardId: 'board_2'
    },
    boardOrder: ['board_1', 'board_2'],
    boards: {
      board_1: {
        id: 'board_1',
        title: 'Alpha',
        stageOrder: ['draft'],
        stages: {
          draft: {
            title: 'Draft'
          }
        }
      },
      board_2: {
        id: 'board_2',
        title: 'Beta',
        stageOrder: ['review'],
        stages: {
          review: {
            title: 'Review'
          }
        }
      }
    }
  };

  assert.deepEqual(summarizeWorkspaceBoards(workspace), {
    workspaceId: 'workspace_1',
    activeBoardId: 'board_2',
    boardOrder: ['board_1', 'board_2'],
    boards: [
      {
        id: 'board_1',
        title: 'Alpha',
        stageOrder: ['draft'],
        stageTitles: [
          {
            id: 'draft',
            title: 'Draft'
          }
        ]
      },
      {
        id: 'board_2',
        title: 'Beta',
        stageOrder: ['review'],
        stageTitles: [
          {
            id: 'review',
            title: 'Review'
          }
        ]
      }
    ]
  });
  assert.deepEqual(findBoardByTitle(workspace, 'Beta'), {
    id: 'board_2',
    title: 'Beta',
    stageOrder: ['review'],
    stageTitles: [
      {
        id: 'review',
        title: 'Review'
      }
    ]
  });
});
