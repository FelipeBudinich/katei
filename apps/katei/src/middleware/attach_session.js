import {
  KATEI_SESSION_COOKIE_NAME,
  clearKateiSessionCookie,
  getViewerFromSessionPayload,
  verifySignedSessionCookieValue
} from '../auth/session_cookie.js';

export function createAttachSessionMiddleware(config) {
  return function attachSession(request, response, next) {
    const rawCookieValue = request.cookies?.[KATEI_SESSION_COOKIE_NAME];
    const session = rawCookieValue
      ? verifySignedSessionCookieValue(rawCookieValue, config.sessionSecret)
      : null;

    if (rawCookieValue && !session) {
      clearKateiSessionCookie(response, config);
    }

    request.kateiSession = session;
    request.viewer = attachViewerRoles(getViewerFromSessionPayload(session), config);
    response.locals.viewer = request.viewer;

    next();
  };
}

function attachViewerRoles(viewer, config) {
  if (!viewer) {
    return null;
  }

  return {
    ...viewer,
    isSuperAdmin: isSuperAdminViewer(viewer, config?.superAdmins)
  };
}

function isSuperAdminViewer(viewer, superAdmins) {
  if (!(superAdmins instanceof Set) || superAdmins.size === 0) {
    return false;
  }

  const normalizedViewerEmail = normalizeOptionalComparableEmail(viewer?.email);

  if (!normalizedViewerEmail) {
    return false;
  }

  return superAdmins.has(normalizedViewerEmail);
}

function normalizeOptionalComparableEmail(value) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalizedValue.includes('@') ? normalizedValue : '';
}
