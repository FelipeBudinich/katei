import { Router } from 'express';
import { createRequireSessionMiddleware } from '../middleware/require_session.js';
import { createAuthRouter } from './auth.js';
import { createBoardsRouter } from './boards.js';
import { createPublicRouter } from './public.js';
import { createWorkspaceApiRouter } from './workspace_api.js';

export function createWebRouter({ config, verifyGoogleIdToken, workspaceRecordRepository }) {
  const router = Router();
  const requireBoardSession = createRequireSessionMiddleware({
    onUnauthorized: (request, response) => response.redirect('/')
  });
  const requireApiSession = createRequireSessionMiddleware();

  router.use(createPublicRouter({ config }));
  router.use(createBoardsRouter({ requireSession: requireBoardSession, workspaceRecordRepository }));
  router.use(createWorkspaceApiRouter({ requireSession: requireApiSession, workspaceRecordRepository }));
  router.use(createAuthRouter({ config, verifyGoogleIdToken, requireSession: requireApiSession }));

  return router;
}
