import {
  canonicalizeBoardRole,
  listPendingBoardInvites,
  normalizeBoardCollaboration
} from '../../public/js/domain/board_collaboration.js';
import { normalizeBoardAiLocalization } from '../../public/js/domain/board_ai_localization.js';
import { createDefaultBoardLanguagePolicy } from '../../public/js/domain/board_language_policy.js';
import { createDefaultBoardStages, createDefaultBoardTemplates } from '../../public/js/domain/board_workflow.js';

const BOARD_OPENAI_SECRET_FIELD = 'openAiApiKeyEncrypted';

export function canViewerAccessWorkspace({ viewerSub, viewerEmail = null, ownerSub, workspace, debugLog = null }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const normalizedOwnerSub = normalizeOptionalString(ownerSub);

  if (!normalizedViewerSub) {
    return false;
  }

  if (normalizedOwnerSub && normalizedOwnerSub === normalizedViewerSub) {
    return true;
  }

  if (!isPlainObject(workspace?.boards)) {
    return false;
  }

  for (const board of Object.values(workspace.boards)) {
    if (
      canViewerAccessBoardShell({
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        board,
        debugLog
      })
    ) {
      return true;
    }
  }

  return false;
}

export function canViewerReadBoard({ viewerSub, viewerEmail = null, board }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);

  if (!normalizedViewerSub) {
    return false;
  }

  return hasHumanBoardMembership(board, normalizedViewerSub);
}

export function filterWorkspaceForViewer({ viewerSub, viewerEmail = null, ownerSub, workspace, debugLog = null }) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  const normalizedWorkspace = structuredClone(workspace);
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const normalizedOwnerSub = normalizeOptionalString(ownerSub);

  if (!normalizedViewerSub) {
    return createFilteredWorkspace(normalizedWorkspace, []);
  }

  if (normalizedOwnerSub && normalizedOwnerSub === normalizedViewerSub) {
    return createOwnerWorkspaceProjection(normalizedWorkspace, {
      ownerSub: normalizedOwnerSub,
      ownerEmail: normalizedViewerEmail
    });
  }

  const visibleBoards = [];

  for (const boardEntry of listWorkspaceBoardEntries(normalizedWorkspace)) {
    const membershipMatch = canViewerReadBoard({
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      board: boardEntry.board
    });

    if (membershipMatch) {
      logWorkspaceProjection(debugLog, {
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        boardId: boardEntry.boardId,
        membershipMatch,
        pendingInviteMatch: false,
        projectionResult: 'readable'
      });
      visibleBoards.push({
        boardId: boardEntry.boardId,
        board: createReadableBoardProjection(boardEntry.board)
      });
      continue;
    }

    const pendingInviteMatch = hasPendingBoardInvite(
      boardEntry.board,
      normalizedViewerSub,
      normalizedViewerEmail,
      debugLog
    );

    if (pendingInviteMatch) {
      logWorkspaceProjection(debugLog, {
        viewerSub: normalizedViewerSub,
        viewerEmail: normalizedViewerEmail,
        boardId: boardEntry.boardId,
        membershipMatch: false,
        pendingInviteMatch,
        projectionResult: 'invite-shell'
      });
      visibleBoards.push({
        boardId: boardEntry.boardId,
        board: createPendingInviteBoardProjection(boardEntry.board)
      });

      continue;
    }

    logWorkspaceProjection(debugLog, {
      viewerSub: normalizedViewerSub,
      viewerEmail: normalizedViewerEmail,
      boardId: boardEntry.boardId,
      membershipMatch: false,
      pendingInviteMatch: false,
      projectionResult: 'hidden'
    });
  }

  return createFilteredWorkspace(normalizedWorkspace, visibleBoards);
}

export function listViewerPendingBoardInvites({ viewerSub, viewerEmail = null, workspace }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);

  if (!normalizedViewerSub || !isPlainObject(workspace?.boards)) {
    return [];
  }

  const pendingInvites = [];

  for (const { boardId, board } of listWorkspaceBoardEntries(workspace)) {
    for (const invite of listPendingBoardInvites(board)) {
      if (!inviteMatchesViewer(invite, normalizedViewerSub, normalizedViewerEmail)) {
        continue;
      }

      pendingInvites.push({
        boardId,
        boardTitle: normalizeOptionalString(board?.title),
        invite
      });
    }
  }

  return pendingInvites;
}

export function canViewerReplaceWorkspaceSnapshot({ viewerSub, viewerEmail = null, ownerSub, workspace }) {
  const normalizedViewerSub = normalizeOptionalString(viewerSub);
  const normalizedOwnerSub = normalizeOptionalString(ownerSub);

  if (!normalizedViewerSub || !isPlainObject(workspace?.boards)) {
    return false;
  }

  if (normalizedOwnerSub && normalizedOwnerSub === normalizedViewerSub) {
    return true;
  }

  for (const board of Object.values(workspace.boards)) {
    if (!canViewerReadBoard({ viewerSub: normalizedViewerSub, viewerEmail, board })) {
      return false;
    }
  }

  return true;
}

function hasHumanBoardMembership(board, viewerSub) {
  for (const membership of readBoardMemberships(board)) {
    const actorType = normalizeOptionalString(membership?.actor?.type).toLowerCase();
    const actorId = normalizeOptionalString(membership?.actor?.id);

    if (actorType !== 'human' || actorId !== viewerSub) {
      continue;
    }

    if (canonicalizeBoardRole(membership?.role)) {
      return true;
    }
  }

  return false;
}

function hasPendingBoardInvite(board, viewerSub, viewerEmail, debugLog = null) {
  for (const invite of listPendingBoardInvites(board)) {
    const matched = inviteMatchesViewer(invite, viewerSub, viewerEmail);

    logWorkspaceProjection(debugLog, {
      viewerSub,
      viewerEmail,
      boardId: normalizeOptionalString(board?.id),
      inviteId: normalizeOptionalString(invite?.id),
      inviteEmail: normalizeOptionalEmail(invite?.email),
      inviteActorId: normalizeOptionalString(invite?.actor?.id),
      membershipMatch: false,
      pendingInviteMatch: matched,
      projectionResult: matched ? 'invite-shell' : 'hidden',
      phase: 'pending-invite-check'
    });

    if (matched) {
      return true;
    }
  }

  return false;
}

function canViewerAccessBoardShell({ viewerSub, viewerEmail, board, debugLog = null }) {
  return canViewerReadBoard({ viewerSub, viewerEmail, board }) || hasPendingBoardInvite(board, viewerSub, viewerEmail, debugLog);
}

function inviteMatchesViewer(invite, viewerSub, viewerEmail) {
  const inviteActorType = normalizeOptionalString(invite?.actor?.type).toLowerCase();
  const inviteActorId = normalizeOptionalString(invite?.actor?.id);
  const inviteEmail = normalizeOptionalEmail(invite?.email);

  if (inviteActorType === 'human' && inviteActorId === viewerSub) {
    return true;
  }

  return Boolean(viewerEmail && inviteEmail && inviteEmail === viewerEmail);
}

function createPendingInviteBoardProjection(board) {
  const defaultStages = createDefaultBoardStages();

  return {
    id: normalizeOptionalString(board?.id),
    title: normalizeOptionalString(board?.title),
    createdAt: typeof board?.createdAt === 'string' ? board.createdAt : '',
    updatedAt: typeof board?.updatedAt === 'string' ? board.updatedAt : '',
    stageOrder: defaultStages.map((stage) => stage.id),
    stages: Object.fromEntries(defaultStages.map((stage) => [stage.id, structuredClone(stage)])),
    templates: createDefaultBoardTemplates(),
    collaboration: normalizeBoardCollaboration(board),
    aiLocalization: resolveProjectedBoardAiLocalization(board),
    languagePolicy: createDefaultBoardLanguagePolicy(),
    cards: {}
  };
}

function createOwnerWorkspaceProjection(workspace, { ownerSub, ownerEmail = '' } = {}) {
  const ownerActor = resolveOwnerActor(workspace, ownerSub, ownerEmail);
  const nextWorkspace = structuredClone(workspace);

  if (!isPlainObject(nextWorkspace?.boards)) {
    return nextWorkspace;
  }

  for (const [boardId, board] of Object.entries(nextWorkspace.boards)) {
    const nextBoard = ownerActor ? ensureOwnerBoardMembership(board, ownerActor) : board;
    nextWorkspace.boards[boardId] = createReadableBoardProjection(nextBoard);
  }

  return nextWorkspace;
}

function createFilteredWorkspace(workspace, visibleBoards) {
  const nextBoardOrder = visibleBoards.map(({ boardId }) => boardId);
  const currentActiveBoardId = normalizeOptionalString(workspace?.ui?.activeBoardId);
  const nextActiveBoardId = nextBoardOrder.includes(currentActiveBoardId) ? currentActiveBoardId : (nextBoardOrder[0] ?? null);
  const nextUi = isPlainObject(workspace?.ui) ? structuredClone(workspace.ui) : {};

  delete nextUi.collapsedColumnsByBoard;

  return {
    ...workspace,
    boardOrder: nextBoardOrder,
    boards: Object.fromEntries(visibleBoards.map(({ boardId, board }) => [boardId, board])),
    ui: {
      ...nextUi,
      activeBoardId: nextActiveBoardId
    }
  };
}

function listWorkspaceBoardEntries(workspace) {
  const boardIdsInOrder = [];
  const seenBoardIds = new Set();

  for (const boardId of Array.isArray(workspace?.boardOrder) ? workspace.boardOrder : []) {
    if (typeof boardId !== 'string' || seenBoardIds.has(boardId) || !isPlainObject(workspace?.boards?.[boardId])) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIdsInOrder.push(boardId);
  }

  for (const boardId of Object.keys(workspace?.boards ?? {})) {
    if (seenBoardIds.has(boardId) || !isPlainObject(workspace.boards[boardId])) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIdsInOrder.push(boardId);
  }

  return boardIdsInOrder.map((boardId) => ({
    boardId,
    board: workspace.boards[boardId]
  }));
}

function ensureOwnerBoardMembership(board, ownerActor) {
  const collaboration = normalizeBoardCollaboration(board);

  if (collaboration.memberships.some((membership) => ownerActorMatchesMembership(ownerActor, membership))) {
    return {
      ...board,
      collaboration
    };
  }

  return {
    ...board,
    collaboration: {
      ...collaboration,
      memberships: [
        ...collaboration.memberships,
        {
          actor: ownerActor,
          role: 'admin',
          ...(typeof board?.createdAt === 'string' ? { joinedAt: board.createdAt } : {})
        }
      ]
    }
  };
}

function createReadableBoardProjection(board) {
  const nextBoard = structuredClone(board);
  nextBoard.aiLocalization = resolveProjectedBoardAiLocalization(nextBoard);

  delete nextBoard.aiLocalizationSecrets;

  return nextBoard;
}

function resolveProjectedBoardAiLocalization(board) {
  const normalizedAiLocalization = normalizeBoardAiLocalization(board?.aiLocalization);
  const persistedEncryptedApiKey = normalizeOptionalString(board?.aiLocalizationSecrets?.[BOARD_OPENAI_SECRET_FIELD]);
  const hasApiKey = normalizedAiLocalization.hasApiKey || Boolean(persistedEncryptedApiKey);

  return {
    provider: normalizedAiLocalization.provider,
    hasApiKey,
    apiKeyLast4: hasApiKey ? normalizedAiLocalization.apiKeyLast4 : null
  };
}

function ownerActorMatchesMembership(ownerActor, membership) {
  return normalizeOptionalString(membership?.actor?.type).toLowerCase() === ownerActor.type
    && normalizeOptionalString(membership?.actor?.id) === ownerActor.id
    && canonicalizeBoardRole(membership?.role) != null;
}

function resolveOwnerActor(workspace, ownerSub, ownerEmail) {
  const normalizedOwner = workspace?.ownership?.owner;

  if (
    normalizeOptionalString(normalizedOwner?.type).toLowerCase() === 'human'
    && normalizeOptionalString(normalizedOwner?.id) === ownerSub
  ) {
    return {
      type: 'human',
      id: ownerSub,
      ...(normalizeOptionalEmail(normalizedOwner?.email) ? { email: normalizeOptionalEmail(normalizedOwner.email) } : {}),
      ...(normalizeOptionalString(normalizedOwner?.displayName) ? { displayName: normalizeOptionalString(normalizedOwner.displayName) } : {})
    };
  }

  return {
    type: 'human',
    id: ownerSub,
    ...(ownerEmail ? { email: ownerEmail } : {})
  };
}

function readBoardMemberships(board) {
  if (Array.isArray(board?.collaboration?.memberships)) {
    return board.collaboration.memberships;
  }

  if (Array.isArray(board?.memberships)) {
    return board.memberships;
  }

  return [];
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue.includes('@') ? normalizedValue : '';
}

function logWorkspaceProjection(debugLog, fields) {
  if (typeof debugLog === 'function') {
    debugLog('workspace.projection', fields);
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
