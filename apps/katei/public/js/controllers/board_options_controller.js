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
    'workspaceSectionTemplate',
    'boardItemTemplate',
    'inviteSection',
    'inviteList',
    'inviteItemTemplate'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.workspace = null;
    this.viewerActor = null;
    this.optionsState = null;
    this.pendingWorkspaceInvites = [];
    this.activeWorkspaceId = null;
    this.activeWorkspaceIsHome = false;
    this.accessibleWorkspaces = [];
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor, {
      pendingWorkspaceInvites: event.detail?.pendingWorkspaceInvites,
      activeWorkspaceId: event.detail?.activeWorkspaceId,
      activeWorkspaceIsHome: event.detail?.activeWorkspaceIsHome,
      accessibleWorkspaces: event.detail?.accessibleWorkspaces
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
      activeWorkspaceId: event.detail?.activeWorkspaceId,
      activeWorkspaceIsHome: event.detail?.activeWorkspaceIsHome,
      accessibleWorkspaces: event.detail?.accessibleWorkspaces
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
    this.dispatch('create-board');
    this.closeDialog({ restoreFocus: false });
  }

  editBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatch('edit-board', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
    this.closeDialog({ restoreFocus: false });
  }

  resetBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatch('reset-board', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
    this.closeDialog({ restoreFocus: false });
  }

  openCollaborators() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatch('open-collaborators', {
      detail: {
        boardId: this.activeBoard.id
      }
    });
    this.closeDialog({ restoreFocus: false });
  }

  switchBoard(event) {
    const boardId = event.currentTarget.dataset.boardId;
    const workspaceId = normalizeOptionalWorkspaceId(event.currentTarget.dataset.workspaceId)
      ?? normalizeOptionalWorkspaceId(this.workspace?.workspaceId);
    const isHomeWorkspace = event.currentTarget.dataset.isHomeWorkspace === 'true';
    const boardTitle = normalizeOptionalString(event.currentTarget.dataset.boardTitle);

    if (!boardId) {
      return;
    }

    if (workspaceId === this.activeWorkspaceId && boardId === this.workspace?.ui?.activeBoardId) {
      return;
    }

    this.dispatch('switch-board', {
      detail: {
        workspaceId,
        isHomeWorkspace,
        boardId,
        boardTitle
      }
    });
    this.closeDialog({ restoreFocus: false });
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
      activeWorkspaceId = this.activeWorkspaceId,
      activeWorkspaceIsHome = this.activeWorkspaceIsHome,
      accessibleWorkspaces = this.accessibleWorkspaces
    } = {}
  ) {
    if (!workspace) {
      return;
    }

    this.workspace = workspace;
    this.viewerActor = viewerActor ?? this.viewerActor;
    this.pendingWorkspaceInvites = Array.isArray(pendingWorkspaceInvites) ? pendingWorkspaceInvites : [];
    this.activeWorkspaceId = normalizeOptionalWorkspaceId(activeWorkspaceId);
    this.activeWorkspaceIsHome = activeWorkspaceIsHome === true;
    this.accessibleWorkspaces = Array.isArray(accessibleWorkspaces) ? accessibleWorkspaces : [];
    this.optionsState = createBoardOptionsState(this.workspace, this.viewerActor, {
      pendingWorkspaceInvites: this.pendingWorkspaceInvites,
      activeWorkspaceId: this.activeWorkspaceId,
      activeWorkspaceIsHome: this.activeWorkspaceIsHome,
      accessibleWorkspaces: this.accessibleWorkspaces
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
      this.boardListTarget.replaceChildren(...this.createWorkspaceSectionItems());
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

    this.boardListTarget.replaceChildren(...this.createWorkspaceSectionItems());
    this.renderPendingWorkspaceInvites();
  }

  createWorkspaceSectionItems() {
    return (this.optionsState?.workspaceSections ?? []).map((section) => this.createWorkspaceSectionItem(section));
  }

  createWorkspaceSectionItem(section) {
    const item = this.workspaceSectionTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="workspaceTitle"]');
    const boardsElement = item.querySelector('[data-board-options-field="workspaceBoards"]');

    titleElement.textContent = getWorkspaceLabel(section, this.t);
    boardsElement.replaceChildren(...section.boardStates.map((boardState) => this.createBoardListItem(boardState)));

    return item;
  }

  createBoardListItem(boardState) {
    const item = this.boardItemTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="title"]');
    const stateElement = item.querySelector('[data-board-options-field="state"]');
    const switchButton = item.querySelector('[data-board-options-field="switchButton"]');
    const editButton = item.querySelector('[data-board-options-field="editButton"]');
    const collaboratorsButton = item.querySelector('[data-board-options-field="collaboratorsButton"]');
    const collaboratorBadge = item.querySelector('[data-board-options-field="collaboratorBadge"]');
    const inviteAcceptButton = item.querySelector('[data-board-options-field="inviteAcceptButton"]');
    const inviteDeclineButton = item.querySelector('[data-board-options-field="inviteDeclineButton"]');
    const actionState = createBoardListActionState(boardState);

    titleElement.textContent = boardState.title;
    stateElement.textContent = boardState.isActive
      ? this.t('boardOptionsDialog.stateActive')
      : this.t(getBoardRoleTranslationKey(boardState.currentRoleStatus));
    switchButton.dataset.boardId = boardState.boardId;
    switchButton.dataset.workspaceId = boardState.workspaceId ?? '';
    switchButton.dataset.boardTitle = boardState.title ?? '';
    switchButton.dataset.isHomeWorkspace = String(boardState.isHomeWorkspace === true);
    switchButton.hidden = actionState.switchHidden;
    collaboratorsButton.hidden = actionState.collaboratorsHidden;
    collaboratorBadge.hidden = actionState.collaboratorsHidden || boardState.pendingInviteCount === 0;
    collaboratorBadge.textContent = String(boardState.pendingInviteCount);
    editButton.hidden = actionState.editHidden;

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

    this.dispatch(actionName, { detail });
    this.closeDialog({ restoreFocus: false });
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

function getWorkspaceLabel(section, t) {
  return section?.isHomeWorkspace === true
    ? t('boardOptionsDialog.homeWorkspaceLabel')
    : normalizeOptionalString(section?.workspaceId);
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
