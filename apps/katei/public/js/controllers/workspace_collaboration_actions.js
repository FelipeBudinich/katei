import { hasVisibleWorkspaceAccess } from './board_collaboration_state.js';
import { logInviteAcceptDebug, logInviteDebug } from '../lib/invite_debug.js';

export async function performWorkspaceCollaboratorAction({ service, action, detail }) {
  switch (action) {
    case 'invite-member':
      return service.inviteBoardMember(detail.boardId, detail.email, detail.role);
    case 'revoke-invite':
      return service.revokeBoardInvite(detail.boardId, detail.inviteId);
    case 'change-member-role':
      return service.setBoardMemberRole(detail.boardId, detail.targetActor, detail.role);
    case 'remove-member':
      return service.removeBoardMember(detail.boardId, detail.targetActor);
    default:
      throw new Error(`Unsupported collaborator action: ${action}`);
  }
}

export async function performWorkspaceInviteDecision({
  service,
  decision,
  detail,
  viewerActor,
  activeWorkspaceId = null
}) {
  const previousWorkspaceId = normalizeOptionalWorkspaceId(activeWorkspaceId);
  const targetWorkspaceId = normalizeOptionalWorkspaceId(detail?.workspaceId);
  const decisionWorkspaceId = targetWorkspaceId ?? previousWorkspaceId;
  const initialDebugContext = getServiceDebugContext(service);

  logInviteDebug(`invite.${decision}.check`, {
    previousWorkspaceId,
    targetWorkspaceId,
    boardId: detail?.boardId ?? null,
    inviteId: detail?.inviteId ?? null,
    actorSub: viewerActor?.id ?? null,
    actorEmail: viewerActor?.email ?? null
  });

  logInviteAcceptDebug('client.inviteDecision.entry', {
    decision,
    previousWorkspaceId,
    targetWorkspaceId,
    boardId: detail?.boardId ?? null,
    inviteId: detail?.inviteId ?? null,
    commandPayload: {
      boardId: detail?.boardId ?? null,
      inviteId: detail?.inviteId ?? null
    },
    serviceWorkspaceId: initialDebugContext.activeWorkspaceId,
    cachedRevisionBeforeDecision: initialDebugContext.cachedRevision,
    revisionWorkspaceId: initialDebugContext.revisionWorkspaceId,
    revisionSource: initialDebugContext.revisionSource,
    revisionReadFrom: describeRevisionOrigin(initialDebugContext, targetWorkspaceId, previousWorkspaceId)
  });

  if (targetWorkspaceId && targetWorkspaceId !== previousWorkspaceId) {
    service.setActiveWorkspace(targetWorkspaceId);
    const switchedDebugContext = getServiceDebugContext(service);

    logInviteAcceptDebug('client.inviteDecision.workspaceSwitch', {
      decision,
      previousWorkspaceId,
      targetWorkspaceId,
      boardId: detail?.boardId ?? null,
      inviteId: detail?.inviteId ?? null,
      serviceWorkspaceId: switchedDebugContext.activeWorkspaceId,
      cachedRevisionAfterWorkspaceSwitch: switchedDebugContext.cachedRevision,
      revisionWorkspaceId: switchedDebugContext.revisionWorkspaceId,
      revisionSource: switchedDebugContext.revisionSource,
      revisionReadFrom: describeRevisionOrigin(switchedDebugContext, targetWorkspaceId, previousWorkspaceId)
    });

    try {
      if (decision === 'accept') {
        logInviteDebug('client.invite.state', {
          source: 'workspace-invite-decision',
          decision,
          previousWorkspaceId,
          targetWorkspaceId,
          switchedWorkspace: true
        });

        return {
          workspace: await service.acceptBoardInvite(detail.boardId, detail.inviteId, decisionWorkspaceId),
          leftWorkspace: false
        };
      }

      await service.declineBoardInvite(detail.boardId, detail.inviteId, decisionWorkspaceId);

      return {
        workspace: await service.switchWorkspace(previousWorkspaceId),
        leftWorkspace: false
      };
    } catch (error) {
      service.setActiveWorkspace(previousWorkspaceId);
      throw error;
    }
  }

  const nextWorkspace =
    decision === 'accept'
      ? await service.acceptBoardInvite(detail.boardId, detail.inviteId, decisionWorkspaceId)
      : await service.declineBoardInvite(detail.boardId, detail.inviteId, decisionWorkspaceId);

  if (decision === 'decline' && previousWorkspaceId && !hasVisibleWorkspaceAccess(nextWorkspace, viewerActor)) {
    logInviteDebug('client.invite.state', {
      source: 'workspace-invite-decision',
      decision,
      previousWorkspaceId,
      targetWorkspaceId,
      switchedWorkspace: false,
      leftWorkspace: true
    });

    return {
      workspace: await service.switchWorkspace(null),
      leftWorkspace: true
    };
  }

  logInviteDebug('client.invite.state', {
    source: 'workspace-invite-decision',
    decision,
    previousWorkspaceId,
    targetWorkspaceId,
    switchedWorkspace: targetWorkspaceId && targetWorkspaceId !== previousWorkspaceId,
    leftWorkspace: false
  });

  return {
    workspace: nextWorkspace,
    leftWorkspace: false
  };
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}

function getServiceDebugContext(service) {
  if (typeof service?.getDebugContext === 'function') {
    return service.getDebugContext();
  }

  const activeWorkspaceId = typeof service?.getActiveWorkspaceId === 'function'
    ? service.getActiveWorkspaceId()
    : service?.activeWorkspaceId ?? null;

  return {
    activeWorkspaceId,
    cachedRevision: null,
    revisionWorkspaceId: null,
    revisionSource: null
  };
}

function describeRevisionOrigin(debugContext, targetWorkspaceId, previousWorkspaceId) {
  if (!Number.isInteger(debugContext.cachedRevision)) {
    return 'not-available';
  }

  if (debugContext.revisionWorkspaceId && targetWorkspaceId && debugContext.revisionWorkspaceId === targetWorkspaceId) {
    return 'invite-workspace-context';
  }

  if (debugContext.revisionWorkspaceId && previousWorkspaceId && debugContext.revisionWorkspaceId === previousWorkspaceId) {
    return 'active-workspace-context';
  }

  if (debugContext.revisionSource === 'bootstrap') {
    return 'bootstrap-state';
  }

  return 'prior-api-state';
}
