import { Router } from 'express';
import { validateWorkspaceShape } from '../../public/js/domain/workspace.js';

export function createWorkspaceApiRouter({ requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.get('/api/workspace', requireSession, async (request, response, next) => {
    try {
      const record = await workspaceRecordRepository.loadOrCreateWorkspaceRecord(request.viewer.sub);
      response.json(createWorkspaceApiResponse(record));
    } catch (error) {
      next(error);
    }
  });

  router.put('/api/workspace', requireSession, async (request, response, next) => {
    const workspace = request.body?.workspace;

    if (!validateWorkspaceShape(workspace)) {
      response.status(400).json({
        ok: false,
        error: 'Cannot save an invalid workspace.'
      });
      return;
    }

    try {
      const record = await workspaceRecordRepository.replaceWorkspaceSnapshot({
        viewerSub: request.viewer.sub,
        workspace,
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });

      response.json(createWorkspaceApiResponse(record));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function createWorkspaceApiResponse(record) {
  return {
    ok: true,
    workspace: record.workspace,
    meta: {
      revision: record.revision,
      updatedAt: record.updatedAt,
      lastChangedBy: record.lastChangedBy,
      isPristine: record.revision === 0
    }
  };
}
