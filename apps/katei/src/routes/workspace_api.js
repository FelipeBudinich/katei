import { Router } from 'express';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';
import { applyWorkspaceCommand, WorkspaceCommandPermissionError } from '../workspaces/apply_workspace_command.js';
import { createDefaultMutationContext } from '../workspaces/mutation_context.js';
import {
  createCommandAppliedWorkspaceRecord,
  createCommandReceipt,
  createWorkspaceRecord,
  findCommandReceipt
} from '../workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../workspaces/workspace_record_repository.js';
import { projectRecordForViewer } from '../workspaces/mongo_workspace_record_repository.js';
import { canViewerReplaceWorkspaceSnapshot } from '../workspaces/workspace_access.js';

export function createWorkspaceApiRouter({ requireSession, workspaceRecordRepository }) {
  const router = Router();

  router.get('/api/workspace', requireSession, async (request, response, next) => {
    try {
      const [record, pendingWorkspaceInvites] = await Promise.all([
        workspaceRecordRepository.loadOrCreateWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request)
        }),
        listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request)
      ]);
      response.json(createWorkspaceApiResponse(record, undefined, pendingWorkspaceInvites));
    } catch (error) {
      if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
        response.status(404).json({
          ok: false,
          error: 'Workspace not found.'
        });
        return;
      }

      next(error);
    }
  });

  router.put('/api/workspace', requireSession, async (request, response, next) => {
    const workspace = migrateWorkspaceSnapshot(request.body?.workspace);
    const { expectedRevision, isValid: hasValidExpectedRevision } = parseExpectedRevision(request.body?.expectedRevision);

    if (!validateWorkspaceShape(workspace)) {
      response.status(400).json(createInvalidWorkspaceResponse());
      return;
    }

    if (!hasValidExpectedRevision) {
      response.status(400).json({
        ok: false,
        error: 'expectedRevision must be a non-negative integer.'
      });
      return;
    }

    try {
      const authoritativeRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request)
        })
      );

      if (
        !canViewerReplaceWorkspaceSnapshot({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          ownerSub: authoritativeRecord.viewerSub,
          workspace: authoritativeRecord.workspace
        })
      ) {
        response.status(403).json({
          ok: false,
          error: 'Use board commands to update shared workspaces when some boards are hidden from you.'
        });
        return;
      }

      const fullRecord = await workspaceRecordRepository.replaceWorkspaceSnapshot({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        workspaceId: resolveRequestedWorkspaceId(request),
        workspace,
        expectedRevision,
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request);

      response.json(
        createWorkspaceApiResponse(
          projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer)),
          undefined,
          pendingWorkspaceInvites
        )
      );
    } catch (error) {
      if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
        response.status(404).json({
          ok: false,
          error: 'Workspace not found.'
        });
        return;
      }

      if (error instanceof WorkspaceRevisionConflictError || error?.code === 'WORKSPACE_REVISION_CONFLICT') {
        response.status(409).json({
          ok: false,
          error: error.message
        });
        return;
      }

      next(error);
    }
  });

  router.post('/api/workspace/commands', requireSession, async (request, response, next) => {
    const { expectedRevision, isValid: hasValidExpectedRevision } = parseExpectedRevision(request.body?.expectedRevision);
    const command = request.body?.command;

    if (!hasValidExpectedRevision) {
      response.status(400).json({
        ok: false,
        error: 'expectedRevision must be a non-negative integer.'
      });
      return;
    }

    try {
      const currentRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request)
        })
      );
      const projectedCurrentRecord = projectRecordForViewer(currentRecord, createViewerProjectionContext(request.viewer));
      const existingReceipt =
        typeof command?.clientMutationId === 'string' && command.clientMutationId.trim()
          ? findCommandReceipt(currentRecord, command.clientMutationId)
          : null;

      if (existingReceipt) {
        const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request);
        response.json(createWorkspaceApiResponse(projectedCurrentRecord, existingReceipt.result, pendingWorkspaceInvites));
        return;
      }

      const context = createDefaultMutationContext({
        actor: createViewerMutationActor(request.viewer)
      });
      const application = applyWorkspaceCommand({
        record: currentRecord,
        command,
        expectedRevision,
        context
      });

      if (application.result.noOp) {
        const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request);
        response.json(createWorkspaceApiResponse(projectedCurrentRecord, application.result, pendingWorkspaceInvites));
        return;
      }

      const nextRecord = createCommandAppliedWorkspaceRecord(currentRecord, {
        workspace: application.workspace,
        actor: context.actor,
        now: context.now,
        activityEvent: application.activityEvent,
        commandReceipt: createCommandReceipt({
          clientMutationId: command.clientMutationId,
          commandType: command.type,
          actorId: request.viewer.sub,
          revision: currentRecord.revision + 1,
          appliedAt: context.now,
          result: application.result
        })
      });
      const persistedRecord = await workspaceRecordRepository.replaceWorkspaceRecord({
        record: nextRecord,
        expectedRevision
      });
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request);

      response.json(
        createWorkspaceApiResponse(
          projectRecordForViewer(persistedRecord, createViewerProjectionContext(request.viewer)),
          application.result,
          pendingWorkspaceInvites
        )
      );
    } catch (error) {
      if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
        response.status(404).json({
          ok: false,
          error: 'Workspace not found.'
        });
        return;
      }

      if (error instanceof WorkspaceRevisionConflictError || error?.code === 'WORKSPACE_REVISION_CONFLICT') {
        response.status(409).json({
          ok: false,
          error: error.message
        });
        return;
      }

      if (error instanceof WorkspaceCommandPermissionError || error?.code === 'WORKSPACE_COMMAND_FORBIDDEN') {
        response.status(403).json({
          ok: false,
          error: error.message
        });
        return;
      }

      if (error?.message && /Workspace command|expectedRevision/.test(error.message)) {
        response.status(400).json({
          ok: false,
          error: error.message
        });
        return;
      }

      next(error);
    }
  });

  router.post('/api/workspace/import', requireSession, async (request, response, next) => {
    const workspace = migrateWorkspaceSnapshot(request.body?.workspace);

    if (!validateWorkspaceShape(workspace)) {
      response.status(400).json(createInvalidWorkspaceResponse());
      return;
    }

    try {
      const fullRecord = await workspaceRecordRepository.importWorkspaceSnapshot({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        workspaceId: resolveRequestedWorkspaceId(request),
        workspace,
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request);

      response.json(
        createWorkspaceApiResponse(
          projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer)),
          undefined,
          pendingWorkspaceInvites
        )
      );
    } catch (error) {
      if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
        response.status(404).json({
          ok: false,
          error: 'Workspace not found.'
        });
        return;
      }

      if (error instanceof WorkspaceImportConflictError || error?.code === 'WORKSPACE_IMPORT_CONFLICT') {
        response.status(409).json({
          ok: false,
          error: error.message
        });
        return;
      }

      next(error);
    }
  });

  return router;
}

function createViewerMutationActor(viewer) {
  return {
    type: 'human',
    id: viewer.sub,
    ...(typeof viewer?.email === 'string' && viewer.email.trim() ? { email: viewer.email.trim() } : {}),
    ...(typeof viewer?.name === 'string' && viewer.name.trim() ? { name: viewer.name.trim() } : {})
  };
}

function createViewerProjectionContext(viewer) {
  return {
    viewerSub: viewer?.sub,
    viewerEmail: viewer?.email ?? null
  };
}

function createWorkspaceApiResponse(record, result = undefined, pendingWorkspaceInvites = []) {
  const workspace = record?.workspace;
  const payload = {
    ok: true,
    workspace,
    activeWorkspace: {
      workspaceId: normalizeOptionalString(record?.workspaceId) || normalizeOptionalString(workspace?.workspaceId) || null,
      isHomeWorkspace: record?.isHomeWorkspace === true
    },
    meta: {
      revision: normalizeRevision(record?.revision),
      updatedAt: typeof record?.updatedAt === 'string' ? record.updatedAt : null,
      lastChangedBy: normalizeOptionalString(record?.lastChangedBy) || null,
      isPristine: normalizeRevision(record?.revision) === 0
    },
    pendingWorkspaceInvites: Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : []
  };

  if (result !== undefined) {
    payload.result = result;
  }

  return payload;
}

function createInvalidWorkspaceResponse() {
  return {
    ok: false,
    error: 'Cannot save an invalid workspace.'
  };
}

function parseExpectedRevision(value) {
  const normalizedRevision =
    typeof value === 'number' && Number.isInteger(value)
      ? value
      : Number.parseInt(String(value ?? ''), 10);

  if (!Number.isInteger(normalizedRevision) || normalizedRevision < 0) {
    return {
      expectedRevision: null,
      isValid: false
    };
  }

  return {
    expectedRevision: normalizedRevision,
    isValid: true
  };
}

function resolveRequestedWorkspaceId(request) {
  if (typeof request?.body?.workspaceId === 'string' && request.body.workspaceId.trim()) {
    return request.body.workspaceId.trim();
  }

  if (typeof request?.query?.workspaceId === 'string' && request.query.workspaceId.trim()) {
    return request.query.workspaceId.trim();
  }

  return null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRevision(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

async function listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request) {
  return workspaceRecordRepository.listPendingWorkspaceInvitesForViewer({
    viewerSub: request.viewer.sub,
    viewerEmail: request.viewer.email ?? null
  });
}
