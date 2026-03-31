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
  const nextWorkspace =
    decision === 'accept'
      ? await service.acceptBoardInvite(detail.boardId, detail.inviteId)
      : await service.declineBoardInvite(detail.boardId, detail.inviteId);

  if (decision === 'decline' && activeWorkspaceId && !hasVisibleWorkspaceAccess(nextWorkspace, viewerActor)) {
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
