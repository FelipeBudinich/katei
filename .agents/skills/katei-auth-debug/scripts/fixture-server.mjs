#!/usr/bin/env node

import { createApp } from '../../../../apps/katei/src/app.js';
import { createInMemoryWorkspaceRecordRepository } from './lib/workspace_record_repository_double.mjs';

const port = Number.parseInt(process.env.PORT || '3126', 10);
const viewerSub = process.env.KATEI_FIXTURE_VIEWER_SUB || 'fixture_debug_sub';
const viewerEmail = process.env.KATEI_FIXTURE_VIEWER_EMAIL || 'fixture-debug@example.com';
const viewerName = process.env.KATEI_FIXTURE_VIEWER_NAME || 'Fixture Debug User';
const debugSecret = process.env.KATEI_FIXTURE_DEBUG_SECRET || 'fixture-debug-secret';
const boardSecretEncryptionKey =
  process.env.KATEI_FIXTURE_BOARD_SECRET_ENCRYPTION_KEY
  || process.env.KATEI_BOARD_SECRET_ENCRYPTION_KEY
  || 'fixture-board-secret-key-1234567890';
const baseUrl = `http://127.0.0.1:${port}`;

const workspaceRecordRepository = createInMemoryWorkspaceRecordRepository({
  viewerSub,
  viewerEmail
});

const app = createApp({
  env: {
    NODE_ENV: 'development',
    PORT: String(port),
    APP_BASE_URL: baseUrl,
    GOOGLE_CLIENT_ID: 'fixture-google-client-id',
    KATEI_SESSION_SECRET: 'fixture-session-secret',
    KATEI_BOARD_SECRET_ENCRYPTION_KEY: boardSecretEncryptionKey,
    MONGODB_URI: 'mongodb://127.0.0.1:27017',
    MONGODB_DB_NAME: 'fixture-katei',
    KATEI_DEBUG_AUTH_ENABLED: 'true',
    KATEI_DEBUG_AUTH_SECRET: debugSecret,
    KATEI_DEBUG_AUTH_VIEWER_SUB: viewerSub,
    KATEI_DEBUG_AUTH_VIEWER_EMAIL: viewerEmail,
    KATEI_DEBUG_AUTH_VIEWER_NAME: viewerName
  },
  googleTokenVerifier: async () => ({
    sub: viewerSub,
    email: viewerEmail,
    name: viewerName
  }),
  workspaceRecordRepository
});

const server = app.listen(port, () => {
  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    debugLoginUrl: `${baseUrl}/__debug/login`,
    viewer: {
      sub: viewerSub,
      email: viewerEmail,
      name: viewerName
    },
    secretEnvPair: `KATEI_DEBUG_AUTH_SECRET=${debugSecret}`,
    workspaceSwitchRepro: {
      homeWorkspaceId: workspaceRecordRepository.fixture?.homeWorkspaceId ?? null,
      externalNotesWorkspaceId: workspaceRecordRepository.fixture?.externalNotesWorkspaceId ?? null,
      externalMainWorkspaceId: workspaceRecordRepository.fixture?.externalMainWorkspaceId ?? null,
      externalHomeWorkspaceId: workspaceRecordRepository.fixture?.externalHomeWorkspaceId ?? null,
      inviteWorkspaceId: workspaceRecordRepository.fixture?.inviteWorkspaceId ?? null
    }
  }, null, 2));
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
