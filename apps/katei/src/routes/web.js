import { Router } from 'express';
import { createRequireSessionMiddleware } from '../middleware/require_session.js';
import { createRequireSuperAdminMiddleware } from '../middleware/require_super_admin.js';
import { createAuthRouter } from './auth.js';
import { createBoardsRouter } from './boards.js';
import { createDebugAuthRouter } from './debug_auth.js';
import { createPortfolioRouter } from './portfolio.js';
import { createPublicRouter } from './public.js';
import { createWorkspaceApiRouter } from './workspace_api.js';

export function createWebRouter({
  config,
  verifyGoogleIdToken,
  workspaceRecordRepository,
  portfolioReadModel,
  openAiLocalizer = null,
  openAiStagePromptRunner = null
}) {
  const router = Router();
  const requireBoardSession = createRequireSessionMiddleware({
    onUnauthorized: (request, response) => response.redirect('/')
  });
  const requireSuperAdmin = createRequireSuperAdminMiddleware({
    onUnauthorized: (request, response) => response.redirect('/boards')
  });
  const requireApiSession = createRequireSessionMiddleware();

  router.use(createDebugAuthRouter({ config, workspaceRecordRepository }));
  router.use(createPublicRouter({ config, workspaceRecordRepository }));
  router.use(createPortfolioRouter({
    requireSession: requireBoardSession,
    requireSuperAdmin,
    portfolioReadModel,
    config
  }));
  router.use(createBoardsRouter({ requireSession: requireBoardSession, workspaceRecordRepository, config }));
  router.use(createWorkspaceApiRouter({
    config,
    requireSession: requireApiSession,
    workspaceRecordRepository,
    openAiLocalizer,
    openAiStagePromptRunner
  }));
  router.use(createAuthRouter({
    config,
    verifyGoogleIdToken,
    requireSession: requireApiSession,
    workspaceRecordRepository
  }));

  return router;
}
