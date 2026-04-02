import { Router } from 'express';
import { normalizeBoardCollaboration } from '../../public/js/domain/board_collaboration.js';
import {
  canonicalizeContentLocale,
  normalizeBoardLanguagePolicy
} from '../../public/js/domain/board_language_policy.js';
import { canActorEditBoard } from '../../public/js/domain/board_permissions.js';
import {
  applyGeneratedCardLocalization,
  CardLocalizationGenerationConflictError,
  getStoredCardContentVariant
} from '../../public/js/domain/card_localization.js';
import { isHumanAuthoredVariant } from '../../public/js/domain/localized_content_guard.js';
import { cloneWorkspace } from '../../public/js/domain/workspace_read_model.js';
import { migrateWorkspaceSnapshot } from '../../public/js/domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../../public/js/domain/workspace_validation.js';
import { getBoard, getCard } from '../../public/js/domain/workspace_selectors.js';
import { createOpenAiLocalizer, OpenAiLocalizerError } from '../ai/openai_localizer.js';
import { applyWorkspaceCommand, WorkspaceCommandPermissionError } from '../workspaces/apply_workspace_command.js';
import { buildInviteResponseDebugFields, createInviteAcceptDebugLogger, createInviteDebugLogger } from '../lib/invite_debug.js';
import { decryptBoardSecret } from '../security/board_secret_crypto.js';
import { createDefaultMutationContext } from '../workspaces/mutation_context.js';
import {
  createCommandAppliedWorkspaceRecord,
  createCommandReceipt,
  createWorkspaceActivityEvent,
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

const BOARD_OPENAI_SECRET_FIELD = 'openAiApiKeyEncrypted';
const CARD_LOCALIZATION_GENERATE_COMMAND_TYPE = 'card.locale.generate';

export function createWorkspaceApiRouter({
  config,
  requireSession,
  workspaceRecordRepository,
  openAiLocalizer = createOpenAiLocalizer()
}) {
  const router = Router();
  const resolvedOpenAiLocalizer = openAiLocalizer ?? createOpenAiLocalizer();

  router.get('/api/workspace', requireSession, async (request, response, next) => {
    const debugLog = createInviteDebugLogger({ request });

    try {
      logViewerIdentity(debugLog, 'GET /api/workspace', request);
      const record = await workspaceRecordRepository.loadOrCreateWorkspaceRecord({
        viewerSub: request.viewer.sub,
        viewerEmail: request.viewer.email ?? null,
        workspaceId: resolveRequestedWorkspaceId(request),
        debugLog
      });
      const extras = await listActorFacingWorkspaceExtras(
        workspaceRecordRepository,
        request,
        record.workspaceId,
        debugLog
      );
      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'GET /api/workspace',
        record,
        ...extras
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
      const extras = await listActorFacingWorkspaceExtras(
        workspaceRecordRepository,
        request,
        fullRecord.workspaceId,
        debugLog
      );

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'PUT /api/workspace',
        record: projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer, debugLog)),
        ...extras
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
    const acceptDebugLog = createInviteAcceptDebugLogger({ request });
    const { expectedRevision, isValid: hasValidExpectedRevision } = parseExpectedRevision(request.body?.expectedRevision);
    const command = request.body?.command;
    const requestedWorkspaceId = resolveRequestedWorkspaceId(request);
    let currentRecord = null;
    let application = null;

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
      currentRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: requestedWorkspaceId,
          debugLog
        })
      );
      logInviteAcceptRouteState(acceptDebugLog, 'server.route.loaded', {
        requestedWorkspaceId,
        command,
        expectedRevision,
        currentRecord
      });
      const projectedCurrentRecord = projectRecordForViewer(currentRecord, createViewerProjectionContext(request.viewer, debugLog));
      const existingReceipt =
        typeof command?.clientMutationId === 'string' && command.clientMutationId.trim()
          ? findCommandReceipt(currentRecord, command.clientMutationId)
          : null;

      if (existingReceipt) {
        const extras = await listActorFacingWorkspaceExtras(
          workspaceRecordRepository,
          request,
          projectedCurrentRecord.workspaceId,
          debugLog
        );
        sendWorkspaceApiResponse(response, {
          debugLog,
          request,
          route: 'POST /api/workspace/commands',
          record: projectedCurrentRecord,
          result: existingReceipt.result,
          ...extras
        });
        return;
      }

      const context = createDefaultMutationContext({
        actor: createViewerMutationActor(request.viewer),
        boardSecretEncryptionKey: config?.boardSecretEncryptionKey ?? null,
        debugLog,
        acceptDebugLog
      });
      application = applyWorkspaceCommand({
        record: currentRecord,
        command,
        expectedRevision,
        context
      });
      logInviteAcceptRouteState(acceptDebugLog, 'server.route.applied', {
        requestedWorkspaceId,
        command,
        expectedRevision,
        currentRecord,
        application
      });

      if (application.result.noOp) {
        const extras = await listActorFacingWorkspaceExtras(
          workspaceRecordRepository,
          request,
          projectedCurrentRecord.workspaceId,
          debugLog
        );
        sendWorkspaceApiResponse(response, {
          debugLog,
          request,
          route: 'POST /api/workspace/commands',
          record: projectedCurrentRecord,
          result: application.result,
          ...extras
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
      logInviteAcceptRouteState(acceptDebugLog, 'server.route.persisted', {
        requestedWorkspaceId,
        command,
        expectedRevision,
        currentRecord: persistedRecord,
        application,
        rejectionStage: 'persisted'
      });
      logPersistedInvite(debugLog, persistedRecord, application.result);
      const extras = await listActorFacingWorkspaceExtras(
        workspaceRecordRepository,
        request,
        persistedRecord.workspaceId,
        debugLog
      );

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'POST /api/workspace/commands',
        record: projectRecordForViewer(persistedRecord, createViewerProjectionContext(request.viewer, debugLog)),
        result: application.result,
        ...extras
      });
    } catch (error) {
      if (error instanceof WorkspaceRevisionConflictError || error?.code === 'WORKSPACE_REVISION_CONFLICT') {
        let conflictRecord = currentRecord;

        if (application && isInviteDecisionCommand(command)) {
          try {
            conflictRecord = createWorkspaceRecord(
              await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
                viewerSub: request.viewer.sub,
                viewerEmail: request.viewer.email ?? null,
                workspaceId: requestedWorkspaceId,
                debugLog
              })
            );
          } catch (reloadError) {
            conflictRecord = currentRecord;
          }
        }

        logInviteAcceptRouteState(acceptDebugLog, 'server.route.conflict', {
          requestedWorkspaceId,
          command,
          expectedRevision,
          currentRecord: conflictRecord,
          loadedRecordRevision: Number.isInteger(currentRecord?.revision) ? currentRecord.revision : null,
          application,
          error,
          rejectionStage: application ? 'persist-optimistic-concurrency' : 'pre-apply-revision-check'
        });
      }

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

  router.post('/api/workspace/localizations/generate', requireSession, async (request, response, next) => {
    const debugLog = createInviteDebugLogger({ request });
    const { expectedRevision, isValid: hasValidExpectedRevision } = parseExpectedRevision(request.body?.expectedRevision);
    const requestedWorkspaceId = resolveRequestedWorkspaceId(request);
    let currentRecord = null;

    if (!hasValidExpectedRevision) {
      response.status(400).json({
        ok: false,
        error: 'expectedRevision must be a non-negative integer.'
      });
      return;
    }

    let mutation = null;

    try {
      const localizationRequest = normalizeGenerateLocalizationRequest(request.body);

      logViewerIdentity(debugLog, 'POST /api/workspace/localizations/generate', request, {
        boardId: localizationRequest.boardId,
        cardId: localizationRequest.cardId,
        targetLocale: localizationRequest.targetLocale,
        clientMutationId: localizationRequest.clientMutationId,
        expectedRevision
      });
      currentRecord = createWorkspaceRecord(
        await workspaceRecordRepository.loadOrCreateAuthoritativeWorkspaceRecord({
          viewerSub: request.viewer.sub,
          viewerEmail: request.viewer.email ?? null,
          workspaceId: requestedWorkspaceId,
          debugLog
        })
      );
      const projectedCurrentRecord = projectRecordForViewer(
        currentRecord,
        createViewerProjectionContext(request.viewer, debugLog)
      );
      const existingReceipt = findCommandReceipt(currentRecord, localizationRequest.clientMutationId);

      if (existingReceipt) {
        const extras = await listActorFacingWorkspaceExtras(
          workspaceRecordRepository,
          request,
          projectedCurrentRecord.workspaceId,
          debugLog
        );
        sendWorkspaceApiResponse(response, {
          debugLog,
          request,
          route: 'POST /api/workspace/localizations/generate',
          record: projectedCurrentRecord,
          result: existingReceipt.result,
          ...extras
        });
        return;
      }

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      mutation = await generateCardLocalizationMutation({
        record: currentRecord,
        requestViewer: request.viewer,
        clientMutationId: localizationRequest.clientMutationId,
        boardId: localizationRequest.boardId,
        cardId: localizationRequest.cardId,
        targetLocale: localizationRequest.targetLocale,
        config,
        openAiLocalizer: resolvedOpenAiLocalizer
      });

      const nextRecord = createCommandAppliedWorkspaceRecord(currentRecord, {
        workspace: mutation.workspace,
        actor: createViewerMutationActor(request.viewer),
        now: mutation.now,
        activityEvent: mutation.activityEvent,
        commandReceipt: createCommandReceipt({
          clientMutationId: localizationRequest.clientMutationId,
          commandType: CARD_LOCALIZATION_GENERATE_COMMAND_TYPE,
          actorId: request.viewer.sub,
          revision: currentRecord.revision + 1,
          appliedAt: mutation.now,
          result: mutation.result
        })
      });
      const persistedRecord = await workspaceRecordRepository.replaceWorkspaceRecord({
        record: nextRecord,
        expectedRevision
      });
      const extras = await listActorFacingWorkspaceExtras(
        workspaceRecordRepository,
        request,
        persistedRecord.workspaceId,
        debugLog
      );

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'POST /api/workspace/localizations/generate',
        record: projectRecordForViewer(persistedRecord, createViewerProjectionContext(request.viewer, debugLog)),
        result: mutation.result,
        ...extras
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
          error: error.message,
          errorCode: 'WORKSPACE_REVISION_CONFLICT'
        });
        return;
      }

      if (error instanceof WorkspaceCommandPermissionError || error?.code === 'WORKSPACE_COMMAND_FORBIDDEN') {
        response.status(403).json({
          ok: false,
          error: error.message,
          errorCode: error.code ?? 'WORKSPACE_COMMAND_FORBIDDEN'
        });
        return;
      }

      if (
        error instanceof WorkspaceLocalizationRequestError
        || error instanceof CardLocalizationGenerationConflictError
        || error instanceof OpenAiLocalizerError
      ) {
        response.status(error.status ?? 400).json({
          ok: false,
          error: error.message,
          errorCode: error.code ?? 'CARD_LOCALIZATION_GENERATION_FAILED'
        });
        return;
      }

      if (error?.message === 'Board not found.' || error?.message === 'Card not found.') {
        response.status(400).json({
          ok: false,
          error: error.message,
          errorCode: 'CARD_LOCALIZATION_REQUEST_INVALID'
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
      const extras = await listActorFacingWorkspaceExtras(
        workspaceRecordRepository,
        request,
        fullRecord.workspaceId,
        debugLog
      );

      sendWorkspaceApiResponse(response, {
        debugLog,
        request,
        route: 'POST /api/workspace/import',
        record: projectRecordForViewer(fullRecord, createViewerProjectionContext(request.viewer, debugLog)),
        ...extras
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

class WorkspaceLocalizationRequestError extends Error {
  constructor(message, { code = 'CARD_LOCALIZATION_REQUEST_INVALID', status = 400 } = {}) {
    super(message);
    this.name = 'WorkspaceLocalizationRequestError';
    this.code = code;
    this.status = status;
  }
}

async function generateCardLocalizationMutation({
  record,
  requestViewer,
  clientMutationId,
  boardId,
  cardId,
  targetLocale,
  config,
  openAiLocalizer
} = {}) {
  const now = new Date().toISOString();
  const actor = createViewerMutationActor(requestViewer);
  const board = getBoard(record.workspace, boardId);

  if (!canActorEditBoard(board, actor)) {
    throw new WorkspaceCommandPermissionError('You do not have permission to modify this board.');
  }

  const card = getCard(board, cardId);
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);

  if (!languagePolicy?.supportedLocales.includes(targetLocale)) {
    throw new WorkspaceLocalizationRequestError('Card locale is not supported by this board.', {
      code: 'TARGET_LOCALE_UNSUPPORTED',
      status: 400
    });
  }

  const existingTargetVariant = getStoredCardContentVariant(card, targetLocale);

  if (hasMeaningfulLocalizedContent(existingTargetVariant)) {
    if (isHumanAuthoredVariant(existingTargetVariant)) {
      throw new CardLocalizationGenerationConflictError(
        'Human-authored localized content already exists for this locale.',
        {
          code: 'LOCALIZATION_HUMAN_AUTHORED_CONFLICT',
          locale: targetLocale
        }
      );
    }

    throw new CardLocalizationGenerationConflictError(
      'Localized content already exists for this locale.',
      {
        code: 'LOCALIZATION_ALREADY_PRESENT',
        locale: targetLocale
      }
    );
  }

  const sourceLocale = languagePolicy.sourceLocale;
  const sourceVariant = getStoredCardContentVariant(card, sourceLocale);

  if (!hasMeaningfulLocalizedContent(sourceVariant)) {
    throw new WorkspaceLocalizationRequestError(
      'Source locale content is required before generating a localization.',
      {
        code: 'SOURCE_LOCALE_MISSING',
        status: 400
      }
    );
  }

  const apiKey = readBoardOpenAiApiKey(board, config);
  const localization = await openAiLocalizer.generateLocalization({
    apiKey,
    board,
    card,
    sourceLocale,
    targetLocale
  });
  const nextWorkspace = cloneWorkspace(record.workspace);
  const nextBoard = getBoard(nextWorkspace, boardId);
  const nextCard = getCard(nextBoard, cardId);

  nextBoard.cards[nextCard.id] = applyGeneratedCardLocalization(
    {
      ...nextCard,
      updatedAt: now
    },
    targetLocale,
    {
      title: localization.title,
      detailsMarkdown: localization.detailsMarkdown
    },
    {
      actor: localization.actor,
      timestamp: now
    }
  );
  nextBoard.updatedAt = now;

  return {
    workspace: nextWorkspace,
    now,
    result: {
      clientMutationId,
      type: CARD_LOCALIZATION_GENERATE_COMMAND_TYPE,
      noOp: false,
      boardId,
      cardId,
      locale: targetLocale,
      sourceLocale
    },
    activityEvent: createWorkspaceActivityEvent({
      type: 'workspace.card.localization.generated',
      actor,
      createdAt: now,
      revision: record.revision + 1,
      entity: {
        kind: 'card',
        boardId,
        cardId
      },
      details: {
        sourceLocale,
        targetLocale,
        provider: localization.provider
      }
    })
  };
}

function normalizeGenerateLocalizationRequest(body) {
  const clientMutationId = normalizeRequiredBodyString(
    body?.clientMutationId,
    'clientMutationId is required.'
  );
  const boardId = normalizeRequiredBodyString(body?.boardId, 'boardId is required.');
  const cardId = normalizeRequiredBodyString(body?.cardId, 'cardId is required.');
  const rawTargetLocale = normalizeRequiredBodyString(body?.targetLocale, 'targetLocale is required.');
  const targetLocale = canonicalizeContentLocale(rawTargetLocale);

  if (!targetLocale) {
    throw new WorkspaceLocalizationRequestError('targetLocale is invalid.', {
      code: 'CARD_LOCALIZATION_REQUEST_INVALID',
      status: 400
    });
  }

  return {
    clientMutationId,
    boardId,
    cardId,
    targetLocale
  };
}

function readBoardOpenAiApiKey(board, config) {
  const encryptedApiKey = normalizeOptionalString(board?.aiLocalizationSecrets?.[BOARD_OPENAI_SECRET_FIELD]);

  if (!encryptedApiKey) {
    throw new WorkspaceLocalizationRequestError('This board does not have an OpenAI API key configured.', {
      code: 'BOARD_OPENAI_KEY_MISSING',
      status: 400
    });
  }

  try {
    return decryptBoardSecret(encryptedApiKey, {
      boardSecretEncryptionKey: config?.boardSecretEncryptionKey ?? null
    });
  } catch (error) {
    throw new WorkspaceLocalizationRequestError('The saved OpenAI API key could not be used.', {
      code: 'BOARD_OPENAI_KEY_UNAVAILABLE',
      status: 500
    });
  }
}

function hasMeaningfulLocalizedContent(variant) {
  return Boolean(
    normalizeOptionalString(variant?.title) || normalizeOptionalString(variant?.detailsMarkdown)
  );
}

function normalizeRequiredBodyString(value, errorMessage) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new WorkspaceLocalizationRequestError(errorMessage, {
      code: 'CARD_LOCALIZATION_REQUEST_INVALID',
      status: 400
    });
  }

  return normalizedValue;
}

function createWorkspaceApiResponse(record, result = undefined, pendingWorkspaceInvites = [], accessibleWorkspaces = []) {
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
    pendingWorkspaceInvites: Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : [],
    accessibleWorkspaces: Array.isArray(accessibleWorkspaces) ? accessibleWorkspaces : []
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
  pendingWorkspaceInvites = [],
  accessibleWorkspaces = []
} = {}) {
  const payload = createWorkspaceApiResponse(record, result, pendingWorkspaceInvites, accessibleWorkspaces);

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

async function listAccessibleWorkspacesForRequest(
  workspaceRecordRepository,
  request,
  excludeWorkspaceId = null,
  debugLog = null
) {
  return workspaceRecordRepository.listAccessibleWorkspacesForViewer({
    viewerSub: request.viewer.sub,
    viewerEmail: request.viewer.email ?? null,
    excludeWorkspaceId,
    debugLog
  });
}

async function listActorFacingWorkspaceExtras(
  workspaceRecordRepository,
  request,
  excludeWorkspaceId = null,
  debugLog = null
) {
  const [pendingWorkspaceInvites, accessibleWorkspaces] = await Promise.all([
    listPendingWorkspaceInvitesForRequest(workspaceRecordRepository, request, debugLog),
    listAccessibleWorkspacesForRequest(workspaceRecordRepository, request, excludeWorkspaceId, debugLog)
  ]);

  return {
    pendingWorkspaceInvites,
    accessibleWorkspaces
  };
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

function logInviteAcceptRouteState(log, event, fields) {
  if (typeof log !== 'function' || !isInviteDecisionCommand(fields?.command)) {
    return;
  }

  log(event, buildInviteDecisionRouteFields(fields));
}

function buildInviteDecisionRouteFields({
  requestedWorkspaceId = null,
  command = null,
  expectedRevision = null,
  currentRecord = null,
  loadedRecordRevision = null,
  application = null,
  error = null,
  rejectionStage = null
} = {}) {
  const boardId = normalizeOptionalString(command?.payload?.boardId) || null;
  const inviteId = normalizeOptionalString(command?.payload?.inviteId) || null;
  const workspaceId = normalizeOptionalString(requestedWorkspaceId)
    || normalizeOptionalString(currentRecord?.workspaceId)
    || normalizeOptionalString(currentRecord?.workspace?.workspaceId)
    || null;
  const board = boardId ? currentRecord?.workspace?.boards?.[boardId] ?? null : null;
  const invite = board ? normalizeBoardCollaboration(board).invites.find((entry) => entry.id === inviteId) ?? null : null;

  return {
    commandType: command?.type ?? null,
    workspaceId,
    boardId,
    inviteId,
    expectedRevision,
    loadedRecordRevision: Number.isInteger(loadedRecordRevision) ? loadedRecordRevision : Number.isInteger(currentRecord?.revision) ? currentRecord.revision : null,
    currentPersistedRevision: Number.isInteger(currentRecord?.revision) ? currentRecord.revision : null,
    inviteExistsInWorkspace: Boolean(invite),
    inviteStatus: invite?.status ?? null,
    boardExistsInWorkspace: Boolean(board),
    resultNoOp: application?.result?.noOp ?? null,
    resultInviteId: application?.result?.inviteId ?? null,
    rejectionStage,
    errorMessage: error?.message ?? null
  };
}

function isInviteDecisionCommand(command) {
  return command?.type === 'board.invite.accept' || command?.type === 'board.invite.decline';
}
