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
    request.viewer = getViewerFromSessionPayload(session);
    response.locals.viewer = request.viewer;

    next();
  };
}

