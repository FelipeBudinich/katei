import crypto from 'node:crypto';
import { Router } from 'express';
import { setKateiSessionCookie } from '../auth/session_cookie.js';

const DEBUG_AUTH_HEADER_NAME = 'x-katei-debug-auth';

export function createDebugAuthRouter({ config }) {
  const router = Router();

  router.post('/__debug/login', (request, response) => {
    response.set('Cache-Control', 'no-store');

    if (!config?.debugAuth?.enabled) {
      response.status(404).json({
        ok: false,
        error: 'Not found.'
      });
      return;
    }

    const providedSecret = normalizeOptionalString(request.get(DEBUG_AUTH_HEADER_NAME));
    const expectedSecret = normalizeOptionalString(config.debugAuth.secret);

    if (!providedSecret || !expectedSecret || !safeEqual(providedSecret, expectedSecret)) {
      response.status(403).json({
        ok: false,
        error: 'Debug authentication failed.'
      });
      return;
    }

    const viewer = buildDebugViewer(config.debugAuth.viewer);

    setKateiSessionCookie(response, viewer, config);
    response.json({
      ok: true,
      redirectTo: '/boards',
      viewer
    });
  });

  return router;
}

function buildDebugViewer(viewer) {
  return {
    sub: viewer.sub,
    ...(viewer.email ? { email: viewer.email } : {}),
    ...(viewer.name ? { name: viewer.name } : {})
  };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
