import { Controller } from '/vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import {
  createBoardMemberRemoveDetail,
  createBoardMemberRoleChangeDetail,
  createInviteDecisionDetail,
  createInviteMemberDetail,
  createTargetActorFromDataset
} from './board_collaborators_actions.js';
import {
  getBoardCollaborationState,
  getBoardRoleTranslationKey
} from './board_collaboration_state.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'heading',
    'currentRole',
    'inviteSection',
    'inviteForm',
    'inviteEmailInput',
    'membersSection',
    'membersList',
    'memberTemplate',
    'pendingInvitesSection',
    'pendingInvitesList',
    'inviteTemplate'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.workspace = null;
    this.viewerActor = null;
    this.board = null;
    this.collaborationState = null;
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncContext(event.detail?.workspace, event.detail?.viewerActor, event.detail?.boardId);

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.dialogTarget.querySelector('[data-board-collaborators-initial-focus]')?.focus();
    });
  }

  syncFromEvent(event) {
    this.syncContext(event.detail?.workspace, event.detail?.viewerActor, event.detail?.boardId);
  }

  backdropClose(event) {
    if (event.target === this.dialogTarget) {
      this.close();
    }
  }

  close(event) {
    if (event) {
      event.preventDefault();
    }

    this.closeDialog();
  }

  submitInvite(event) {
    event.preventDefault();

    const formData = new FormData(this.inviteFormTarget);

    this.dispatch('invite-member', {
      detail: createInviteMemberDetail({
        boardId: this.board?.id,
        email: formData.get('email'),
        role: formData.get('role')
      })
    });

    this.inviteFormTarget.reset();
  }

  changeRole(event) {
    this.dispatch('change-member-role', {
      detail: createBoardMemberRoleChangeDetail({
        boardId: this.board?.id,
        targetActor: createTargetActorFromDataset(event.currentTarget.dataset),
        role: event.currentTarget.value
      })
    });
  }

  revokeInvite(event) {
    this.dispatch('revoke-invite', {
      detail: createInviteDecisionDetail({
        boardId: this.board?.id,
        inviteId: event.currentTarget.dataset.inviteId
      })
    });
  }

  removeMember(event) {
    this.dispatch('remove-member', {
      detail: createBoardMemberRemoveDetail({
        boardId: this.board?.id,
        targetActor: createTargetActorFromDataset(event.currentTarget.dataset)
      })
    });
  }

  acceptInvite(event) {
    this.dispatchInviteResponse('accept-invite', event.currentTarget.dataset.inviteId, { closeDialog: true });
  }

  declineInvite(event) {
    this.dispatchInviteResponse('decline-invite', event.currentTarget.dataset.inviteId, { closeDialog: true });
  }

  syncContext(workspace, viewerActor = this.viewerActor, boardId = null) {
    if (!workspace) {
      return;
    }

    this.workspace = workspace;
    this.viewerActor = viewerActor ?? this.viewerActor;
    const nextBoardId = normalizeOptionalString(boardId) || normalizeOptionalString(this.workspace?.ui?.activeBoardId);
    this.board = nextBoardId ? this.workspace?.boards?.[nextBoardId] ?? null : null;
    this.collaborationState = this.board ? getBoardCollaborationState(this.board, this.viewerActor) : null;
    this.render();
  }

  render() {
    if (!this.board || !this.collaborationState) {
      return;
    }

    this.headingTarget.textContent = this.t('collaborators.heading', { title: this.board.title });
    this.currentRoleTarget.textContent = this.t('collaborators.currentRoleValue', {
      role: this.t(getBoardRoleTranslationKey(this.collaborationState.currentRoleStatus))
    });
    this.inviteSectionTarget.hidden = !this.collaborationState.canAdmin;
    this.membersSectionTarget.hidden = this.collaborationState.members.length === 0;
    this.pendingInvitesSectionTarget.hidden = this.collaborationState.pendingInvites.length === 0;
    this.membersListTarget.replaceChildren(...this.collaborationState.members.map((member) => this.createMemberItem(member)));
    this.pendingInvitesListTarget.replaceChildren(
      ...this.collaborationState.pendingInvites.map((invite) => this.createInviteItem(invite))
    );
  }

  createMemberItem(member) {
    const item = this.memberTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-collaborators-field="memberTitle"]');
    const metaElement = item.querySelector('[data-board-collaborators-field="memberMeta"]');
    const roleTextElement = item.querySelector('[data-board-collaborators-field="memberRoleText"]');
    const roleSelect = item.querySelector('[data-board-collaborators-field="memberRoleSelect"]');
    const removeButton = item.querySelector('[data-board-collaborators-field="memberRemoveButton"]');

    titleElement.textContent = member.primaryLabel;
    metaElement.textContent = member.secondaryLabel;
    roleTextElement.textContent = this.t(getBoardRoleTranslationKey(member.role));
    roleSelect.value = member.role;
    roleSelect.hidden = !member.canChangeRole;
    roleSelect.disabled = !member.canChangeRole;
    removeButton.hidden = !member.canRemove;

    for (const element of [roleSelect, removeButton]) {
      element.dataset.actorType = member.actor.type;
      element.dataset.actorId = member.actor.id;

      if (member.actor.email) {
        element.dataset.actorEmail = member.actor.email;
      }
    }

    return item;
  }

  createInviteItem(invite) {
    const item = this.inviteTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-collaborators-field="inviteTitle"]');
    const metaElement = item.querySelector('[data-board-collaborators-field="inviteMeta"]');
    const roleElement = item.querySelector('[data-board-collaborators-field="inviteRole"]');
    const statusElement = item.querySelector('[data-board-collaborators-field="inviteStatus"]');
    const revokeButton = item.querySelector('[data-board-collaborators-field="inviteRevokeButton"]');
    const acceptButton = item.querySelector('[data-board-collaborators-field="inviteAcceptButton"]');
    const declineButton = item.querySelector('[data-board-collaborators-field="inviteDeclineButton"]');

    titleElement.textContent = invite.primaryLabel;
    metaElement.textContent = invite.secondaryLabel;
    roleElement.textContent = this.t(getBoardRoleTranslationKey(invite.role));
    statusElement.textContent = this.t('collaborators.pendingStatus');

    for (const button of [revokeButton, acceptButton, declineButton]) {
      button.dataset.inviteId = invite.id;
    }

    revokeButton.hidden = !invite.canRevoke;
    acceptButton.hidden = !invite.canRespond;
    declineButton.hidden = !invite.canRespond;

    return item;
  }

  dispatchInviteResponse(actionName, inviteId, { closeDialog = false } = {}) {
    this.dispatch(actionName, {
      detail: createInviteDecisionDetail({
        boardId: this.board?.id,
        inviteId
      })
    });

    if (closeDialog) {
      this.closeDialog({ restoreFocus: false });
    }
  }

  closeDialog({ restoreFocus = true } = {}) {
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    if (restoreFocus && this.restoreFocusElement?.isConnected) {
      this.restoreFocusElement.focus();
    }

    this.restoreFocusElement = null;
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
