import crypto from 'node:crypto';

export const KATEI_SESSION_COOKIE_NAME = 'katei_session';
export const KATEI_SESSION_VERSION = 1;

export function createSessionPayload(viewer, ttlSeconds, now = new Date()) {
  if (!viewer?.sub) {
    throw new Error('Session viewer sub is required.');
  }

  const issuedAtSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = issuedAtSeconds + ttlSeconds;

  return {
    v: KATEI_SESSION_VERSION,
    sub: viewer.sub,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
    ...(normalizeOptionalField(viewer.name) ? { name: viewer.name.trim() } : {}),
    ...(normalizeOptionalField(viewer.picture) ? { picture: viewer.picture.trim() } : {})
  };
}

export function createSignedSessionCookieValue(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySignedSessionCookieValue(value, secret, now = new Date()) {
  if (typeof value !== 'string' || !value.includes('.')) {
    return null;
  }

  const separatorIndex = value.lastIndexOf('.');
  const encodedPayload = value.slice(0, separatorIndex);
  const providedSignature = value.slice(separatorIndex + 1);

  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = signValue(encodedPayload, secret);

  if (!safeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    if (!isValidSessionPayload(payload, now)) {
      return null;
    }

    return payload;
  } catch (error) {
    return null;
  }
}

export function getViewerFromSessionPayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    sub: payload.sub,
    ...(normalizeOptionalField(payload.name) ? { name: payload.name.trim() } : {}),
    ...(normalizeOptionalField(payload.picture) ? { picture: payload.picture.trim() } : {})
  };
}

export function setKateiSessionCookie(response, viewer, config, now = new Date()) {
  const payload = createSessionPayload(viewer, config.sessionTtlSeconds, now);

  response.cookie(
    KATEI_SESSION_COOKIE_NAME,
    createSignedSessionCookieValue(payload, config.sessionSecret),
    getKateiSessionCookieOptions(config)
  );

  return payload;
}

export function clearKateiSessionCookie(response, config) {
  response.clearCookie(KATEI_SESSION_COOKIE_NAME, getKateiSessionCookieBaseOptions(config));
}

export function getKateiSessionCookieOptions(config) {
  return {
    ...getKateiSessionCookieBaseOptions(config),
    maxAge: config.sessionTtlSeconds * 1000
  };
}

function getKateiSessionCookieBaseOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/'
  };
}

function isValidSessionPayload(payload, now) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  if (payload.v !== KATEI_SESSION_VERSION) {
    return false;
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    return false;
  }

  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) {
    return false;
  }

  const currentTimestamp = Math.floor(now.getTime() / 1000);

  if (payload.exp <= currentTimestamp || payload.iat > payload.exp) {
    return false;
  }

  if (payload.name != null && typeof payload.name !== 'string') {
    return false;
  }

  if (payload.picture != null && typeof payload.picture !== 'string') {
    return false;
  }

  return true;
}

function signValue(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeOptionalField(value) {
  return typeof value === 'string' && value.trim();
}
