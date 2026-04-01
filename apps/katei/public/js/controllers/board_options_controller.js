import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { logInviteDebug } from '../lib/invite_debug.js';
import { createInviteDecisionDetail } from './board_collaborators_actions.js';
import {
  createBoardListActionState,
  createBoardOptionsState,
  getBoardRoleTranslationKey
} from './board_collaboration_state.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'summary',
    'roleSummary',
    'pendingSummary',
    'boardList',
    'boardItemTemplate',
    'inviteSection',
    'inviteList',
    'inviteItemTemplate',
    'renameButton',
    'deleteButton',
    'collaboratorsButton',
    'collaboratorBadge'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.workspace = null;
    this.viewerActor = null;
    this.optionsState = null;
    this.pendingWorkspaceInvites = [];
    this.activeWorkspaceId = null;
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor, {
      pendingWorkspaceInvites: event.detail?.pendingWorkspaceInvites,
      activeWorkspaceId: event.detail?.activeWorkspaceId
    });

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.dialogTarget.querySelector('[data-board-options-initial-focus]')?.focus();
    });
  }

  syncFromEvent(event) {
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor, {
      pendingWorkspaceInvites: event.detail?.pendingWorkspaceInvites,
      activeWorkspaceId: event.detail?.activeWorkspaceId
    });
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

  createBoard() {
    this.closeDialog({ restoreFocus: false });
    this.dispatch('create-board');
  }

  renameBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.closeDialog({ restoreFocus: false });
    this.dispatch('rename-board', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
  }

  deleteBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.closeDialog({ restoreFocus: false });
    this.dispatch('delete-board', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
  }

  resetBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.closeDialog({ restoreFocus: false });
    this.dispatch('reset-board', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
  }

  openCollaborators() {
    if (!this.activeBoard) {
      return;
    }

    this.closeDialog({ restoreFocus: false });
    this.dispatch('open-collaborators', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
  }

  switchBoard(event) {
    const boardId = event.currentTarget.dataset.boardId;

    if (!boardId || boardId === this.workspace?.ui?.activeBoardId) {
      return;
    }

    this.closeDialog({ restoreFocus: false });
    this.dispatch('switch-board', {
      detail: {
        boardId
      }
    });
  }

  acceptInvite(event) {
    this.dispatchInviteResponse('accept-invite', event.currentTarget.dataset);
  }

  declineInvite(event) {
    this.dispatchInviteResponse('decline-invite', event.currentTarget.dataset);
  }

  get activeBoard() {
    return this.workspace ? this.workspace.boards[this.workspace.ui.activeBoardId] : null;
  }

  syncWorkspace(
    workspace,
    viewerActor = this.viewerActor,
    {
      pendingWorkspaceInvites = this.pendingWorkspaceInvites,
      activeWorkspaceId = this.activeWorkspaceId
    } = {}
  ) {
    if (!workspace) {
      return;
    }

    this.workspace = workspace;
    this.viewerActor = viewerActor ?? this.viewerActor;
    this.pendingWorkspaceInvites = Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : [];
    this.activeWorkspaceId = normalizeOptionalWorkspaceId(activeWorkspaceId);
    this.optionsState = createBoardOptionsState(this.workspace, this.viewerActor, {
      pendingWorkspaceInvites: this.pendingWorkspaceInvites,
      activeWorkspaceId: this.activeWorkspaceId
    });
    this.render();
  }

  render() {
    const activeBoardState = this.optionsState?.activeBoardState ?? null;

    if (!this.workspace) {
      return;
    }

    if (!this.activeBoard || !activeBoardState) {
      this.summaryTarget.textContent = this.t('boardOptionsDialog.noVisibleBoards');
      this.roleSummaryTarget.textContent = '';
      this.pendingSummaryTarget.hidden = true;
      this.pendingSummaryTarget.textContent = '';
      this.renameButtonTarget.hidden = true;
      this.deleteButtonTarget.hidden = true;
      this.collaboratorsButtonTarget.hidden = true;
      this.collaboratorBadgeTarget.hidden = true;
      this.collaboratorBadgeTarget.textContent = '';
      this.boardListTarget.replaceChildren(...(this.optionsState?.boardStates ?? []).map((boardState) => this.createBoardListItem(boardState)));
      this.renderPendingWorkspaceInvites();
      return;
    }

    this.summaryTarget.textContent = this.t('boardOptionsDialog.summaryActive', { title: this.activeBoard.title });
    this.roleSummaryTarget.textContent = this.t('boardOptionsDialog.currentRoleSummary', {
      role: this.t(getBoardRoleTranslationKey(activeBoardState.currentRoleStatus))
    });
    this.pendingSummaryTarget.hidden = activeBoardState.pendingInviteCount === 0;
    this.pendingSummaryTarget.textContent = this.t('boardOptionsDialog.pendingInvitesSummary', {
      count: activeBoardState.pendingInviteCount
    });
    this.renameButtonTarget.hidden = !activeBoardState.canAdmin;
    this.deleteButtonTarget.hidden = !activeBoardState.canAdmin || this.workspace.boardOrder.length === 1;
    this.collaboratorsButtonTarget.hidden = !this.activeBoard;
    this.collaboratorBadgeTarget.hidden = activeBoardState.pendingInviteCount === 0;
    this.collaboratorBadgeTarget.textContent = String(activeBoardState.pendingInviteCount);

    const items = this.optionsState.boardStates.map((boardState) => this.createBoardListItem(boardState));
    this.boardListTarget.replaceChildren(...items);
    this.renderPendingWorkspaceInvites();
  }

  createBoardListItem(boardState) {
    const item = this.boardItemTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="title"]');
    const stateElement = item.querySelector('[data-board-options-field="state"]');
    const switchButton = item.querySelector('[data-board-options-field="switchButton"]');
    const inviteAcceptButton = item.querySelector('[data-board-options-field="inviteAcceptButton"]');
    const inviteDeclineButton = item.querySelector('[data-board-options-field="inviteDeclineButton"]');
    const actionState = createBoardListActionState(boardState);

    titleElement.textContent = boardState.title;
    stateElement.textContent = boardState.isActive
      ? this.t('boardOptionsDialog.stateActive')
      : this.t(getBoardRoleTranslationKey(boardState.currentRoleStatus));
    switchButton.dataset.boardId = boardState.boardId;
    switchButton.hidden = actionState.switchHidden;

    for (const button of [inviteAcceptButton, inviteDeclineButton]) {
      button.dataset.boardId = boardState.boardId;
      button.dataset.inviteId = actionState.inviteId;
    }

    inviteAcceptButton.hidden = actionState.inviteAcceptHidden;
    inviteDeclineButton.hidden = actionState.inviteDeclineHidden;

    return item;
  }

  createInviteListItem(invite) {
    const item = this.inviteItemTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="inviteTitle"]');
    const metaElement = item.querySelector('[data-board-options-field="inviteMeta"]');
    const roleElement = item.querySelector('[data-board-options-field="inviteRole"]');
    const acceptButton = item.querySelector('[data-board-options-field="inviteAcceptButton"]');
    const declineButton = item.querySelector('[data-board-options-field="inviteDeclineButton"]');

    titleElement.textContent = invite.boardTitle;
    metaElement.textContent = this.t('boardOptionsDialog.inviteContext', {
      workspace: invite.workspaceLabel,
      inviter: getInviterLabel(invite.invitedBy)
    });
    roleElement.textContent = this.t('boardOptionsDialog.inviteRole', {
      role: this.t(getBoardRoleTranslationKey(invite.role))
    });

    for (const button of [acceptButton, declineButton]) {
      button.dataset.workspaceId = invite.workspaceId;
      button.dataset.boardId = invite.boardId;
      button.dataset.inviteId = invite.inviteId;
    }

    return item;
  }

  renderPendingWorkspaceInvites() {
    const incomingInvites = Array.isArray(this.optionsState?.incomingInvites) ? this.optionsState.incomingInvites : [];
    const inviteItems = incomingInvites.map((invite) => this.createInviteListItem(invite));
    const boardRowActions = this.getBoardRowInviteActionState();

    logInviteDebug('client.invite.render', {
      source: 'board-options',
      activeWorkspaceId: this.activeWorkspaceId ?? normalizeOptionalWorkspaceId(this.workspace?.workspaceId),
      activeBoardId: normalizeOptionalWorkspaceId(this.workspace?.ui?.activeBoardId),
      rawInviteIds: this.pendingWorkspaceInvites
        .map((invite) => normalizeOptionalString(invite?.inviteId))
        .filter(Boolean),
      visibleInviteIds: incomingInvites.map((invite) => invite.inviteId),
      boardRowsWithAccept: boardRowActions
        .filter((row) => row.acceptVisible)
        .map(({ boardId, inviteId }) => ({ boardId, inviteId })),
      boardRowsWithDecline: boardRowActions
        .filter((row) => row.declineVisible)
        .map(({ boardId, inviteId }) => ({ boardId, inviteId }))
    });

    this.inviteSectionTarget.hidden = inviteItems.length === 0;
    this.inviteListTarget.replaceChildren(...inviteItems);
  }

  getBoardRowInviteActionState() {
    return (this.optionsState?.boardStates ?? []).map((boardState) => {
      const actionState = createBoardListActionState(boardState);

      return {
        boardId: boardState.boardId,
        inviteId: actionState.inviteId,
        acceptVisible: !actionState.inviteAcceptHidden,
        declineVisible: !actionState.inviteDeclineHidden
      };
    });
  }

  dispatchInviteResponse(actionName, dataset = {}) {
    if (!dataset.boardId || !dataset.inviteId) {
      return;
    }

    const detail = createInviteDecisionDetail({
      workspaceId: dataset.workspaceId,
      boardId: dataset.boardId,
      inviteId: dataset.inviteId
    });

    this.closeDialog({ restoreFocus: false });
    this.dispatch(actionName, { detail });
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

function getInviterLabel(invitedBy) {
  return normalizeOptionalString(invitedBy?.displayName)
    || normalizeOptionalString(invitedBy?.email)
    || normalizeOptionalString(invitedBy?.id);
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
