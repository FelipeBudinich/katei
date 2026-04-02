import {
  boardActorsMatch,
  canonicalizeBoardRole,
  createBoardActorKey,
  normalizeBoardActor,
  normalizeBoardCollaboration
} from '../domain/board_collaboration.js';
import { logInviteDebug } from '../lib/invite_debug.js';
import {
  canActorAdminBoard,
  canActorEditBoard,
  canActorReadBoard,
  getBoardMembershipForActor,
  isBoardAdminMembership
} from '../domain/board_permissions.js';

export function createWorkspaceViewerActor({ sub, email = null, name = null } = {}) {
  return normalizeBoardActor({
    type: 'human',
    id: typeof sub === 'string' ? sub.trim() : '',
    email,
    displayName: name
  });
}

export function createBoardOptionsState(
  workspace,
  actor,
  {
    pendingWorkspaceInvites = [],
    activeWorkspaceId = null,
    activeWorkspaceIsHome = false,
    accessibleWorkspaces = []
  } = {}
) {
  const normalizedActor = normalizeBoardActor(actor);
  const activeBoardId = normalizeOptionalString(workspace?.ui?.activeBoardId);
  const normalizedActiveWorkspaceId = normalizeOptionalString(activeWorkspaceId)
    || normalizeOptionalString(workspace?.workspaceId);
  const normalizedActiveWorkspaceIsHome = activeWorkspaceIsHome === true;
  const activeBoard = activeBoardId ? workspace?.boards?.[activeBoardId] ?? null : null;
  const boardStates = Array.isArray(workspace?.boardOrder)
    ? workspace.boardOrder
        .map((boardId) => {
          const board = workspace?.boards?.[boardId];

          if (!board) {
            return null;
          }

          const collaborationState = getBoardCollaborationState(board, normalizedActor);

          return {
            ...collaborationState,
            boardId,
            title: board.title,
            workspaceId: normalizedActiveWorkspaceId,
            isHomeWorkspace: normalizedActiveWorkspaceIsHome,
            isCurrentWorkspace: true,
            isActive: boardId === activeBoardId,
            canSwitch: boardId !== activeBoardId && collaborationState.canRead
          };
        })
        .filter((boardState) => boardState && (boardState.isActive || boardState.accessible))
    : [];

  return {
    activeBoard,
    activeBoardState: activeBoard ? getBoardCollaborationState(activeBoard, normalizedActor) : null,
    boardStates,
    workspaceSections: createWorkspaceSections(boardStates, accessibleWorkspaces, {
      activeWorkspaceId: normalizedActiveWorkspaceId,
      activeWorkspaceIsHome: normalizedActiveWorkspaceIsHome
    }),
    incomingInvites: createIncomingInviteViewModels(pendingWorkspaceInvites, {
      activeWorkspaceId: normalizedActiveWorkspaceId
    })
  };
}

export function createBoardListActionState(boardState) {
  if (boardState?.isCurrentWorkspace === false) {
    return {
      canRespondToInvite: false,
      canOpenCollaborators: false,
      canEditBoard: false,
      inviteId: '',
      collaboratorsHidden: true,
      editHidden: true,
      switchHidden: !boardState?.canSwitch,
      inviteAcceptHidden: true,
      inviteDeclineHidden: true
    };
  }

  const inviteId = normalizeOptionalString(boardState?.pendingInvite?.id);
  const canRespondToInvite = Boolean(inviteId && boardState?.pendingInvite && !boardState?.canSwitch);
  const canOpenCollaborators = Boolean(boardState?.isActive);
  const canEditBoard = Boolean(boardState?.isActive && boardState?.canAdmin);

  return {
    canRespondToInvite,
    canOpenCollaborators,
    canEditBoard,
    inviteId,
    collaboratorsHidden: !canOpenCollaborators,
    editHidden: !canEditBoard,
    switchHidden: !boardState?.canSwitch,
    inviteAcceptHidden: !canRespondToInvite,
    inviteDeclineHidden: !canRespondToInvite
  };
}

export function getBoardCollaborationState(board, actor) {
  const normalizedActor = normalizeBoardActor(actor);
  const collaboration = normalizeBoardCollaboration(board);
  const collaborationBoard = {
    collaboration
  };
  const membership = normalizedActor ? getBoardMembershipForActor(collaborationBoard, normalizedActor) : null;
  const pendingInvite = normalizedActor ? findViewerPendingInvite(board, normalizedActor) : null;
  const canRead = normalizedActor ? canActorReadBoard(collaborationBoard, normalizedActor) : false;
  const canEdit = normalizedActor ? canActorEditBoard(collaborationBoard, normalizedActor) : false;
  const canAdmin = normalizedActor ? canActorAdminBoard(collaborationBoard, normalizedActor) : false;
  const adminCount = collaboration.memberships.filter((member) => isBoardAdminMembership(member)).length;
  const visiblePendingInvites = collaboration.invites
    .filter((invite) => invite.status === 'pending')
    .filter((invite) => canAdmin || inviteMatchesActor(invite, normalizedActor))
    .map((invite) => createInviteViewModel(invite, normalizedActor, { canAdmin }));

  logInviteDebug('client.invite.state', {
    source: 'board-collaboration-state',
    boardId: normalizeOptionalString(board?.id),
    boardTitle: normalizeOptionalString(board?.title),
    actorSub: normalizedActor?.id ?? null,
    actorEmail: normalizedActor?.email ?? null,
    pendingInviteId: pendingInvite?.id ?? null,
    currentRoleStatus: membership?.role ?? (pendingInvite ? 'invited' : 'none'),
    canRead,
    canEdit,
    canAdmin,
    accessible: canRead || Boolean(pendingInvite),
    pendingInviteCount: collaboration.invites.filter((invite) => invite.status === 'pending').length,
    visiblePendingInviteIds: visiblePendingInvites.map((invite) => invite.id),
    canRespondToPendingInvite: Boolean(visiblePendingInvites.some((invite) => invite.canRespond))
  });

  return {
    boardId: normalizeOptionalString(board?.id),
    boardTitle: normalizeOptionalString(board?.title),
    membership,
    pendingInvite,
    canRead,
    canEdit,
    canAdmin,
    accessible: canRead || Boolean(pendingInvite),
    currentRole: membership?.role ?? null,
    currentRoleStatus: membership?.role ?? (pendingInvite ? 'invited' : 'none'),
    members: collaboration.memberships.map((member) => createMemberViewModel(member, normalizedActor, { canAdmin, adminCount })),
    pendingInvites: visiblePendingInvites,
    pendingInviteCount: collaboration.invites.filter((invite) => invite.status === 'pending').length
  };
}

export function hasVisibleWorkspaceAccess(workspace, actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor || !Array.isArray(workspace?.boardOrder) || !workspace?.boards) {
    return false;
  }

  return workspace.boardOrder.some((boardId) => {
    const board = workspace.boards[boardId];

    if (!board) {
      return false;
    }

    const state = getBoardCollaborationState(board, normalizedActor);
    return state.accessible;
  });
}

export function findViewerPendingInvite(board, actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor) {
    return null;
  }

  return normalizeBoardCollaboration(board).invites.find(
    (invite) => invite.status === 'pending' && inviteMatchesActor(invite, normalizedActor)
  ) ?? null;
}

export function getBoardRoleTranslationKey(roleOrStatus) {
  switch (normalizeOptionalString(roleOrStatus).toLowerCase()) {
    case 'admin':
      return 'collaborators.roles.admin';
    case 'editor':
      return 'collaborators.roles.editor';
    case 'viewer':
      return 'collaborators.roles.viewer';
    case 'invited':
      return 'collaborators.roles.invited';
    default:
      return 'collaborators.roles.none';
  }
}

export function createActorDisplay(actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor) {
    return {
      primaryLabel: '',
      secondaryLabel: ''
    };
  }

  const primaryLabel = normalizedActor.displayName ?? normalizedActor.email ?? normalizedActor.id;
  const secondaryCandidates = [
    normalizedActor.displayName ? normalizedActor.email : '',
    normalizedActor.id
  ].filter((value) => typeof value === 'string' && value.trim() && value.trim() !== primaryLabel);
  const secondaryLabel = [...new Set(secondaryCandidates.map((value) => value.trim()))][0] ?? '';

  return {
    primaryLabel,
    secondaryLabel
  };
}

function createWorkspaceSections(boardStates, accessibleWorkspaces, {
  activeWorkspaceId = '',
  activeWorkspaceIsHome = false
} = {}) {
  const sections = [];
  const normalizedActiveWorkspaceId = normalizeOptionalString(activeWorkspaceId);

  if (Array.isArray(boardStates) && boardStates.length > 0) {
    sections.push({
      workspaceId: normalizedActiveWorkspaceId,
      isHomeWorkspace: activeWorkspaceIsHome === true,
      isCurrentWorkspace: true,
      boardStates
    });
  }

  if (!Array.isArray(accessibleWorkspaces)) {
    return sections;
  }

  return sections.concat(
    accessibleWorkspaces
      .map((summary) => createAccessibleWorkspaceSection(summary))
      .filter((section) => section && section.workspaceId !== normalizedActiveWorkspaceId)
  );
}

function createAccessibleWorkspaceSection(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return null;
  }

  const workspaceId = normalizeOptionalString(summary.workspaceId);
  const boardStates = Array.isArray(summary.boards)
    ? summary.boards
        .map((board) => createAccessibleWorkspaceBoardState(board, {
          workspaceId,
          isHomeWorkspace: summary.isHomeWorkspace === true
        }))
        .filter(Boolean)
    : [];

  if (!workspaceId || boardStates.length === 0) {
    return null;
  }

  return {
    workspaceId,
    isHomeWorkspace: summary.isHomeWorkspace === true,
    isCurrentWorkspace: false,
    boardStates
  };
}

function createAccessibleWorkspaceBoardState(board, { workspaceId, isHomeWorkspace = false } = {}) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) {
    return null;
  }

  const boardId = normalizeOptionalString(board.boardId);
  const title = normalizeOptionalString(board.boardTitle);
  const role = canonicalizeBoardRole(board.role);

  if (!workspaceId || !boardId || !title || !role) {
    return null;
  }

  return {
    boardId,
    boardTitle: title,
    title,
    membership: null,
    pendingInvite: null,
    canRead: true,
    canEdit: false,
    canAdmin: false,
    accessible: true,
    currentRole: role,
    currentRoleStatus: role,
    members: [],
    pendingInvites: [],
    pendingInviteCount: 0,
    workspaceId,
    isHomeWorkspace,
    isCurrentWorkspace: false,
    isActive: false,
    canSwitch: true
  };
}

function createMemberViewModel(member, viewerActor, { canAdmin, adminCount }) {
  const display = createActorDisplay(member.actor);
  const isProtectedAdmin = isBoardAdminMembership(member) && adminCount === 1;

  return {
    ...member,
    ...display,
    actorKey: createBoardActorKey(member.actor),
    isCurrentActor: boardActorsMatch(member.actor, viewerActor),
    canChangeRole: canAdmin && !isProtectedAdmin,
    canRemove: canAdmin && !isProtectedAdmin
  };
}

function createInviteViewModel(invite, actor, { canAdmin }) {
  const actorDisplay = createActorDisplay(invite.actor);

  return {
    ...invite,
    primaryLabel: invite.email ?? actorDisplay.primaryLabel,
    secondaryLabel: invite.email ? actorDisplay.primaryLabel : actorDisplay.secondaryLabel,
    canRevoke: canAdmin,
    canRespond: !canAdmin && inviteMatchesActor(invite, actor)
  };
}

function createIncomingInviteViewModels(pendingWorkspaceInvites, { activeWorkspaceId = '' } = {}) {
  if (!Array.isArray(pendingWorkspaceInvites)) {
    return [];
  }

  return pendingWorkspaceInvites
    .map((invite) => createIncomingInviteViewModel(invite))
    .filter((invite) => invite && invite.workspaceId !== activeWorkspaceId);
}

function createIncomingInviteViewModel(invite) {
  if (!invite || typeof invite !== 'object' || Array.isArray(invite)) {
    return null;
  }

  const workspaceId = normalizeOptionalString(invite.workspaceId);
  const boardId = normalizeOptionalString(invite.boardId);
  const boardTitle = normalizeOptionalString(invite.boardTitle);
  const inviteId = normalizeOptionalString(invite.inviteId);
  const role = canonicalizeBoardRole(invite.role);
  const invitedAt = normalizeOptionalIsoString(invite.invitedAt);
  const invitedBy = normalizeIncomingInviteActorSummary(invite.invitedBy);

  if (!workspaceId || !boardId || !boardTitle || !inviteId || !role || !invitedAt || !invitedBy) {
    return null;
  }

  return {
    workspaceId,
    workspaceLabel: workspaceId,
    boardId,
    boardTitle,
    inviteId,
    role,
    invitedAt,
    invitedBy
  };
}

function normalizeIncomingInviteActorSummary(actorSummary) {
  if (!actorSummary || typeof actorSummary !== 'object' || Array.isArray(actorSummary)) {
    return null;
  }

  const id = normalizeOptionalString(actorSummary.id);

  if (!id) {
    return null;
  }

  return {
    id,
    email: normalizeOptionalEmail(actorSummary.email),
    displayName: normalizeOptionalString(actorSummary.displayName ?? actorSummary.name) || null
  };
}

function inviteMatchesActor(invite, actor) {
  const normalizedActor = normalizeBoardActor(actor);

  if (!normalizedActor || invite?.status !== 'pending') {
    return false;
  }

  return Boolean(
    (invite.actor && boardActorsMatch(invite.actor, normalizedActor)) ||
      (normalizedActor.email && invite.email && normalizedActor.email === invite.email)
  );
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalEmail(value) {
  const normalizedValue = normalizeOptionalString(value).toLowerCase();
  return normalizedValue || null;
}

function normalizeOptionalIsoString(value) {
  if (!normalizeOptionalString(value)) {
    return null;
  }

  const parsedValue = new Date(value);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue.toISOString();
}
