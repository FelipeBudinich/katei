import { hasVisibleWorkspaceAccess } from './board_collaboration_state.js';
import { logInviteDebug } from '../lib/invite_debug.js';

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

  logInviteDebug(`invite.${decision}.check`, {
    previousWorkspaceId,
    targetWorkspaceId,
    boardId: detail?.boardId ?? null,
    inviteId: detail?.inviteId ?? null,
    actorSub: viewerActor?.id ?? null,
    actorEmail: viewerActor?.email ?? null
  });

  if (targetWorkspaceId && targetWorkspaceId !== previousWorkspaceId) {
    service.setActiveWorkspace(targetWorkspaceId);

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
          workspace: await service.acceptBoardInvite(detail.boardId, detail.inviteId),
          leftWorkspace: false
        };
      }

      await service.declineBoardInvite(detail.boardId, detail.inviteId);

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
      ? await service.acceptBoardInvite(detail.boardId, detail.inviteId)
      : await service.declineBoardInvite(detail.boardId, detail.inviteId);

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
