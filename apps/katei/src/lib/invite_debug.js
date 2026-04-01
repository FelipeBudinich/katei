import { normalizeBoardCollaboration } from '../../public/js/domain/board_collaboration.js';

const TRUTHY_FLAG_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function createInviteDebugLogger({
  request = null,
  enabled = shouldDebugInvites(request),
  sink = console.info.bind(console)
} = {}) {
  if (!enabled || typeof sink !== 'function') {
    return () => {};
  }

  return function logInviteDebug(event, fields = {}) {
    sink('[invite-debug]', event, normalizeDebugFields(fields));
  };
}

export function createInviteAcceptDebugLogger({
  request = null,
  enabled = shouldDebugInvites(request),
  sink = console.info.bind(console)
} = {}) {
  if (!enabled || typeof sink !== 'function') {
    return () => {};
  }

  return function logInviteAcceptDebug(event, fields = {}) {
    sink('[invite-accept-debug]', event, normalizeDebugFields(fields));
  };
}

export function shouldDebugInvites(request) {
  return Boolean(
    isTruthyFlag(request?.get?.('x-katei-debug-invites'))
      || isTruthyFlag(request?.headers?.['x-katei-debug-invites'])
      || isTruthyFlag(request?.query?.debugInvites)
      || isTruthyFlag(request?.body?.debugInvites)
  );
}

export function buildInviteResponseDebugFields({
  route = null,
  viewer = null,
  workspace = null,
  activeWorkspace = null,
  pendingWorkspaceInvites = []
} = {}) {
  const viewerSub = normalizeOptionalString(viewer?.sub ?? viewer?.id) || null;
  const viewerEmail = normalizeOptionalEmail(viewer?.email);
  const responseWorkspaceId = normalizeOptionalString(workspace?.workspaceId) || null;
  const responseBoardOrder = Array.isArray(workspace?.boardOrder)
    ? workspace.boardOrder.filter((boardId) => typeof boardId === 'string')
    : [];
  const responseActiveBoardId = normalizeOptionalString(workspace?.ui?.activeBoardId) || null;
  const projectedBoardIds = collectProjectedBoardIds(workspace);
  const projectedBoardInviteIdsByBoard = {};
  const matchedWorkspaceInviteIds = [];
  const pendingWorkspaceInviteIds = [];
  const matchedSummaryInviteIds = [];

  for (const boardId of projectedBoardIds) {
    const board = workspace?.boards?.[boardId];
    const invites = normalizeBoardCollaboration(board).invites;

    projectedBoardInviteIdsByBoard[boardId] = invites.map((invite) => invite.id);

    for (const invite of invites) {
      if (invite?.status !== 'pending' || !inviteMatchesViewer(invite, { viewerSub, viewerEmail })) {
        continue;
      }

      matchedWorkspaceInviteIds.push(createScopedInviteKey({
        workspaceId: responseWorkspaceId,
        boardId,
        inviteId: invite.id
      }));
    }
  }

  for (const invite of Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : []) {
    const inviteId = normalizeOptionalString(invite?.inviteId);

    if (inviteId) {
      pendingWorkspaceInviteIds.push(inviteId);
      matchedSummaryInviteIds.push(
        createScopedInviteKey({
          workspaceId: invite?.workspaceId,
          boardId: invite?.boardId,
          inviteId
        })
      );
    }
  }

  return {
    route,
    viewerSub,
    viewerEmail,
    responseWorkspaceId,
    responseBoardOrder,
    responseActiveBoardId,
    activeWorkspaceId: normalizeOptionalString(activeWorkspace?.workspaceId) || null,
    activeWorkspaceIsHome: activeWorkspace?.isHomeWorkspace === true,
    pendingWorkspaceInviteIds,
    pendingWorkspaceInviteCount: pendingWorkspaceInviteIds.length,
    projectedBoardIds,
    projectedBoardInviteIdsByBoard,
    matchedWorkspaceInviteIds,
    matchedSummaryInviteIds,
    matchedInvitePresentInWorkspace: matchedWorkspaceInviteIds.length > 0,
    matchedInvitePresentInSummary: matchedSummaryInviteIds.length > 0
  };
}

function isTruthyFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => isTruthyFlag(entry));
  }

  if (typeof value !== 'string') {
    return false;
  }

  return TRUTHY_FLAG_VALUES.has(value.trim().toLowerCase());
}

function normalizeDebugFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return fields;
  }

  return fields;
}

function collectProjectedBoardIds(workspace) {
  const boardIds = [];
  const seenBoardIds = new Set();

  for (const boardId of Array.isArray(workspace?.boardOrder) ? workspace.boardOrder : []) {
    if (typeof boardId !== 'string' || seenBoardIds.has(boardId) || !workspace?.boards?.[boardId]) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  for (const boardId of Object.keys(workspace?.boards ?? {})) {
    if (seenBoardIds.has(boardId)) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  return boardIds;
}

function inviteMatchesViewer(invite, { viewerSub = null, viewerEmail = null } = {}) {
  const inviteActorId = normalizeOptionalString(invite?.actor?.id);
  const inviteEmail = normalizeOptionalEmail(invite?.email);

  return Boolean(
    (inviteActorId && viewerSub && inviteActorId === viewerSub)
      || (inviteEmail && viewerEmail && inviteEmail === viewerEmail)
  );
}

function createScopedInviteKey({ workspaceId = null, boardId = null, inviteId = null } = {}) {
  return [
    normalizeOptionalString(workspaceId) || 'unknown-workspace',
    normalizeOptionalString(boardId) || 'unknown-board',
    normalizeOptionalString(inviteId) || 'unknown-invite'
  ].join(':');
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue || null;
}
