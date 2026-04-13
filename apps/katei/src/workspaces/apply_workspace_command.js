import { randomUUID } from 'node:crypto';
import { assertValidWorkspaceCommand } from '../../public/js/domain/workspace_commands.js';
import {
  assertBoardSchemaCompatibleWithBoard,
  normalizeBoardSchemaInput,
  serializeBoardSchemaInput
} from '../../public/js/domain/board_schema.js';
import {
  canonicalizeBoardRole,
  createBoardActorKey,
  normalizeBoardActor,
  normalizeBoardCollaboration,
  normalizeBoardInvite,
  normalizeBoardMembership
} from '../../public/js/domain/board_collaboration.js';
import {
  BOARD_AI_PROVIDER_OPENAI,
  normalizeBoardAiLocalization,
  normalizeBoardAiProvider
} from '../../public/js/domain/board_ai_localization.js';
import { canonicalizeContentLocale } from '../../public/js/domain/board_language_policy.js';
import { normalizeBoardLocalizationGlossary } from '../../public/js/domain/board_localization_glossary.js';
import {
  canActorAdminBoard,
  canActorApproveCardReview,
  canActorEditBoard,
  canActorReadBoard,
  getBoardMembershipForActor,
  isBoardAdminMembership
} from '../../public/js/domain/board_permissions.js';
import { stageSupportsAction } from '../../public/js/domain/board_stage_actions.js';
import {
  createCardContentProvenance,
  createCardContentReview,
  discardCardContentVariant,
  getCardContentReviewState,
  getStoredCardContentVariant,
  requestCardContentHumanVerification,
  upsertCardContentVariant,
  verifyCardContentHumanVerification
} from '../../public/js/domain/card_localization.js';
import {
  isHumanAuthoredVariant,
  shouldBlockAutomatedLocaleOverwrite
} from '../../public/js/domain/localized_content_guard.js';
import {
  clearCardLocaleRequest,
  getOpenLocalizationRequest,
  requestCardLocale
} from '../../public/js/domain/card_localization_requests.js';
import {
  createCardWorkflowReview,
  resetCardWorkflowReview
} from '../../public/js/domain/card_workflow_review.js';
import {
  cloneWorkspace,
  createWorkspaceBoard,
  DEFAULT_PRIORITY,
  normalizeWorkspaceTitle
} from '../../public/js/domain/workspace_read_model.js';
import { findColumnIdByCardId, getBoard, getCard } from '../../public/js/domain/workspace_selectors.js';
import {
  assertValidColumnId,
  normalizeBoardTitle,
  normalizeCardTitle,
  normalizeDetailsMarkdown,
  normalizePriority
} from '../../public/js/domain/workspace_validation.js';
import { encryptBoardSecret } from '../security/board_secret_crypto.js';
import { createDefaultMutationContext, createMutationContext } from './mutation_context.js';
import {
  createWorkspaceActivityEvent,
  createWorkspaceActivityEventId,
  createWorkspaceRecord
} from './workspace_record.js';
import { WorkspaceRevisionConflictError } from './workspace_record_repository.js';

const BOARD_OPENAI_SECRET_FIELD = 'openAiApiKeyEncrypted';

export class WorkspaceCommandPermissionError extends Error {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'WorkspaceCommandPermissionError';
    this.code = 'WORKSPACE_COMMAND_FORBIDDEN';
  }
}

export function applyWorkspaceCommand({
  record,
  command,
  expectedRevision,
  context = createDefaultMutationContext()
} = {}) {
  const currentRecord = createWorkspaceRecord(record);
  const mutationContext = createMutationContext(context);

  assertValidWorkspaceCommand(command);
  assertExpectedRevision(expectedRevision);

  if (isInviteDecisionType(command?.type)) {
    logInviteAcceptDebug(mutationContext, 'server.command.precondition', {
      commandType: command.type,
      workspaceId: normalizeOptionalString(currentRecord.workspace?.workspaceId),
      boardId: command.payload?.boardId ?? null,
      inviteId: command.payload?.inviteId ?? null,
      expectedRevision,
      currentRevision: currentRecord.revision,
      revisionMatches: currentRecord.revision === expectedRevision
    });
  }

  if (currentRecord.revision !== expectedRevision) {
    if (isInviteDecisionType(command?.type)) {
      logInviteAcceptDebug(mutationContext, 'server.command.conflict', {
        commandType: command.type,
        workspaceId: normalizeOptionalString(currentRecord.workspace?.workspaceId),
        boardId: command.payload?.boardId ?? null,
        inviteId: command.payload?.inviteId ?? null,
        expectedRevision,
        currentRevision: currentRecord.revision,
        rejectionStage: 'pre-apply-revision-check'
      });
    }

    throw new WorkspaceRevisionConflictError();
  }

  const { workspace, result, activityEventInput = null } = applyCommandToWorkspace({
    workspace: currentRecord.workspace,
    command,
    context: mutationContext
  });

  const activityEvent = result.noOp
    ? null
    : createWorkspaceActivityEvent({
        id: createWorkspaceActivityEventId(),
        type: activityEventInput?.type ?? 'workspace.command.applied',
        actor: mutationContext.actor,
        createdAt: mutationContext.now,
        revision: currentRecord.revision + 1,
        entity: activityEventInput?.entity ?? null,
        details: activityEventInput?.details ?? null
      });

  return {
    workspace,
    result,
    activityEvent
  };
}

export function createWorkspaceCommandEngine(dependencies = {}) {
  return {
    apply(commandContext) {
      return applyWorkspaceCommand({
        ...commandContext,
        context: commandContext?.context ?? createMutationContext(dependencies)
      });
    }
  };
}

function applyCommandToWorkspace({ workspace, command, context }) {
  switch (command.type) {
    case 'workspace.title.set':
      return applyWorkspaceTitleSet(workspace, command, context);
    case 'board.create':
      return applyBoardCreate(workspace, command, context);
    case 'board.update':
      return applyBoardUpdate(workspace, command, context);
    case 'board.rename':
      return applyBoardRename(workspace, command, context);
    case 'board.invite.create':
      return applyBoardInviteCreate(workspace, command, context);
    case 'board.invite.revoke':
      return applyBoardInviteRevoke(workspace, command, context);
    case 'board.invite.accept':
      return applyBoardInviteAccept(workspace, command, context);
    case 'board.invite.decline':
      return applyBoardInviteDecline(workspace, command, context);
    case 'board.self.role.set':
      return applyBoardSelfRoleSet(workspace, command, context);
    case 'board.member.role.set':
      return applyBoardMemberRoleSet(workspace, command, context);
    case 'board.member.remove':
      return applyBoardMemberRemove(workspace, command, context);
    case 'board.delete':
      return applyBoardDelete(workspace, command, context);
    case 'board.reset':
      return applyBoardReset(workspace, command, context);
    case 'card.create':
      return applyCardCreate(workspace, command, context);
    case 'card.update':
      return applyCardUpdate(workspace, command, context);
    case 'card.locale.upsert':
      return applyCardLocaleUpsert(workspace, command, context);
    case 'card.locale.discard':
      return applyCardLocaleDiscard(workspace, command, context);
    case 'card.locale.request':
      return applyCardLocaleRequest(workspace, command, context);
    case 'card.locale.request.clear':
      return applyCardLocaleRequestClear(workspace, command, context);
    case 'card.locale.review.request':
      return applyCardLocaleReviewRequest(workspace, command, context);
    case 'card.locale.review.verify':
      return applyCardLocaleReviewVerify(workspace, command, context);
    case 'card.delete':
      return applyCardDelete(workspace, command, context);
    case 'card.review.approve':
      return applyCardReviewApprove(workspace, command, context);
    case 'card.review.reject':
      return applyCardReviewReject(workspace, command, context);
    case 'card.move':
      return applyCardMove(workspace, command, context);
    case 'ui.activeBoard.set':
      return applySetActiveBoard(workspace, command, context);
    default:
      throw new Error(`Unsupported workspace command type: ${command.type}`);
  }
}

function applyWorkspaceTitleSet(workspace, command, context) {
  assertAuthenticatedHumanActor(context.actor, 'You must be signed in to update the workspace title.');
  assertActorCanManageWorkspaceTitle(context);
  const currentWorkspaceTitle = normalizeWorkspaceTitle(workspace?.title);
  const nextWorkspaceTitle = normalizeWorkspaceTitle(command.payload.title);

  if (currentWorkspaceTitle === nextWorkspaceTitle) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        workspaceId: workspace.workspaceId,
        workspaceTitle: nextWorkspaceTitle
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);

  if (nextWorkspaceTitle) {
    nextWorkspace.title = nextWorkspaceTitle;
  } else {
    delete nextWorkspace.title;
  }

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      workspaceId: nextWorkspace.workspaceId,
      workspaceTitle: nextWorkspaceTitle
    }),
    activityEventInput: {
      type: 'workspace.title.updated',
      entity: {
        kind: 'workspace'
      },
      details: {
        workspaceId: nextWorkspace.workspaceId,
        workspaceTitle: nextWorkspaceTitle
      }
    }
  };
}

function applyBoardCreate(workspace, command, context) {
  assertAuthenticatedHumanActor(context.actor, 'You must be signed in to create a board.');
  const nextWorkspace = cloneWorkspace(workspace);
  const boardId = context.createBoardId();
  const board = createWorkspaceBoard({
    id: boardId,
    title: normalizeBoardTitle(command.payload.title),
    createdAt: context.now,
    updatedAt: context.now,
    creator: context.actor ?? {
      type: 'system',
      id: 'command-engine'
    }
  });
  const normalizedSchema = hasBoardSchemaPayload(command.payload)
    ? normalizeBoardSchemaInput({
        languagePolicy: command.payload.languagePolicy,
        stageDefinitions: command.payload.stageDefinitions,
        templates: command.payload.templates
      })
    : null;
  const nextLocalizationGlossary = resolveNextBoardLocalizationGlossary(board, command.payload, {
    supportedLocales: normalizedSchema?.languagePolicy?.supportedLocales ?? board.languagePolicy?.supportedLocales
  });

  if (normalizedSchema) {
    applyNormalizedSchemaToBoard(board, normalizedSchema);
  }

  applyBoardLocalizationGlossary(board, nextLocalizationGlossary);

  nextWorkspace.boards[board.id] = board;
  nextWorkspace.boardOrder = [...nextWorkspace.boardOrder, board.id];
  nextWorkspace.ui.activeBoardId = board.id;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id
    })
  };
}

function applyBoardUpdate(workspace, command, context) {
  const normalizedTitle = normalizeBoardTitle(command.payload.title);
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);
  const normalizedSchema = normalizeBoardSchemaInput({
    languagePolicy: command.payload.languagePolicy,
    stageDefinitions: command.payload.stageDefinitions,
    templates: command.payload.templates
  });
  const nextLocalizationGlossary = resolveNextBoardLocalizationGlossary(currentBoard, command.payload, {
    supportedLocales: normalizedSchema.languagePolicy.supportedLocales
  });
  const nextBoardAiSettings = resolveNextBoardAiSettings(currentBoard, command.payload, context);

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  if (
    currentBoard.title === normalizedTitle &&
    JSON.stringify(serializeBoardSchemaInput(currentBoard)) ===
      JSON.stringify({
        languagePolicy: normalizedSchema.languagePolicy,
        stageDefinitions: normalizedSchema.stageDefinitions,
        templates: normalizedSchema.templates
      }) &&
    boardLocalizationGlossaryEqual(currentBoard, nextLocalizationGlossary) &&
    boardAiSettingsEqual(currentBoard, nextBoardAiSettings)
  ) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  board.title = normalizedTitle;
  applyNormalizedSchemaToBoard(board, normalizedSchema, { preserveCardIdsFrom: currentBoard });
  applyBoardLocalizationGlossary(board, nextLocalizationGlossary);
  applyBoardAiSettings(board, nextBoardAiSettings);
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id
    })
  };
}

function applyBoardRename(workspace, command, context) {
  const normalizedTitle = normalizeBoardTitle(command.payload.title);
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);

  if (currentBoard.title === normalizedTitle) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  board.title = normalizedTitle;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id
    })
  };
}

function applyBoardInviteCreate(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);
  const invitedBy = normalizeBoardActor(context.actor);
  const invite = normalizeBoardInvite({
    id: createBoardInviteId(),
    email: command.payload.email,
    role: canonicalizeBoardRole(command.payload.role),
    status: 'pending',
    ...(invitedBy ? { invitedBy } : {}),
    invitedAt: context.now
  });

  if (!invite) {
    throw new Error('Board invite is invalid.');
  }

  logInviteDebug(context, 'invite.create', {
    workspaceId: normalizeOptionalString(workspace?.workspaceId),
    boardId: currentBoard.id,
    inviteId: invite.id,
    inputEmail: command.payload.email ?? null,
    normalizedInviteEmail: invite.email ?? null,
    role: invite.role,
    inviterSub: invitedBy?.id ?? null,
    inviterEmail: invitedBy?.email ?? null
  });

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const collaboration = ensureBoardCollaboration(board);
  collaboration.invites = [...collaboration.invites, invite];
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      inviteId: invite.id,
      email: invite.email,
      role: invite.role
    })
  };
}

function applyBoardInviteRevoke(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);
  const currentInvite = findBoardInvite(currentBoard, command.payload.inviteId);
  const pendingInvite = findPendingInvite(currentBoard, command.payload.inviteId, context.now);

  if (!currentInvite) {
    throw new Error('Board invite not found.');
  }

  if (resolveInviteStatus(currentInvite, context.now) === 'revoked') {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        inviteId: currentInvite.id
      })
    };
  }

  if (!pendingInvite) {
    assertInvitePending(currentInvite, context.now);
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  updateInviteStatus(board, command.payload.inviteId, 'revoked', context.now);
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      inviteId: command.payload.inviteId
    })
  };
}

function applyBoardInviteAccept(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(context.actor, 'You must be signed in to accept a board invite.');
  const currentInvite = findBoardInvite(currentBoard, command.payload.inviteId);
  const pendingInvite = findPendingInvite(currentBoard, command.payload.inviteId, context.now);
  const inviteEmailMatch = emailsMatchInvite(actor, currentInvite);
  const existingMembership = getBoardMembershipForActor(currentBoard, actor);

  logInviteDebug(context, 'invite.accept.check', {
    workspaceId: normalizeOptionalString(workspace?.workspaceId),
    boardId: currentBoard.id,
    inviteId: command.payload.inviteId,
    actorSub: actor.id,
    actorEmail: actor.email ?? null,
    inviteEmail: currentInvite?.email ?? null,
    inviteActorId: currentInvite?.actor?.id ?? null,
    inviteStatus: currentInvite?.status ?? null,
    pendingStatus: pendingInvite?.status ?? null,
    emailMatched: inviteEmailMatch,
    membershipExists: Boolean(existingMembership)
  });
  logInviteAcceptDebug(context, 'server.command.invite.accept.check', {
    workspaceId: normalizeOptionalString(workspace?.workspaceId),
    boardId: currentBoard.id,
    inviteId: command.payload.inviteId,
    actorSub: actor.id,
    actorEmail: actor.email ?? null,
    inviteExists: Boolean(currentInvite),
    inviteStatus: currentInvite?.status ?? null,
    emailMatched: inviteEmailMatch,
    membershipExists: Boolean(existingMembership)
  });

  if (!currentInvite || !inviteEmailMatch) {
    throw new WorkspaceCommandPermissionError('You do not have permission to respond to this invite.');
  }

  if (!pendingInvite) {
    assertInvitePending(currentInvite, context.now);
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  updateInviteStatus(board, command.payload.inviteId, 'accepted', context.now);

  if (!existingMembership) {
    upsertBoardMembership(board, {
      actor,
      role: currentInvite.role,
      joinedAt: context.now,
      ...(currentInvite.invitedBy ? { invitedBy: currentInvite.invitedBy } : {})
    });
  }

  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      inviteId: command.payload.inviteId,
      role: currentInvite.role
    })
  };
}

function applyBoardInviteDecline(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(context.actor, 'You must be signed in to decline a board invite.');
  const currentInvite = findBoardInvite(currentBoard, command.payload.inviteId);
  const pendingInvite = findPendingInvite(currentBoard, command.payload.inviteId, context.now);
  const inviteEmailMatch = emailsMatchInvite(actor, currentInvite);

  logInviteDebug(context, 'invite.decline.check', {
    workspaceId: normalizeOptionalString(workspace?.workspaceId),
    boardId: currentBoard.id,
    inviteId: command.payload.inviteId,
    actorSub: actor.id,
    actorEmail: actor.email ?? null,
    inviteEmail: currentInvite?.email ?? null,
    inviteActorId: currentInvite?.actor?.id ?? null,
    inviteStatus: currentInvite?.status ?? null,
    pendingStatus: pendingInvite?.status ?? null,
    emailMatched: inviteEmailMatch
  });
  logInviteAcceptDebug(context, 'server.command.invite.decline.check', {
    workspaceId: normalizeOptionalString(workspace?.workspaceId),
    boardId: currentBoard.id,
    inviteId: command.payload.inviteId,
    actorSub: actor.id,
    actorEmail: actor.email ?? null,
    inviteExists: Boolean(currentInvite),
    inviteStatus: currentInvite?.status ?? null,
    emailMatched: inviteEmailMatch
  });

  if (!currentInvite || !inviteEmailMatch) {
    throw new WorkspaceCommandPermissionError('You do not have permission to respond to this invite.');
  }

  if (!pendingInvite) {
    assertInvitePending(currentInvite, context.now);
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  updateInviteStatus(board, command.payload.inviteId, 'declined', context.now);
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      inviteId: command.payload.inviteId
    })
  };
}

function applyBoardMemberRoleSet(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);
  const targetActor = normalizeTargetActor(command.payload.targetActor);
  const currentMembership = getBoardMembershipForActor(currentBoard, targetActor);
  const nextRole = canonicalizeBoardRole(command.payload.role);

  if (!currentMembership) {
    throw new Error('Board member not found.');
  }

  if (!nextRole) {
    throw new Error('Board member role is invalid.');
  }

  if (currentMembership?.role === nextRole) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        targetActor,
        role: nextRole
      })
    };
  }

  if (isBoardAdminMembership(currentMembership) && nextRole !== 'admin' && countAdminMemberships(currentBoard) === 1) {
    throw new Error('Cannot demote the last board admin.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  upsertBoardMembership(board, {
    ...(currentMembership ?? {
      actor: targetActor,
      joinedAt: context.now
    }),
    role: nextRole
  });
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      targetActor,
      role: nextRole
    })
  };
}

function applyBoardSelfRoleSet(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(context.actor, 'You must be signed in to manage your board role.');
  assertActorCanSelfAssignBoardRole(context);
  const currentMembership = getBoardMembershipForActor(currentBoard, actor);
  const nextRole = canonicalizeBoardRole(command.payload.role);

  // This command is intentionally board-scoped: it seeds or updates a normal board membership
  // for the current super admin and then lets the existing admin/editor/viewer helpers take over.
  if (!nextRole) {
    throw new Error('Board self role is invalid.');
  }

  if (currentMembership?.role === nextRole) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        targetActor: actor,
        role: nextRole
      })
    };
  }

  if (isBoardAdminMembership(currentMembership) && nextRole !== 'admin' && countAdminMemberships(currentBoard) === 1) {
    throw new Error('Cannot demote the last board admin.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  upsertBoardMembership(board, {
    ...(currentMembership ?? {
      actor,
      joinedAt: context.now
    }),
    role: nextRole
  });
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      targetActor: actor,
      role: nextRole
    })
  };
}

function applyBoardMemberRemove(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  // Self-removal intentionally stays on the normal board-admin path. This rollout only adds the
  // board.self.role.set bootstrap seam for super admins, not a parallel workspace-wide remove flow.
  assertActorCanAdminBoard(currentBoard, context.actor);
  const targetActor = normalizeTargetActor(command.payload.targetActor);
  const currentMembership = getBoardMembershipForActor(currentBoard, targetActor);

  if (!currentMembership) {
    throw new Error('Board member not found.');
  }

  if (isBoardAdminMembership(currentMembership) && countAdminMemberships(currentBoard) === 1) {
    throw new Error('Cannot remove the last board admin.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  removeBoardMembership(board, targetActor);
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      targetActor
    })
  };
}

function applyBoardDelete(workspace, command, context) {
  const boardId = command.payload.boardId;
  const nextWorkspace = removeBoardFromWorkspace(workspace, boardId, {
    actor: context.actor
  });

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId
    })
  };
}

export function removeBoardFromWorkspace(workspace, boardId, { actor = null, allowDeleteLastBoard = false } = {}) {
  const currentBoard = getBoard(workspace, boardId);

  if (actor) {
    assertActorCanAdminBoard(currentBoard, actor);
  }

  if (!allowDeleteLastBoard && workspace.boardOrder.length === 1) {
    throw new Error('Cannot delete the last remaining board.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const boardIndex = nextWorkspace.boardOrder.indexOf(boardId);

  if (boardIndex === -1 || !nextWorkspace.boards[boardId]) {
    throw new Error('Board not found.');
  }

  nextWorkspace.boardOrder = nextWorkspace.boardOrder.filter((currentBoardId) => currentBoardId !== boardId);
  delete nextWorkspace.boards[boardId];

  if (nextWorkspace.boardOrder.length === 0) {
    nextWorkspace.ui.activeBoardId = null;
    return nextWorkspace;
  }

  if (nextWorkspace.ui.activeBoardId === boardId) {
    const nextBoardId =
      nextWorkspace.boardOrder[boardIndex] ?? nextWorkspace.boardOrder[boardIndex - 1] ?? nextWorkspace.boardOrder[0];
    nextWorkspace.ui.activeBoardId = nextBoardId ?? null;
  }

  return nextWorkspace;
}

function applyBoardReset(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);

  if (isBoardResetNoOp(currentBoard)) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  nextWorkspace.boards[board.id] = {
    ...createWorkspaceBoard({
      id: board.id,
      title: board.title,
      createdAt: board.createdAt,
      updatedAt: context.now,
      creator: null
    }),
    stageOrder: [...board.stageOrder],
    stages: createClearedStages(board),
    templates: structuredClone(board.templates),
    collaboration: structuredClone(board.collaboration ?? { memberships: [], invites: [] }),
    aiLocalization: structuredClone(resolveBoardAiLocalization(board)),
    ...(copyBoardAiSecrets(board) ? { aiLocalizationSecrets: copyBoardAiSecrets(board) } : {}),
    languagePolicy: structuredClone(board.languagePolicy)
  };

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id
    })
  };
}

function applyCardCreate(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanEditBoard(currentBoard, context.actor);
  assertValidColumnId(command.payload.stageId, currentBoard);

  if (!stageSupportsAction(currentBoard, command.payload.stageId, 'card.create')) {
    throw new Error('Cards can only be created in create-enabled stages.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const cardId = context.createCardId();
  const initialStageId = command.payload.stageId;
  const sourceLocale = board.languagePolicy.sourceLocale;
  const requiresReview = command.payload.requiresReview === true;
  const workflowReviewStageId =
    requiresReview && stageSupportsAction(board, initialStageId, 'card.review')
      ? initialStageId
      : null;

  board.cards[cardId] = {
    id: cardId,
    priority: normalizePriority(command.payload.priority ?? DEFAULT_PRIORITY),
    createdAt: context.now,
    updatedAt: context.now,
    workflowReview: createCardWorkflowReview({
      required: requiresReview,
      currentStageId: workflowReviewStageId
    }),
    localeRequests: {},
    contentByLocale: {
      [sourceLocale]: {
        title: normalizeCardTitle(command.payload.title),
        detailsMarkdown: normalizeDetailsMarkdown(command.payload.detailsMarkdown),
        provenance: createCardContentProvenance({
          actor: context.actor ?? {
            type: 'system',
            id: 'command-engine'
          },
          timestamp: context.now,
          includesHumanInput: true
        }),
        review: createCardContentReview({
          origin: 'human'
        })
      }
    }
  };
  board.stages[initialStageId].cardIds = [...board.stages[initialStageId].cardIds, cardId];
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId
    })
  };
}

function applyCardUpdate(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanEditBoard(currentBoard, context.actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const sourceLocale = currentBoard.languagePolicy.sourceLocale;
  const currentVariant = getStoredCardContentVariant(currentCard, sourceLocale);

  const nextTitle = hasOwn(command.payload, 'title')
    ? normalizeCardTitle(command.payload.title)
    : (currentVariant?.title ?? '');
  const nextDetailsMarkdown = hasOwn(command.payload, 'detailsMarkdown')
    ? normalizeDetailsMarkdown(command.payload.detailsMarkdown)
    : (currentVariant?.detailsMarkdown ?? '');
  const nextPriority = hasOwn(command.payload, 'priority')
    ? normalizePriority(command.payload.priority)
    : currentCard.priority;
  const sourceContentChanged =
    currentVariant?.title !== nextTitle || currentVariant?.detailsMarkdown !== nextDetailsMarkdown;

  if (
    !sourceContentChanged &&
    currentCard.priority === nextPriority
  ) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  let nextCard = upsertCardContentVariant(
    {
      ...card,
      priority: nextPriority,
      updatedAt: context.now
    },
    sourceLocale,
    {
      title: nextTitle,
      detailsMarkdown: nextDetailsMarkdown
    },
    {
      actor: context.actor ?? {
        type: 'system',
        id: 'command-engine'
      },
      timestamp: context.now,
      includesHumanInput: true
    }
  );

  if (sourceContentChanged && card.workflowReview?.required === true) {
    nextCard = {
      ...nextCard,
      workflowReview: resetCardWorkflowReview(card.workflowReview, {
        currentStageId: card.workflowReview.currentStageId
      })
    };
  }

  board.cards[card.id] = nextCard;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id
    })
  };
}

function applyCardLocaleUpsert(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedActor(
    context.actor,
    'You must be signed in to modify localized card content.'
  );
  assertActorCanEditBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  assertBoardSupportsLocale(currentBoard, locale);
  const currentStoredVariant = getExistingCardLocaleVariant(currentCard, locale);
  const openRequest = getOpenLocalizationRequest(currentCard, locale);
  const nextTitle = normalizeCardTitle(command.payload.title);
  const nextDetailsMarkdown = normalizeDetailsMarkdown(command.payload.detailsMarkdown);
  const includesHumanInput = !isAutomatedActor(actor);
  const overrideHumanAuthoredContent = command.payload.overrideHumanAuthoredContent === true;

  if (
    currentStoredVariant &&
    currentStoredVariant.title === nextTitle &&
    currentStoredVariant.detailsMarkdown === nextDetailsMarkdown &&
    !openRequest
  ) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  if (
    !shouldAllowAutomatedLocaleWrite({
      existingVariant: currentStoredVariant,
      actor,
      includesHumanInput,
      overrideHumanAuthoredContent
    })
  ) {
    return {
      workspace,
      result: createBlockedAutomatedOverwriteResult(command, {
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  const provenance = createCardContentProvenance({
    actor,
    timestamp: context.now,
    includesHumanInput
  });
  const review = currentStoredVariant
    ? undefined
    : createCardContentReview({
      origin: includesHumanInput ? 'human' : 'ai'
    });
  let nextCard = upsertCardContentVariant(
    {
      ...card,
      updatedAt: context.now
    },
    locale,
    {
      title: nextTitle,
      detailsMarkdown: nextDetailsMarkdown
    },
    provenance,
    { review }
  );

  nextCard = clearCardLocaleRequest(nextCard, locale);
  board.cards[nextCard.id] = nextCard;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: nextCard.id,
      locale
    })
  };
}

function applyCardLocaleRequest(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to request localized card content.'
  );
  assertActorCanEditBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  assertBoardSupportsLocale(currentBoard, locale);
  const selectedVariant = getExistingCardLocaleVariant(currentCard, locale);
  const openRequest = getOpenLocalizationRequest(currentCard, locale);

  if (selectedVariant || openRequest) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  board.cards[card.id] = requestCardLocale(card, locale, actor, context.now);
  board.cards[card.id].updatedAt = context.now;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id,
      locale
    })
  };
}

function applyCardLocaleDiscard(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to discard localized card content.'
  );
  assertActorCanEditBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  assertBoardSupportsLocale(currentBoard, locale);

  if (currentBoard.languagePolicy?.sourceLocale === locale) {
    throw new Error('The source locale cannot be discarded.');
  }

  const selectedVariant = getExistingCardLocaleVariant(currentCard, locale);
  const openRequest = getOpenLocalizationRequest(currentCard, locale);

  if (!selectedVariant && !openRequest) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  let nextCard = discardCardContentVariant(
    {
      ...card,
      updatedAt: context.now
    },
    locale
  );

  nextCard = clearCardLocaleRequest(nextCard, locale);
  nextCard.updatedAt = context.now;
  board.cards[nextCard.id] = nextCard;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: nextCard.id,
      locale
    })
  };
}

function applyCardLocaleRequestClear(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to clear localized card requests.'
  );
  assertActorCanEditBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  const openRequest = getOpenLocalizationRequest(currentCard, locale);

  if (!openRequest) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  board.cards[card.id] = clearCardLocaleRequest(card, locale);
  board.cards[card.id].updatedAt = context.now;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id,
      locale
    })
  };
}

function applyCardLocaleReviewRequest(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to request human verification.'
  );
  assertActorCanReadBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  assertBoardSupportsLocale(currentBoard, locale);
  const currentStoredVariant = getExistingCardLocaleVariant(currentCard, locale);
  const currentReviewState = getCardContentReviewState(currentStoredVariant?.review ?? null);

  if (!currentStoredVariant || currentReviewState.status !== 'ai') {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextReview = requestCardContentHumanVerification(currentStoredVariant.review, actor, context.now);
  const nextReviewState = getCardContentReviewState(nextReview);
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);

  board.cards[card.id] = upsertCardContentVariant(
    {
      ...card,
      updatedAt: context.now
    },
    locale,
    {
      title: currentStoredVariant.title,
      detailsMarkdown: currentStoredVariant.detailsMarkdown
    },
    undefined,
    {
      review: nextReview
    }
  );
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id,
      locale
    }),
    activityEventInput: createCardLocaleReviewActivityEventInput({
      boardId: board.id,
      cardId: card.id,
      locale,
      reviewAction: 'request',
      reviewState: nextReviewState
    })
  };
}

function applyCardLocaleReviewVerify(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to verify localized card content.'
  );
  assertActorCanEditBoard(currentBoard, actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const locale = normalizeCommandLocale(command.payload.locale);
  assertBoardSupportsLocale(currentBoard, locale);
  const currentStoredVariant = getExistingCardLocaleVariant(currentCard, locale);
  const currentReviewState = getCardContentReviewState(currentStoredVariant?.review ?? null);

  if (!currentStoredVariant || currentReviewState.status == null || currentReviewState.status === 'verified') {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        locale
      })
    };
  }

  const nextReview = verifyCardContentHumanVerification(currentStoredVariant.review, actor, context.now);
  const nextReviewState = getCardContentReviewState(nextReview);
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);

  board.cards[card.id] = upsertCardContentVariant(
    {
      ...card,
      updatedAt: context.now
    },
    locale,
    {
      title: currentStoredVariant.title,
      detailsMarkdown: currentStoredVariant.detailsMarkdown
    },
    undefined,
    {
      review: nextReview
    }
  );
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id,
      locale
    }),
    activityEventInput: createCardLocaleReviewActivityEventInput({
      boardId: board.id,
      cardId: card.id,
      locale,
      reviewAction: 'verify',
      reviewState: nextReviewState
    })
  };
}

function applyCardDelete(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanEditBoard(currentBoard, context.actor);
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const sourceColumnId = findColumnIdByCardId(currentBoard, currentCard.id);

  if (!sourceColumnId) {
    throw new Error('Card is not in the source column.');
  }

  if (!stageSupportsAction(currentBoard, sourceColumnId, 'card.delete')) {
    throw new WorkspaceCommandPermissionError('Cards can only be deleted in delete-enabled stages.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);

  delete board.cards[card.id];

  if (sourceColumnId) {
    board.stages[sourceColumnId].cardIds = board.stages[sourceColumnId].cardIds.filter(
      (currentCardId) => currentCardId !== card.id
    );
  }
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id
    })
  };
}

function applyCardReviewApprove(workspace, command, context) {
  return applyCardReviewDecision(workspace, command, context, {
    nextStatus: 'approved'
  });
}

function applyCardReviewReject(workspace, command, context) {
  return applyCardReviewDecision(workspace, command, context, {
    nextStatus: 'rejected'
  });
}

function applyCardReviewDecision(workspace, command, context, { nextStatus } = {}) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  const actor = assertAuthenticatedHumanActor(
    context.actor,
    'You must be signed in to review cards.'
  );
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const stageId = findColumnIdByCardId(currentBoard, currentCard.id);
  const currentReview = currentCard.workflowReview;
  const membership = getBoardMembershipForActor(currentBoard, actor);
  const previousStatus = currentReview?.status ?? null;

  if (!stageId) {
    throw new Error('Card is not in a workflow stage.');
  }

  if (currentReview?.required !== true) {
    throw new Error('Card review is not required.');
  }

  if (!stageSupportsAction(currentBoard, stageId, 'card.review')) {
    throw new WorkspaceCommandPermissionError('Cards can only be reviewed in review-enabled stages.');
  }

  if (!canActorApproveCardReview(currentBoard, actor, stageId) || !membership?.role) {
    throw new WorkspaceCommandPermissionError('You do not have permission to review this card.');
  }

  if (previousStatus === nextStatus && currentReview?.currentStageId === stageId) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: currentBoard.id,
        cardId: currentCard.id,
        stageId,
        status: nextStatus
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);

  board.cards[card.id] = {
    ...card,
    workflowReview: createCardWorkflowReview({
      required: true,
      currentStageId: stageId,
      status: nextStatus,
      decidedAt: context.now,
      decidedBy: actor,
      decidedByRole: membership.role
    })
  };

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: board.id,
      cardId: card.id,
      stageId,
      status: nextStatus
    }),
    activityEventInput: createCardReviewDecisionActivityEventInput({
      boardId: board.id,
      cardId: card.id,
      stageId,
      previousStatus,
      nextStatus,
      decidedByRole: membership.role,
      contentUpdatedAt: currentCard.updatedAt
    })
  };
}

function applyCardMove(workspace, command, context) {
  const { boardId, cardId, sourceColumnId, targetColumnId } = command.payload;
  const currentBoard = getBoard(workspace, boardId);
  assertActorCanEditBoard(currentBoard, context.actor);
  assertValidColumnId(sourceColumnId, currentBoard);
  assertValidColumnId(targetColumnId, currentBoard);
  getCard(currentBoard, cardId);
  const sourceIndex = currentBoard.stages[sourceColumnId].cardIds.indexOf(cardId);

  if (sourceIndex === -1) {
    throw new Error('Card is not in the source column.');
  }

  if (sourceColumnId === targetColumnId) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId,
        cardId,
        sourceColumnId,
        targetColumnId
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, boardId);
  const card = getCard(board, cardId);
  board.stages[sourceColumnId].cardIds = board.stages[sourceColumnId].cardIds.filter(
    (currentCardId) => currentCardId !== cardId
  );
  board.stages[targetColumnId].cardIds = [...board.stages[targetColumnId].cardIds, cardId];
  let nextCard = {
    ...card,
    updatedAt: context.now
  };

  if (
    card.workflowReview?.required === true &&
    stageSupportsAction(board, targetColumnId, 'card.review') &&
    card.workflowReview.currentStageId !== targetColumnId
  ) {
    nextCard = {
      ...nextCard,
      workflowReview: resetCardWorkflowReview(card.workflowReview, {
        currentStageId: targetColumnId
      })
    };
  }

  board.cards[card.id] = nextCard;
  board.updatedAt = context.now;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId,
      cardId,
      sourceColumnId,
      targetColumnId
    })
  };
}

function applySetActiveBoard(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanReadBoard(currentBoard, context.actor);

  if (workspace.ui.activeBoardId === command.payload.boardId) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId: command.payload.boardId
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  nextWorkspace.ui.activeBoardId = command.payload.boardId;

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId: command.payload.boardId
    })
  };
}

function assertAuthenticatedHumanActor(actor, errorMessage) {
  const normalizedActor = normalizeBoardActor(actor);

  if (normalizedActor?.type !== 'human') {
    throw new WorkspaceCommandPermissionError(errorMessage);
  }

  return normalizedActor;
}

function assertAuthenticatedActor(actor, errorMessage) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor) {
    throw new WorkspaceCommandPermissionError(errorMessage);
  }

  return normalizedActor;
}

function assertActorCanManageWorkspaceTitle(context) {
  if (context?.viewerIsSuperAdmin !== true) {
    throw new WorkspaceCommandPermissionError('You do not have permission to manage workspace titles.');
  }
}

function assertActorCanReadBoard(board, actor) {
  const membership = getBoardMembershipForActor(board, actor);

  if (!membership || !canActorReadBoard(board, actor)) {
    throw new WorkspaceCommandPermissionError('You do not have permission to access this board.');
  }

  return membership;
}

function assertActorCanEditBoard(board, actor) {
  if (!canActorEditBoard(board, actor)) {
    throw new WorkspaceCommandPermissionError('You do not have permission to modify this board.');
  }
}

function assertActorCanAdminBoard(board, actor) {
  if (!canActorAdminBoard(board, actor)) {
    throw new WorkspaceCommandPermissionError('You do not have permission to administer this board.');
  }
}

function assertActorCanSelfAssignBoardRole(context) {
  if (context?.viewerIsSuperAdmin !== true) {
    throw new WorkspaceCommandPermissionError('You do not have permission to manage your board role.');
  }
}

function normalizeTargetActor(actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor) {
    throw new Error('Board member target actor is invalid.');
  }

  return normalizedActor;
}

function findBoardInvite(board, inviteId) {
  const normalizedInviteId = typeof inviteId === 'string' ? inviteId.trim() : '';

  if (!normalizedInviteId) {
    return null;
  }

  return normalizeBoardCollaboration(board).invites.find((invite) => invite.id === normalizedInviteId) ?? null;
}

function findPendingInvite(board, inviteId, now) {
  const invite = findBoardInvite(board, inviteId);
  return invite && resolveInviteStatus(invite, now) === 'pending' ? invite : null;
}

function emailsMatchInvite(actor, invite) {
  const normalizedActor = normalizeBoardActor(actor);
  return Boolean(normalizedActor?.email && invite?.email && normalizedActor.email === invite.email);
}

function countAdminMemberships(board) {
  return normalizeBoardCollaboration(board).memberships.filter((membership) => isBoardAdminMembership(membership)).length;
}

function upsertBoardMembership(board, membership) {
  const collaboration = ensureBoardCollaboration(board);
  const normalizedMembership = normalizeBoardMembership(membership);

  if (!normalizedMembership) {
    throw new Error('Board membership is invalid.');
  }

  const actorKey = createBoardActorKey(normalizedMembership.actor);
  const storedMembership = stripActorKey(normalizedMembership);
  const existingIndex = collaboration.memberships.findIndex(
    (currentMembership) => createBoardActorKey(currentMembership?.actor) === actorKey
  );

  if (existingIndex === -1) {
    collaboration.memberships = [...collaboration.memberships, storedMembership];
    return storedMembership;
  }

  collaboration.memberships = collaboration.memberships.map((currentMembership, index) =>
    index === existingIndex ? storedMembership : currentMembership
  );

  return storedMembership;
}

function removeBoardMembership(board, actor) {
  const collaboration = ensureBoardCollaboration(board);
  const actorKey = createBoardActorKey(actor);

  if (!actorKey) {
    throw new Error('Board member target actor is invalid.');
  }

  collaboration.memberships = collaboration.memberships.filter(
    (membership) => createBoardActorKey(membership?.actor) !== actorKey
  );
}

function updateInviteStatus(board, inviteId, status, respondedAt) {
  const collaboration = ensureBoardCollaboration(board);
  const normalizedStatus = typeof status === 'string' ? status.trim().toLowerCase() : '';
  const inviteIndex = collaboration.invites.findIndex((invite) => invite?.id === inviteId);

  if (inviteIndex === -1) {
    throw new Error('Board invite not found.');
  }

  const normalizedInvite = normalizeBoardInvite({
    ...collaboration.invites[inviteIndex],
    status: normalizedStatus,
    ...(respondedAt ? { respondedAt } : {})
  });

  if (!normalizedInvite) {
    throw new Error('Board invite is invalid.');
  }

  collaboration.invites = collaboration.invites.map((invite, index) => (index === inviteIndex ? normalizedInvite : invite));

  return normalizedInvite;
}

function ensureBoardCollaboration(board) {
  board.collaboration = normalizeBoardCollaboration(board);
  delete board.memberships;
  delete board.invites;
  return board.collaboration;
}

function resolveInviteStatus(invite, now) {
  if (invite?.status !== 'pending') {
    return invite?.status ?? null;
  }

  if (invite?.expiresAt && typeof now === 'string' && invite.expiresAt <= now) {
    return 'expired';
  }

  return invite.status;
}

function assertInvitePending(invite, now) {
  if (resolveInviteStatus(invite, now) === 'pending') {
    return invite;
  }

  switch (resolveInviteStatus(invite, now)) {
    case 'accepted':
      throw new Error('Board invite has already been accepted.');
    case 'declined':
      throw new Error('Board invite has already been declined.');
    case 'revoked':
      throw new Error('Board invite has been revoked.');
    case 'expired':
      throw new Error('Board invite has expired.');
    default:
      throw new Error('Board invite is not pending.');
  }
}

function applyNormalizedSchemaToBoard(board, normalizedSchema, { preserveCardIdsFrom = null } = {}) {
  board.stageOrder = [...normalizedSchema.stageOrder];
  board.stages = Object.fromEntries(
    normalizedSchema.stageOrder.map((stageId) => [
      stageId,
      {
        ...structuredClone(normalizedSchema.stages[stageId]),
        cardIds: preserveCardIdsFrom?.stages?.[stageId]?.cardIds
          ? [...preserveCardIdsFrom.stages[stageId].cardIds]
          : []
      }
    ])
  );
  board.templates = structuredClone(normalizedSchema.templatesByGroup);
  board.languagePolicy = structuredClone(normalizedSchema.languagePolicy);
}

function applyBoardLocalizationGlossary(board, localizationGlossary) {
  board.localizationGlossary = structuredClone(localizationGlossary);
}

function createCommandResult(command, data = {}) {
  return {
    clientMutationId: command.clientMutationId,
    type: command.type,
    noOp: false,
    ...data
  };
}

function createBlockedAutomatedOverwriteResult(command, data = {}) {
  return createCommandResult(command, {
    noOp: true,
    blocked: true,
    reason: 'human-authored-locale-protected',
    ...data
  });
}

function createCardLocaleReviewActivityEventInput({
  boardId,
  cardId,
  locale,
  reviewAction,
  reviewState
} = {}) {
  return {
    type:
      reviewAction === 'verify'
        ? 'workspace.card.locale.review.verified'
        : 'workspace.card.locale.review.requested',
    entity: {
      kind: 'card',
      boardId,
      cardId
    },
    details: {
      locale,
      reviewAction,
      reviewStatus: reviewState?.status ?? null
    }
  };
}

function createCardReviewDecisionActivityEventInput({
  boardId,
  cardId,
  stageId,
  previousStatus,
  nextStatus,
  decidedByRole,
  contentUpdatedAt
} = {}) {
  return {
    type:
      nextStatus === 'approved'
        ? 'workspace.card.review.approved'
        : 'workspace.card.review.rejected',
    entity: {
      kind: 'card',
      boardId,
      cardId
    },
    details: {
      stageId,
      previousStatus,
      nextStatus,
      decidedByRole,
      contentUpdatedAt
    }
  };
}

function assertExpectedRevision(expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expectedRevision must be a non-negative integer.');
  }
}

function isBoardResetNoOp(board) {
  return board.stageOrder.every((stageId) => board.stages[stageId]?.cardIds?.length === 0);
}

function hasOwn(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function hasBoardSchemaPayload(payload) {
  return Boolean(
    payload &&
      (
        hasOwn(payload, 'languagePolicy') ||
        hasOwn(payload, 'stageDefinitions') ||
        hasOwn(payload, 'templates')
      )
  );
}

function resolveNextBoardLocalizationGlossary(board, payload, { supportedLocales = null } = {}) {
  if (!hasOwn(payload, 'localizationGlossary')) {
    return normalizeBoardLocalizationGlossary(board?.localizationGlossary, {
      supportedLocales: supportedLocales ?? board?.languagePolicy?.supportedLocales
    });
  }

  return normalizeBoardLocalizationGlossary(payload.localizationGlossary, {
    supportedLocales
  });
}

function resolveNextBoardAiSettings(board, payload, context) {
  const provider = normalizeBoardAiProvider(payload?.aiProvider) ?? resolveBoardAiLocalization(board).provider;
  const replacementApiKey = normalizeOptionalString(payload?.openAiApiKey);
  const clearOpenAiApiKey = payload?.clearOpenAiApiKey === true;
  const currentAiLocalization = resolveBoardAiLocalization(board);
  const currentAiSecrets = copyBoardAiSecrets(board);

  if (clearOpenAiApiKey) {
    return {
      aiLocalization: {
        provider,
        hasApiKey: false,
        apiKeyLast4: null
      },
      aiLocalizationSecrets: null
    };
  }

  if (replacementApiKey) {
    return {
      aiLocalization: {
        provider,
        hasApiKey: true,
        apiKeyLast4: deriveApiKeyLast4(replacementApiKey)
      },
      aiLocalizationSecrets: {
        [BOARD_OPENAI_SECRET_FIELD]: encryptBoardSecret(replacementApiKey, context)
      }
    };
  }

  return {
    aiLocalization: {
      provider,
      hasApiKey: currentAiLocalization.hasApiKey,
      apiKeyLast4: currentAiLocalization.hasApiKey ? currentAiLocalization.apiKeyLast4 : null
    },
    aiLocalizationSecrets: currentAiSecrets
  };
}

function applyBoardAiSettings(board, aiSettings) {
  board.aiLocalization = structuredClone(aiSettings.aiLocalization);

  if (aiSettings.aiLocalizationSecrets) {
    board.aiLocalizationSecrets = structuredClone(aiSettings.aiLocalizationSecrets);
    return;
  }

  delete board.aiLocalizationSecrets;
}

function boardAiSettingsEqual(board, aiSettings) {
  return JSON.stringify(normalizeBoardAiLocalization(board?.aiLocalization)) === JSON.stringify(aiSettings.aiLocalization)
    && JSON.stringify(copyBoardAiSecrets(board)) === JSON.stringify(aiSettings.aiLocalizationSecrets);
}

function boardLocalizationGlossaryEqual(board, localizationGlossary) {
  return JSON.stringify(
    normalizeBoardLocalizationGlossary(board?.localizationGlossary, {
      supportedLocales: board?.languagePolicy?.supportedLocales
    })
  ) === JSON.stringify(localizationGlossary);
}

function resolveBoardAiLocalization(board) {
  const normalizedAiLocalization = normalizeBoardAiLocalization(board?.aiLocalization);
  const persistedEncryptedApiKey = normalizeOptionalString(board?.aiLocalizationSecrets?.[BOARD_OPENAI_SECRET_FIELD]);

  if (!persistedEncryptedApiKey) {
    return {
      provider: normalizedAiLocalization.provider,
      hasApiKey: false,
      apiKeyLast4: null
    };
  }

  return {
    provider: normalizedAiLocalization.provider ?? BOARD_AI_PROVIDER_OPENAI,
    hasApiKey: true,
    apiKeyLast4: normalizedAiLocalization.apiKeyLast4
  };
}

function copyBoardAiSecrets(board) {
  const encryptedApiKey = normalizeOptionalString(board?.aiLocalizationSecrets?.[BOARD_OPENAI_SECRET_FIELD]);

  if (!encryptedApiKey) {
    return null;
  }

  return {
    [BOARD_OPENAI_SECRET_FIELD]: encryptedApiKey
  };
}

function deriveApiKeyLast4(apiKey) {
  return normalizeOptionalString(apiKey).slice(-4) || null;
}

function createClearedStages(board) {
  return Object.fromEntries(
    board.stageOrder.map((stageId) => [
      stageId,
      {
        ...structuredClone(board.stages[stageId]),
        cardIds: []
      }
    ])
  );
}

function normalizeCommandLocale(locale) {
  const normalizedLocale = canonicalizeContentLocale(locale);

  if (!normalizedLocale) {
    throw new Error('Card locale is invalid.');
  }

  return normalizedLocale;
}

function assertBoardSupportsLocale(board, locale) {
  if (!board?.languagePolicy?.supportedLocales?.includes(locale)) {
    throw new Error('Card locale is not supported by this board.');
  }
}

function getExistingCardLocaleVariant(card, locale) {
  return getStoredCardContentVariant(card, locale);
}

function isAutomatedActor(actor) {
  const normalizedActor = normalizeBoardActor(actor);
  return normalizedActor?.type === 'agent' || normalizedActor?.type === 'system';
}

function shouldAllowAutomatedLocaleWrite({
  existingVariant,
  actor,
  includesHumanInput,
  overrideHumanAuthoredContent
} = {}) {
  if (!isAutomatedActor(actor) || includesHumanInput) {
    return true;
  }

  if (!existingVariant || !isHumanAuthoredVariant(existingVariant)) {
    return true;
  }

  if (overrideHumanAuthoredContent === true) {
    return true;
  }

  return !shouldBlockAutomatedLocaleOverwrite({
    existingVariant,
    incomingProvenance: {
      actor,
      includesHumanInput
    }
  });
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripActorKey(membership) {
  const normalizedMembership = {
    ...membership
  };

  delete normalizedMembership.actorKey;

  return normalizedMembership;
}

function createBoardInviteId() {
  return `invite_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function logInviteDebug(context, event, fields) {
  if (typeof context?.debugLog === 'function') {
    context.debugLog(event, fields);
  }
}

function logInviteAcceptDebug(context, event, fields) {
  if (typeof context?.acceptDebugLog === 'function') {
    context.acceptDebugLog(event, fields);
  }
}

function isInviteDecisionType(type) {
  return type === 'board.invite.accept' || type === 'board.invite.decline';
}
