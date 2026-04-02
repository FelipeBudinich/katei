import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCapturedArtifacts } from '../scripts/lib/artifacts.mjs';
import { extractCookieValueFromSetCookieHeaders } from '../scripts/lib/auth.mjs';
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
  assert.equal(config.auth.cookieName, 'katei_session');
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
