import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeConfig } from '../src/config.js';

const REQUIRED_ENV = Object.freeze({
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  KATEI_SESSION_SECRET: 'test-session-secret'
});

test('createRuntimeConfig normalizes MongoDB env values when provided', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    APP_BASE_URL: ' http://localhost:3000 ',
    MONGODB_URI: ' mongodb://127.0.0.1:27017 ',
    MONGODB_DB_NAME: ' katei_test '
  });

  assert.equal(config.mongoUri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.mongoDbName, 'katei_test');
});

test('createRuntimeConfig leaves MongoDB config optional in this step', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    MONGODB_URI: '   '
  });

  assert.equal(config.mongoUri, '');
  assert.equal(config.mongoDbName, '');
});
