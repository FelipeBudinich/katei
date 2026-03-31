import { Router } from 'express';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';
import { applyWorkspaceCommand } from '../workspaces/apply_workspace_command.js';
import { createDefaultMutationContext } from '../workspaces/mutation_context.js';
import {
  createCommandAppliedWorkspaceRecord,
  createCommandReceipt,
  findCommandReceipt
} from '../workspaces/workspace_record.js';
import {
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../workspaces/workspace_record_repository.js';

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
      const record = await workspaceRecordRepository.replaceWorkspaceSnapshot({
        viewerSub: request.viewer.sub,
        workspace,
        expectedRevision,
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });

      response.json(createWorkspaceApiResponse(record));
    } catch (error) {
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
      const currentRecord = await workspaceRecordRepository.loadOrCreateWorkspaceRecord(request.viewer.sub);
      const existingReceipt =
        typeof command?.clientMutationId === 'string' && command.clientMutationId.trim()
          ? findCommandReceipt(currentRecord, command.clientMutationId)
          : null;

      if (existingReceipt) {
        response.json(createWorkspaceApiResponse(currentRecord, existingReceipt.result));
        return;
      }

      const context = createDefaultMutationContext({
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });
      const application = applyWorkspaceCommand({
        record: currentRecord,
        command,
        expectedRevision,
        context
      });

      if (application.result.noOp) {
        response.json(createWorkspaceApiResponse(currentRecord, application.result));
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

      response.json(createWorkspaceApiResponse(persistedRecord, application.result));
    } catch (error) {
      if (error instanceof WorkspaceRevisionConflictError || error?.code === 'WORKSPACE_REVISION_CONFLICT') {
        response.status(409).json({
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
    const workspace = request.body?.workspace;

    if (!validateWorkspaceShape(workspace)) {
      response.status(400).json(createInvalidWorkspaceResponse());
      return;
    }

    try {
      const record = await workspaceRecordRepository.importWorkspaceSnapshot({
        viewerSub: request.viewer.sub,
        workspace,
        actor: {
          type: 'human',
          id: request.viewer.sub
        }
      });

      response.json(createWorkspaceApiResponse(record));
    } catch (error) {
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

function createWorkspaceApiResponse(record, result = undefined) {
  const payload = {
    ok: true,
    workspace: record.workspace,
    meta: {
      revision: record.revision,
      updatedAt: record.updatedAt,
      lastChangedBy: record.lastChangedBy,
      isPristine: record.revision === 0
    }
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
