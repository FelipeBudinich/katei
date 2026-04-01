import { hasVisibleWorkspaceAccess } from './board_collaboration_state.js';

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

  if (targetWorkspaceId && targetWorkspaceId !== previousWorkspaceId) {
    service.setActiveWorkspace(targetWorkspaceId);

    try {
      if (decision === 'accept') {
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
    return {
      workspace: await service.switchWorkspace(null),
      leftWorkspace: true
    };
  }

  return {
    workspace: nextWorkspace,
    leftWorkspace: false
  };
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}
