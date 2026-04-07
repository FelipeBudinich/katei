import { Router } from 'express';
import { isAllowedGoogleSub } from '../auth/allowlist.js';
import { clearLastSurfaceCookie } from '../auth/last_surface_cookie.js';
import { resolveAuthenticatedLandingDestination } from '../auth/landing_redirect.js';
import { clearKateiSessionCookie, setKateiSessionCookie } from '../auth/session_cookie.js';

const ACCESS_DENIED_MESSAGE = 'This Google account is not enabled for private testing.';

export function createAuthRouter({ config, verifyGoogleIdToken, requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.post('/auth/google', async (request, response, next) => {
    if (!isAllowedOrigin(request, config)) {
      response.status(403).json({
        ok: false,
        error: 'Sign-in request origin is not allowed.'
      });
      return;
    }

    const credential = normalizeCredential(request.body?.credential);

    if (!credential) {
      response.status(400).json({
        ok: false,
        error: 'Google credential is required.'
      });
      return;
    }

    let viewer;

    try {
      viewer = await verifyGoogleIdToken(credential);
    } catch (error) {
      response.status(401).json({
        ok: false,
        error: 'Unable to verify the Google credential.'
      });
      return;
    }

    if (!isAllowedGoogleSub(viewer.sub, config.googleAllowlistSubs)) {
      response.status(403).json({
        ok: false,
        error: ACCESS_DENIED_MESSAGE
      });
      return;
    }

    try {
      setKateiSessionCookie(response, viewer, config);
      const redirectTo = await resolveAuthenticatedLandingDestination({
        request,
        viewer,
        config,
        workspaceRecordRepository
      });

      response.json({
        ok: true,
        redirectTo
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', requireSession, (request, response) => {
    clearKateiSessionCookie(response, config);
    clearLastSurfaceCookie(response, config);
    response.json({
      ok: true,
      redirectTo: '/'
    });
  });

  return router;
}

function isAllowedOrigin(request, config) {
  if (!config.appOrigin) {
    return true;
  }

  const requestOrigin = request.get('origin');

  if (!requestOrigin) {
    return true;
  }

  return requestOrigin === config.appOrigin;
}

function normalizeCredential(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
