import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeConfig, parseSessionTtlSeconds } from '../src/config.js';

const REQUIRED_ENV = Object.freeze({
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  KATEI_SESSION_SECRET: 'test-session-secret'
});

test('createRuntimeConfig normalizes MongoDB env values when provided', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    APP_BASE_URL: ' http://localhost:3000 ',
    MONGODB_URI: ' mongodb://127.0.0.1:27017 ',
    MONGODB_DB_NAME: ' katei_test '
  });

  assert.equal(config.mongoUri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.mongoDbName, 'katei_test');
});

test('createRuntimeConfig keeps an explicit APP_BASE_URL over the development fallback', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'development',
    PORT: '4567',
    APP_BASE_URL: ' https://katei.example.com/root '
  });

  assert.equal(config.appBaseUrl, 'https://katei.example.com/root');
  assert.equal(config.appOrigin, 'https://katei.example.com');
});

test('createRuntimeConfig defaults APP_BASE_URL to localhost:3000 in development', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'development'
  });

  assert.equal(config.appBaseUrl, 'http://localhost:3000');
  assert.equal(config.appOrigin, 'http://localhost:3000');
});

test('createRuntimeConfig defaults APP_BASE_URL to the configured development port', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'development',
    PORT: '4567'
  });

  assert.equal(config.appBaseUrl, 'http://localhost:4567');
  assert.equal(config.appOrigin, 'http://localhost:4567');
});

test('createRuntimeConfig defaults blank APP_BASE_URL to localhost in development', () => {
  const blankConfig = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'development',
    APP_BASE_URL: ''
  });
  const whitespaceConfig = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'development',
    APP_BASE_URL: '   '
  });

  assert.equal(blankConfig.appBaseUrl, 'http://localhost:3000');
  assert.equal(blankConfig.appOrigin, 'http://localhost:3000');
  assert.equal(whitespaceConfig.appBaseUrl, 'http://localhost:3000');
  assert.equal(whitespaceConfig.appOrigin, 'http://localhost:3000');
});

test('createRuntimeConfig leaves APP_BASE_URL unset in test when not provided', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test'
  });

  assert.equal(config.appBaseUrl, '');
  assert.equal(config.appOrigin, null);
});

test('createRuntimeConfig leaves APP_BASE_URL unset in production when not provided', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'production'
  });

  assert.equal(config.appBaseUrl, '');
  assert.equal(config.appOrigin, null);
});

test('createRuntimeConfig leaves MongoDB config optional in this step', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    MONGODB_URI: '   '
  });

  assert.equal(config.mongoUri, '');
  assert.equal(config.mongoDbName, '');
});

test('createRuntimeConfig defaults session TTL to 7 days when SESSION_TTL_SECONDS is unset', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test'
  });

  assert.equal(config.sessionTtlSeconds, 604800);
});

test('createRuntimeConfig defaults session TTL to 7 days when SESSION_TTL_SECONDS is blank', () => {
  const blankConfig = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    SESSION_TTL_SECONDS: ''
  });
  const whitespaceConfig = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    SESSION_TTL_SECONDS: '   '
  });

  assert.equal(blankConfig.sessionTtlSeconds, 604800);
  assert.equal(whitespaceConfig.sessionTtlSeconds, 604800);
});

test('createRuntimeConfig parses positive SESSION_TTL_SECONDS overrides', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    SESSION_TTL_SECONDS: '900'
  });

  assert.equal(config.sessionTtlSeconds, 900);
});

test('parseSessionTtlSeconds keeps a defensive fallback for blank input', () => {
  assert.equal(parseSessionTtlSeconds('   '), 604800);
});

test('parseSessionTtlSeconds rejects invalid values', () => {
  assert.throws(() => parseSessionTtlSeconds('0'), /SESSION_TTL_SECONDS must be a positive integer\./);
  assert.throws(() => parseSessionTtlSeconds('-1'), /SESSION_TTL_SECONDS must be a positive integer\./);
  assert.throws(() => parseSessionTtlSeconds('nope'), /SESSION_TTL_SECONDS must be a positive integer\./);
});
