import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeConfig, parseSessionTtlSeconds, parseSuperAdminEmails } from '../src/config.js';

const REQUIRED_ENV = Object.freeze({
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  KATEI_SESSION_SECRET: 'test-session-secret',
  KATEI_BOARD_SECRET_ENCRYPTION_KEY: 'test-board-secret-encryption-key',
  MONGODB_URI: 'mongodb://127.0.0.1:27017',
  MONGODB_DB_NAME: 'katei_test'
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

test('createRuntimeConfig normalizes required MongoDB URI from the shared env fixture', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test'
  });

  assert.equal(config.mongoUri, 'mongodb://127.0.0.1:27017');
  assert.equal(config.mongoDbName, 'katei_test');
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

test('createRuntimeConfig parses SUPER_ADMINS into a normalized deduplicated email set', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    SUPER_ADMINS: ' Admin@Example.com , , second@example.com, admin@example.com, not-an-email '
  });

  assert.deepEqual([...config.superAdmins], ['admin@example.com', 'second@example.com']);
});

test('createRuntimeConfig parses positive SESSION_TTL_SECONDS overrides', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    SESSION_TTL_SECONDS: '900'
  });

  assert.equal(config.sessionTtlSeconds, 900);
});

test('createRuntimeConfig keeps hosted debug auth disabled by default', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test'
  });

  assert.deepEqual(config.debugAuth, {
    enabled: false,
    secret: '',
    viewer: null
  });
});

test('createRuntimeConfig keeps an explicit board secret encryption key when provided', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    KATEI_BOARD_SECRET_ENCRYPTION_KEY: ' explicit-board-key '
  });

  assert.equal(config.boardSecretEncryptionKey, 'explicit-board-key');
});

test('createRuntimeConfig requires a board secret encryption key in test', () => {
  assert.throws(
    () => createRuntimeConfig({
      GOOGLE_CLIENT_ID: REQUIRED_ENV.GOOGLE_CLIENT_ID,
      KATEI_SESSION_SECRET: REQUIRED_ENV.KATEI_SESSION_SECRET,
      MONGODB_URI: REQUIRED_ENV.MONGODB_URI,
      MONGODB_DB_NAME: REQUIRED_ENV.MONGODB_DB_NAME,
      NODE_ENV: 'test'
    }),
    /KATEI_BOARD_SECRET_ENCRYPTION_KEY is required\./
  );
});

test('createRuntimeConfig requires a board secret encryption key outside test', () => {
  assert.throws(
    () => createRuntimeConfig({
      GOOGLE_CLIENT_ID: REQUIRED_ENV.GOOGLE_CLIENT_ID,
      KATEI_SESSION_SECRET: REQUIRED_ENV.KATEI_SESSION_SECRET,
      MONGODB_URI: REQUIRED_ENV.MONGODB_URI,
      MONGODB_DB_NAME: REQUIRED_ENV.MONGODB_DB_NAME,
      NODE_ENV: 'development'
    }),
    /KATEI_BOARD_SECRET_ENCRYPTION_KEY is required\./
  );
});

test('createRuntimeConfig parses hosted debug auth viewer metadata when enabled', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    KATEI_DEBUG_AUTH_ENABLED: 'true',
    KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
    KATEI_DEBUG_AUTH_VIEWER_SUB: ' debug_sub ',
    KATEI_DEBUG_AUTH_VIEWER_EMAIL: ' debug@example.com ',
    KATEI_DEBUG_AUTH_VIEWER_NAME: ' Debug User '
  });

  assert.deepEqual(config.debugAuth, {
    enabled: true,
    secret: 'debug-secret',
    viewer: {
      sub: 'debug_sub',
      email: 'debug@example.com',
      name: 'Debug User'
    }
  });
});

test('createRuntimeConfig defaults hosted debug auth to disabled when KATEI_DEBUG_AUTH_ENABLED is unset', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test'
  });

  assert.deepEqual(config.debugAuth, {
    enabled: false,
    secret: '',
    viewer: null
  });
});

test('createRuntimeConfig defaults hosted debug auth viewer email when enabled and unset', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    KATEI_DEBUG_AUTH_ENABLED: 'true',
    KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
    KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub'
  });

  assert.deepEqual(config.debugAuth, {
    enabled: true,
    secret: 'debug-secret',
    viewer: {
      sub: 'debug_sub',
      email: 'test@example.com',
      name: 'John Doe'
    }
  });
});

test('createRuntimeConfig defaults hosted debug auth viewer name when enabled and unset', () => {
  const config = createRuntimeConfig({
    ...REQUIRED_ENV,
    NODE_ENV: 'test',
    KATEI_DEBUG_AUTH_ENABLED: 'true',
    KATEI_DEBUG_AUTH_SECRET: 'debug-secret',
    KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub',
    KATEI_DEBUG_AUTH_VIEWER_EMAIL: 'debug@example.com'
  });

  assert.deepEqual(config.debugAuth, {
    enabled: true,
    secret: 'debug-secret',
    viewer: {
      sub: 'debug_sub',
      email: 'debug@example.com',
      name: 'John Doe'
    }
  });
});

test('createRuntimeConfig rejects missing hosted debug auth secrets when enabled', () => {
  assert.throws(
    () => createRuntimeConfig({
      ...REQUIRED_ENV,
      NODE_ENV: 'test',
      KATEI_DEBUG_AUTH_ENABLED: 'true',
      KATEI_DEBUG_AUTH_VIEWER_SUB: 'debug_sub'
    }),
    /KATEI_DEBUG_AUTH_SECRET is required\./
  );
});

test('createRuntimeConfig rejects missing hosted debug auth viewer subs when enabled', () => {
  assert.throws(
    () => createRuntimeConfig({
      ...REQUIRED_ENV,
      NODE_ENV: 'test',
      KATEI_DEBUG_AUTH_ENABLED: 'true',
      KATEI_DEBUG_AUTH_SECRET: 'debug-secret'
    }),
    /KATEI_DEBUG_AUTH_VIEWER_SUB is required when KATEI_DEBUG_AUTH_ENABLED is true\./
  );
});

test('parseSessionTtlSeconds keeps a defensive fallback for blank input', () => {
  assert.equal(parseSessionTtlSeconds('   '), 604800);
});

test('parseSessionTtlSeconds rejects invalid values', () => {
  assert.throws(() => parseSessionTtlSeconds('0'), /SESSION_TTL_SECONDS must be a positive integer\./);
  assert.throws(() => parseSessionTtlSeconds('-1'), /SESSION_TTL_SECONDS must be a positive integer\./);
  assert.throws(() => parseSessionTtlSeconds('nope'), /SESSION_TTL_SECONDS must be a positive integer\./);
});

test('parseSuperAdminEmails keeps an empty set for blank input', () => {
  assert.deepEqual([...parseSuperAdminEmails('   ')], []);
});
