const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createRuntimeConfig(env = process.env) {
  const nodeEnv = normalizeOptionalString(env.NODE_ENV) || 'development';
  const appBaseUrl = normalizeOptionalString(env.APP_BASE_URL);
  const mongoUri = normalizeOptionalString(env.MONGODB_URI);
  const mongoDbName = normalizeOptionalString(env.MONGODB_DB_NAME);
  const sessionTtlSeconds = parseSessionTtlSeconds(normalizeOptionalString(env.SESSION_TTL_SECONDS) || String(DEFAULT_SESSION_TTL_SECONDS));

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    googleClientId: requireNonEmptyEnv('GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID),
    sessionSecret: requireNonEmptyEnv('KATEI_SESSION_SECRET', env.KATEI_SESSION_SECRET),
    googleAllowlistSubs: parseAllowlistSubs(env.GOOGLE_ALLOWLIST_SUBS),
    sessionTtlSeconds,
    appBaseUrl,
    appOrigin: appBaseUrl ? new URL(appBaseUrl).origin : null,
    mongoUri,
    mongoDbName
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
