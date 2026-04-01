import { Router } from 'express';
import { normalizeBoardCollaboration } from '../../public/js/domain/board_collaboration.js';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';
import { applyWorkspaceCommand, WorkspaceCommandPermissionError } from '../workspaces/apply_workspace_command.js';
import { buildInviteResponseDebugFields, createInviteDebugLogger } from '../lib/invite_debug.js';
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
    const debugLog = createInviteDebugLogger({ request });

    try {
      logViewerIdentity(debugLog, 'GET /api/workspace', request);
      const [record, pendingWorkspaceInvites] = await Promise.all([
        workspaceRecordRepository.loadOrCreateWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request),
          debugLog
        }),
        listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog)
      ]);
      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'GET /api/workspace',
        record,
        pendingWorkspaceInvites
      });
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
    const debugLog = createInviteDebugLogger({ request });
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
      logViewerIdentity(debugLog, 'PUT /api/workspace', request, {
        expectedRevision
      });
      const authoritativeRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request),
          debugLog
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
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog);

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'PUT /api/workspace',
        record: projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer, debugLog)),
        pendingWorkspaceInvites
      });
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
    const debugLog = createInviteDebugLogger({ request });
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
      logViewerIdentity(debugLog, 'POST /api/workspace/commands', request, {
        commandType: command?.type ?? null,
        clientMutationId: typeof command?.clientMutationId === 'string' ? command.clientMutationId : null,
        expectedRevision
      });
      const currentRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: resolveRequestedWorkspaceId(request),
          debugLog
        })
      );
      const projectedCurrentRecord = projectRecordForViewer(currentRecord, createViewerProjectionContext(request.viewer, debugLog));
      const existingReceipt =
        typeof command?.clientMutationId === 'string' && command.clientMutationId.trim()
          ? findCommandReceipt(currentRecord, command.clientMutationId)
          : null;

      if (existingReceipt) {
        const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog);
        sendWorkspaceApiResponse(response, {
          debugLog,
          request,
          route: 'POST /api/workspace/commands',
          record: projectedCurrentRecord,
          result: existingReceipt.result,
          pendingWorkspaceInvites
        });
        return;
      }

      const context = createDefaultMutationContext({
        actor: createViewerMutationActor(request.viewer),
        debugLog
      });
      const application = applyWorkspaceCommand({
        record: currentRecord,
        command,
        expectedRevision,
        context
      });

      if (application.result.noOp) {
        const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog);
        sendWorkspaceApiResponse(response, {
          debugLog,
          request,
          route: 'POST /api/workspace/commands',
          record: projectedCurrentRecord,
          result: application.result,
          pendingWorkspaceInvites
        });
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
      logPersistedInvite(debugLog, persistedRecord, application.result);
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog);

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'POST /api/workspace/commands',
        record: projectRecordForViewer(persistedRecord, createViewerProjectionContext(request.viewer, debugLog)),
        result: application.result,
        pendingWorkspaceInvites
      });
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
    const debugLog = createInviteDebugLogger({ request });
    const workspace = migrateWorkspaceSnapshot(request.body?.workspace);

    if (!validateWorkspaceShape(workspace)) {
      response.status(400).json(createInvalidWorkspaceResponse());
      return;
    }

    try {
      logViewerIdentity(debugLog, 'POST /api/workspace/import', request);
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
      const pendingWorkspaceInvites = await listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog);

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'POST /api/workspace/import',
        record: projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer, debugLog)),
        pendingWorkspaceInvites
      });
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

function sendWorkspaceApiResponse(response, {
  debugLog = null,
  request = null,
  route = null,
  record,
  result = undefined,
  pendingWorkspaceInvites = []
} = {}) {
  const payload = createWorkspaceApiResponse(record, result, pendingWorkspaceInvites);

  if (typeof debugLog === 'function') {
    debugLog('invite.response.summary', buildInviteResponseDebugFields({
      route,
      viewer: request?.viewer,
      workspace: payload.workspace,
      activeWorkspace: payload.activeWorkspace,
      pendingWorkspaceInvites: payload.pendingWorkspaceInvites
    }));
  }

  response.json(payload);
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

async function listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog = null) {
  return workspaceRecordRepository.listPendingWorkspaceInvitesForViewer({
    viewerSub: request.viewer.sub,
    viewerEmail: request.viewer.email ?? null,
    debugLog
  });
}

function createViewerProjectionContext(viewer, debugLog = null) {
  return {
    viewerSub: viewer?.sub,
    viewerEmail: viewer?.email ?? null,
    debugLog
  };
}

function logViewerIdentity(debugLog, route, request, extraFields = {}) {
  if (typeof debugLog !== 'function') {
    return;
  }

  const viewer = request?.viewer;

  debugLog('viewer.identity', {
    route,
    workspaceId: resolveRequestedWorkspaceId(request),
    hasSession: Boolean(request?.kateiSession),
    viewerSub: viewer?.sub ?? null,
    viewerEmail: viewer?.email ?? null,
    viewerName: typeof viewer?.name === 'string' && viewer.name.trim() ? viewer.name.trim() : null,
    ...extraFields
  });
}

function logPersistedInvite(debugLog, record, result) {
  if (typeof debugLog !== 'function' || !result?.inviteId || !result?.boardId) {
    return;
  }

  const board = record?.workspace?.boards?.[result.boardId];
  const storedInvite =
    board ? normalizeBoardCollaboration(board).invites.find((invite) => invite.id === result.inviteId) ?? null : null;

  debugLog('invite.persisted', {
    workspaceId: record?.workspaceId ?? null,
    boardId: result.boardId,
    inviteId: result.inviteId,
    storedInvite
  });
}
