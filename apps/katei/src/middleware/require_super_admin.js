export function createRequireSuperAdminMiddleware({ onUnauthorized } = {}) {
  return function requireSuperAdmin(request, response, next) {
    if (request.viewer?.isSuperAdmin) {
      next();
      return;
    }

    if (typeof onUnauthorized === 'function') {
      onUnauthorized(request, response, next);
      return;
    }

    response.status(403).json({
      ok: false,
      error: 'Super admin access required.'
    });
  };
}
