import { assertValidWorkspaceCommand } from '../../public/js/domain/workspace_commands.js';
import {
  assertBoardSchemaCompatibleWithBoard,
  normalizeBoardSchemaInput,
  serializeBoardSchemaInput
} from '../../public/js/domain/board_schema.js';
import {
  createCardContentProvenance,
  getCardContentVariant,
  projectWorkspaceWithLegacyCardContent,
  upsertCardContentVariant
} from '../../public/js/domain/card_localization.js';
import {
  cloneWorkspace,
  createCollapsedColumns,
  createWorkspaceBoard,
  DEFAULT_PRIORITY
} from '../../public/js/domain/workspace_read_model.js';
import {
  findColumnIdByCardId,
  getBoard,
  getCard,
  getCollapsedColumnsForBoard
} from '../../public/js/domain/workspace_selectors.js';
import {
  assertValidBoardId,
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
    workspace: projectWorkspaceWithLegacyCardContent(workspace),
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
    case 'board.delete':
      return applyBoardDelete(workspace, command);
    case 'board.reset':
      return applyBoardReset(workspace, command, context);
    case 'card.create':
      return applyCardCreate(workspace, command, context);
    case 'card.update':
      return applyCardUpdate(workspace, command, context);
    case 'card.delete':
      return applyCardDelete(workspace, command, context);
    case 'card.move':
      return applyCardMove(workspace, command, context);
    case 'ui.activeBoard.set':
      return applySetActiveBoard(workspace, command);
    case 'ui.columnCollapsed.set':
      return applySetColumnCollapsed(workspace, command);
    default:
      throw new Error(`Unsupported workspace command type: ${command.type}`);
  }
}

function applyBoardCreate(workspace, command, context) {
  const nextWorkspace = cloneWorkspace(workspace);
  const boardId = context.createBoardId();
  const board = createWorkspaceBoard({
    id: boardId,
    title: normalizeBoardTitle(command.payload.title),
    createdAt: context.now,
    updatedAt: context.now
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
  ensureCollapsedColumnsByBoard(nextWorkspace);
  nextWorkspace.ui.collapsedColumnsByBoard[board.id] = createCollapsedColumns(
    normalizedSchema?.stageOrder ?? board.stageOrder
  );

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
  syncCollapsedColumnsForBoard(nextWorkspace, board.id, normalizedSchema.stageOrder);

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

function applyBoardDelete(workspace, command) {
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
  ensureCollapsedColumnsByBoard(nextWorkspace);
  delete nextWorkspace.ui.collapsedColumnsByBoard[boardId];

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
      updatedAt: context.now
    }),
    stageOrder: [...board.stageOrder],
    stages: createClearedStages(board),
    templates: structuredClone(board.templates),
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
  const currentCard = getCard(currentBoard, command.payload.cardId);
  const sourceLocale = currentBoard.languagePolicy.sourceLocale;
  const currentVariant = getCardContentVariant(currentCard, sourceLocale, currentBoard);

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
      ...stripLegacyCardAliases(card),
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

function applyCardDelete(workspace, command, context) {
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

function applySetActiveBoard(workspace, command) {
  assertValidBoardId(command.payload.boardId, workspace.boards);

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

function applySetColumnCollapsed(workspace, command) {
  const { boardId, columnId, isCollapsed } = command.payload;
  const board = getBoard(workspace, boardId);
  assertValidColumnId(columnId, board);

  const currentCollapsedColumns = getCollapsedColumnsForBoard(workspace, boardId);

  if (currentCollapsedColumns[columnId] === Boolean(isCollapsed)) {
    return {
      workspace,
      result: createCommandResult(command, {
        noOp: true,
        boardId,
        columnId,
        isCollapsed: Boolean(isCollapsed)
      })
    };
  }

  const nextWorkspace = cloneWorkspace(workspace);
  ensureCollapsedColumnsByBoard(nextWorkspace);
  nextWorkspace.ui.collapsedColumnsByBoard[boardId] = getCollapsedColumnsForBoard(nextWorkspace, boardId);
  nextWorkspace.ui.collapsedColumnsByBoard[boardId][columnId] = Boolean(isCollapsed);

  return {
    workspace: nextWorkspace,
    result: createCommandResult(command, {
      boardId,
      columnId,
      isCollapsed: Boolean(isCollapsed)
    })
  };
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

function assertExpectedRevision(expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expectedRevision must be a non-negative integer.');
  }
}

function isBoardResetNoOp(board) {
  return board.stageOrder.every((stageId) => board.stages[stageId]?.cardIds?.length === 0);
}

function ensureCollapsedColumnsByBoard(workspace) {
  if (!workspace.ui.collapsedColumnsByBoard || typeof workspace.ui.collapsedColumnsByBoard !== 'object') {
    workspace.ui.collapsedColumnsByBoard = {};
  }
}

function syncCollapsedColumnsForBoard(workspace, boardId, stageOrder) {
  ensureCollapsedColumnsByBoard(workspace);
  const currentState = workspace.ui.collapsedColumnsByBoard[boardId] ?? {};
  const nextState = createCollapsedColumns(stageOrder);

  for (const stageId of stageOrder) {
    if (Object.prototype.hasOwnProperty.call(currentState, stageId)) {
      nextState[stageId] = Boolean(currentState[stageId]);
    }
  }

  workspace.ui.collapsedColumnsByBoard[boardId] = nextState;
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

function stripLegacyCardAliases(card) {
  const canonicalCard = {
    ...card
  };

  delete canonicalCard.title;
  delete canonicalCard.detailsMarkdown;

  return canonicalCard;
}
