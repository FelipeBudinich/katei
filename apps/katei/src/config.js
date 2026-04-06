const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export function createRuntimeConfig(env = process.env) {
  const nodeEnv = normalizeOptionalString(env.NODE_ENV) || 'development';
  const appBaseUrl = normalizeOptionalString(env.APP_BASE_URL) || (nodeEnv === 'development' ? `http://localhost:${Number(env.PORT) || 3000}` : '');
  const mongoUri = requireNonEmptyEnv('MONGODB_URI', env.MONGODB_URI);
  const mongoDbName = requireNonEmptyEnv('MONGODB_DB_NAME', env.MONGODB_DB_NAME);
  const sessionTtlSeconds = parseSessionTtlSeconds(normalizeOptionalString(env.SESSION_TTL_SECONDS) || String(DEFAULT_SESSION_TTL_SECONDS));
  const superAdmins = parseSuperAdminEmails(normalizeOptionalString(env.SUPER_ADMINS) || '');
  const debugAuth = createDebugAuthConfig(env);
  const boardSecretEncryptionKey = requireNonEmptyEnv('KATEI_BOARD_SECRET_ENCRYPTION_KEY', env.KATEI_BOARD_SECRET_ENCRYPTION_KEY);

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    googleClientId: requireNonEmptyEnv('GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID),
    sessionSecret: requireNonEmptyEnv('KATEI_SESSION_SECRET', env.KATEI_SESSION_SECRET),
    boardSecretEncryptionKey,
    googleAllowlistSubs: parseAllowlistSubs(normalizeOptionalString(env.GOOGLE_ALLOWLIST_SUBS) || ''),
    superAdmins,
    sessionTtlSeconds,
    appBaseUrl,
    appOrigin: appBaseUrl ? new URL(appBaseUrl).origin : null,
    mongoUri,
    mongoDbName,
    debugAuth
  };
}

export function parseAllowlistSubs(rawValue) {
  const normalizedValue = normalizeOptionalString(rawValue);

  if (!normalizedValue) {
    return new Set();
  }

  return new Set(
    normalizedValue
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function parseSuperAdminEmails(rawValue) {
  const normalizedValue = normalizeOptionalString(rawValue);

  if (!normalizedValue) {
    return new Set();
  }

  return new Set(
    normalizedValue
      .split(',')
      .map((value) => normalizeOptionalComparableEmail(value))
      .filter(Boolean)
  );
}

export function parseSessionTtlSeconds(rawValue) {
  const normalizedValue = normalizeOptionalString(rawValue);

  if (!normalizedValue) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }

  const parsedValue = Number.parseInt(normalizedValue, 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error('SESSION_TTL_SECONDS must be a positive integer.');
  }

  return parsedValue;
}

function createDebugAuthConfig(env = process.env) {
  const enabled = parseBooleanEnv(normalizeOptionalString(env.KATEI_DEBUG_AUTH_ENABLED) || 'false');
  const secret = enabled
    ? requireNonEmptyEnv('KATEI_DEBUG_AUTH_SECRET', env.KATEI_DEBUG_AUTH_SECRET)
    : normalizeOptionalString(env.KATEI_DEBUG_AUTH_SECRET);
  const viewerSub = normalizeOptionalString(env.KATEI_DEBUG_AUTH_VIEWER_SUB);
  const viewerEmail = normalizeOptionalEmail(env.KATEI_DEBUG_AUTH_VIEWER_EMAIL) || 'test@example.com';
  const viewerName = normalizeOptionalString(env.KATEI_DEBUG_AUTH_VIEWER_NAME) || 'John Doe';

  if (enabled && !viewerSub) {
    throw new Error('KATEI_DEBUG_AUTH_VIEWER_SUB is required when KATEI_DEBUG_AUTH_ENABLED is true.');
  }

  return {
    enabled,
    secret,
    viewer: viewerSub
      ? {
          sub: viewerSub,
          ...(viewerEmail ? { email: viewerEmail } : {}),
          ...(viewerName ? { name: viewerName } : {})
        }
      : null
  };
}

function parseBooleanEnv(rawValue) {
  const normalizedValue = normalizeOptionalString(rawValue).toLowerCase();

  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes' || normalizedValue === 'on') {
    return true;
  }

  if (normalizedValue === 'false' || normalizedValue === '0' || normalizedValue === 'no' || normalizedValue === 'off') {
    return false;
  }

  throw new Error('KATEI_DEBUG_AUTH_ENABLED must be a boolean-like value.');
}

function requireNonEmptyEnv(name, value) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(`${name} is required.`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value);
  return normalizedValue.includes('@') ? normalizedValue : '';
}

function normalizeOptionalComparableEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue.includes('@') ? normalizedValue : '';
}
