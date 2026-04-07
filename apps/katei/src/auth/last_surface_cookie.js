export const KATEI_LAST_SURFACE_COOKIE_NAME = 'katei_last_surface';
export const LAST_SURFACE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;

export function readLastSurfaceMemory(request) {
  return parseLastSurfaceCookieValue(request?.cookies?.[KATEI_LAST_SURFACE_COOKIE_NAME]);
}

export function createLastSurfaceCookieValue(memory) {
  const normalizedMemory = normalizeLastSurfaceMemory(memory);

  if (!normalizedMemory) {
    throw new Error('A valid last-surface memory value is required.');
  }

  return Buffer.from(JSON.stringify(normalizedMemory), 'utf8').toString('base64url');
}

export function parseLastSurfaceCookieValue(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return normalizeLastSurfaceMemory(parsedValue);
  } catch (error) {
    return null;
  }
}

export function setLastSurfaceCookie(response, memory, config) {
  const normalizedMemory = normalizeLastSurfaceMemory(memory);

  if (!normalizedMemory) {
    clearLastSurfaceCookie(response, config);
    return null;
  }

  response.cookie(
    KATEI_LAST_SURFACE_COOKIE_NAME,
    createLastSurfaceCookieValue(normalizedMemory),
    getLastSurfaceCookieOptions(config)
  );

  return normalizedMemory;
}

export function setPortfolioSurfaceCookie(response, config) {
  return setLastSurfaceCookie(response, { surface: 'portfolio' }, config);
}

export function setBoardSurfaceCookie(response, record, config) {
  const workspaceId = normalizeOptionalString(record?.workspaceId ?? record?.workspace?.workspaceId);

  if (!workspaceId) {
    clearLastSurfaceCookie(response, config);
    return null;
  }

  const boardId = normalizeOptionalString(record?.workspace?.ui?.activeBoardId);

  return setLastSurfaceCookie(
    response,
    {
      surface: 'board',
      workspaceId,
      ...(boardId ? { boardId } : {})
    },
    config
  );
}

export function clearLastSurfaceCookie(response, config) {
  response.clearCookie(KATEI_LAST_SURFACE_COOKIE_NAME, getLastSurfaceCookieBaseOptions(config));
}

export function getLastSurfaceCookieOptions(config) {
  return {
    ...getLastSurfaceCookieBaseOptions(config),
    maxAge: LAST_SURFACE_COOKIE_MAX_AGE_MS
  };
}

function getLastSurfaceCookieBaseOptions(config) {
  return {
    httpOnly: false,
    sameSite: 'lax',
    secure: config?.isProduction === true,
    path: '/'
  };
}

function normalizeLastSurfaceMemory(memory) {
  const surface = normalizeOptionalString(memory?.surface).toLowerCase();

  if (surface === 'portfolio') {
    return {
      surface
    };
  }

  if (surface !== 'board') {
    return null;
  }

  const workspaceId = normalizeOptionalString(memory?.workspaceId);

  if (!workspaceId) {
    return null;
  }

  const boardId = normalizeOptionalString(memory?.boardId);

  return {
    surface,
    workspaceId,
    ...(boardId ? { boardId } : {})
  };
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
