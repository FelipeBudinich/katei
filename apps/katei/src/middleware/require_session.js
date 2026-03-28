export function createRequireSessionMiddleware({ onUnauthorized } = {}) {
  return function requireSession(request, response, next) {
    if (request.viewer) {
      next();
      return;
    }

    if (typeof onUnauthorized === 'function') {
      onUnauthorized(request, response, next);
      return;
    }

    response.status(401).json({
      ok: false,
      error: 'Authentication required.'
    });
  };
}

