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
import { canonicalizeContentLocale } from '../../public/js/domain/board_language_policy.js';
import {
  canActorAdminBoard,
  canActorEditBoard,
  canActorReadBoard,
  getBoardMembershipForActor,
  isBoardAdminMembership
} from '../../public/js/domain/board_permissions.js';
import {
  createCardContentProvenance,
  getStoredCardContentVariant,
  upsertCardContentVariant
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
  cloneWorkspace,
  createWorkspaceBoard,
  DEFAULT_PRIORITY
} from '../../public/js/domain/workspace_read_model.js';
import { findColumnIdByCardId, getBoard, getCard } from '../../public/js/domain/workspace_selectors.js';
import {
  assertValidColumnId,
  normalizeBoardTitle,
  normalizeCardTitle,
  normalizeDetailsMarkdown,
  normalizePriority
} from '../../public/js/domain/workspace_validation.js';
import { createDefaultMutationContext, createMutationContext } from './mutation_context.js';
import {
  createWorkspaceActivityEvent,
  createWorkspaceActivityEventId,
  createWorkspaceRecord
} from './workspace_record.js';
import { WorkspaceRevisionConflictError } from './workspace_record_repository.js';

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

  if (currentRecord.revision !== expectedRevision) {
    throw new WorkspaceRevisionConflictError();
  }

  const { workspace, result } = applyCommandToWorkspace({
    workspace: currentRecord.workspace,
    command,
    context: mutationContext
  });

  const activityEvent = result.noOp
    ? null
    : createWorkspaceActivityEvent({
        id: createWorkspaceActivityEventId(),
        type: 'workspace.command.applied',
        actor: mutationContext.actor,
        createdAt: mutationContext.now,
        revision: currentRecord.revision + 1
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
    case 'card.locale.request':
      return applyCardLocaleRequest(workspace, command, context);
    case 'card.locale.request.clear':
      return applyCardLocaleRequestClear(workspace, command, context);
    case 'card.delete':
      return applyCardDelete(workspace, command, context);
    case 'card.move':
      return applyCardMove(workspace, command, context);
    case 'ui.activeBoard.set':
      return applySetActiveBoard(workspace, command, context);
    default:
      throw new Error(`Unsupported workspace command type: ${command.type}`);
  }
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

  if (normalizedSchema) {
    applyNormalizedSchemaToBoard(board, normalizedSchema);
  }

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

  assertBoardSchemaCompatibleWithBoard(currentBoard, normalizedSchema);

  if (
    currentBoard.title === normalizedTitle &&
    JSON.stringify(serializeBoardSchemaInput(currentBoard)) ===
      JSON.stringify({
        languagePolicy: normalizedSchema.languagePolicy,
        stageDefinitions: normalizedSchema.stageDefinitions,
        templates: normalizedSchema.templates
      })
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

  if (!currentInvite || !emailsMatchInvite(actor, currentInvite)) {
    throw new WorkspaceCommandPermissionError('You do not have permission to respond to this invite.');
  }

  if (!pendingInvite) {
    assertInvitePending(currentInvite, context.now);
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  updateInviteStatus(board, command.payload.inviteId, 'accepted', context.now);

  if (!getBoardMembershipForActor(board, actor)) {
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

  if (!currentInvite || !emailsMatchInvite(actor, currentInvite)) {
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

  if (currentMembership.role === nextRole) {
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
    ...currentMembership,
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

function applyBoardMemberRemove(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
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
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanAdminBoard(currentBoard, context.actor);

  if (workspace.boardOrder.length === 1) {
    throw new Error('Cannot delete the last remaining board.');
  }

  const nextWorkspace = cloneWorkspace(workspace);
  const boardId = command.payload.boardId;
  const boardIndex = nextWorkspace.boardOrder.indexOf(boardId);

  if (boardIndex === -1 || !nextWorkspace.boards[boardId]) {
    throw new Error('Board not found.');
  }

  nextWorkspace.boardOrder = nextWorkspace.boardOrder.filter((currentBoardId) => currentBoardId !== boardId);
  delete nextWorkspace.boards[boardId];

  if (nextWorkspace.ui.activeBoardId === boardId) {
    const nextBoardId =
      nextWorkspace.boardOrder[boardIndex] ?? nextWorkspace.boardOrder[boardIndex - 1] ?? nextWorkspace.boardOrder[0];
    nextWorkspace.ui.activeBoardId = nextBoardId;
  }

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId
    })
  };
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
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const cardId = context.createCardId();
  const initialStageId = board.stageOrder[0];
  const sourceLocale = board.languagePolicy.sourceLocale;

  board.cards[cardId] = {
    id: cardId,
    priority: normalizePriority(command.payload.priority ?? DEFAULT_PRIORITY),
    createdAt: context.now,
    updatedAt: context.now,
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

  if (
    currentVariant?.title === nextTitle &&
    currentVariant?.detailsMarkdown === nextDetailsMarkdown &&
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
  board.cards[card.id] = upsertCardContentVariant(
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
    provenance
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

function applyCardDelete(workspace, command, context) {
  const currentBoard = getBoard(workspace, command.payload.boardId);
  assertActorCanEditBoard(currentBoard, context.actor);
  getCard(currentBoard, command.payload.cardId);
  const nextWorkspace = cloneWorkspace(workspace);
  const board = getBoard(nextWorkspace, command.payload.boardId);
  const card = getCard(board, command.payload.cardId);
  const sourceColumnId = findColumnIdByCardId(board, card.id);

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
  board.cards[card.id] = {
    ...card,
    updatedAt: context.now
  };
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
