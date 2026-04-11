import { Controller } from '../../vendor/stimulus/stimulus.js';
import { canonicalizeBoardRole } from '../domain/board_collaboration.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
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
    'selfRoleSection',
    'selfRoleSummary',
    'selfRoleSelect',
    'selfRoleError',
    'selfRoleSaveButton',
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
    this.isSuperAdmin = false;
    this.accessibleWorkspaces = [];
    this.workspaceService = null;
    this.restoreFocusElement = null;
    this.isSubmittingBoardSelfRole = false;
    this.resetBoardSelfRoleEditorState();
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor, {
      pendingWorkspaceInvites: event.detail?.pendingWorkspaceInvites,
      activeWorkspaceId: event.detail?.activeWorkspaceId,
      activeWorkspaceIsHome: event.detail?.activeWorkspaceIsHome,
      isSuperAdmin: event.detail?.isSuperAdmin,
      accessibleWorkspaces: event.detail?.accessibleWorkspaces,
      workspaceService: event.detail?.workspaceService
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
      isSuperAdmin: event.detail?.isSuperAdmin,
      accessibleWorkspaces: event.detail?.accessibleWorkspaces,
      workspaceService: event.detail?.workspaceService
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

    if (this.isSubmittingBoardSelfRole) {
      return;
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

  openPortfolio() {
    if (!this.isSuperAdmin) {
      return;
    }

    this.dispatch('open-portfolio');
    this.closeDialog({ restoreFocus: false });
  }

  handleSelfRoleInput() {
    this.hideBoardSelfRoleError();
    this.syncBoardSelfRoleActionState();
  }

  async saveBoardSelfRole(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.canManageBoardSelfRoles() || this.isSubmittingBoardSelfRole || !this.activeBoard) {
      return;
    }

    const currentRole = this.getActiveBoardSelfRole();
    const requestedRole = canonicalizeBoardRole(this.selfRoleSelectTarget?.value);
    const workspaceId = normalizeOptionalWorkspaceId(this.workspace?.workspaceId) ?? this.activeWorkspaceId;
    const boardId = normalizeOptionalString(this.activeBoard?.id);

    if (!workspaceId || !boardId || !requestedRole || !currentRole || requestedRole === currentRole) {
      this.syncBoardSelfRoleActionState(currentRole);
      return;
    }

    this.hideBoardSelfRoleError();
    this.setBoardSelfRoleSubmittingState(true, currentRole);

    try {
      const result = await this.workspaceService.setBoardSelfRole(boardId, requestedRole, {
        workspaceId
      });
      const nextWorkspace = isPlainObject(result) ? result : this.workspace;

      this.syncWorkspace(nextWorkspace, this.viewerActor, this.getWorkspaceSyncOptions({
        workspaceService: this.workspaceService
      }));

      const effectiveRole = this.getActiveBoardSelfRole() ?? requestedRole;

      this.dispatch('board-self-role-updated', {
        detail: {
          workspace: nextWorkspace,
          workspaceId,
          boardId,
          role: effectiveRole
        }
      });
    } catch (error) {
      console.error(error);
      this.showBoardSelfRoleError(localizeErrorMessage(error, this.t));
    } finally {
      this.setBoardSelfRoleSubmittingState(false);
    }
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
      isSuperAdmin = this.isSuperAdmin,
      accessibleWorkspaces = this.accessibleWorkspaces,
      workspaceService = this.workspaceService
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
    this.isSuperAdmin = isSuperAdmin === true;
    this.accessibleWorkspaces = Array.isArray(accessibleWorkspaces) ? accessibleWorkspaces : [];
    this.workspaceService = workspaceService ?? this.workspaceService;
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

    this.renderBoardSelfRoleSection(activeBoardState);

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

  renderBoardSelfRoleSection(activeBoardState) {
    if (!this.hasSelfRoleSectionTarget) {
      return;
    }

    const currentRole = canonicalizeBoardRole(activeBoardState?.currentRole);
    const shouldShow = this.canManageBoardSelfRoles() && Boolean(this.activeBoard) && Boolean(currentRole);

    this.selfRoleSectionTarget.hidden = !shouldShow;

    if (!shouldShow) {
      this.resetBoardSelfRoleEditorState();
      return;
    }

    if (this.hasSelfRoleSummaryTarget) {
      this.selfRoleSummaryTarget.textContent = this.t('collaborators.currentRoleValue', {
        role: this.t(getBoardRoleTranslationKey(currentRole))
      });
    }

    if (this.hasSelfRoleSelectTarget && this.isSubmittingBoardSelfRole !== true) {
      this.selfRoleSelectTarget.value = currentRole;
    }

    this.syncBoardSelfRoleActionState(currentRole);
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

  canManageBoardSelfRoles() {
    return this.isSuperAdmin === true && this.workspaceService && typeof this.workspaceService.setBoardSelfRole === 'function';
  }

  getWorkspaceSyncOptions({ workspaceService = this.workspaceService } = {}) {
    return {
      pendingWorkspaceInvites:
        typeof workspaceService?.getPendingWorkspaceInvites === 'function'
          ? workspaceService.getPendingWorkspaceInvites()
          : this.pendingWorkspaceInvites,
      activeWorkspaceId:
        typeof workspaceService?.getActiveWorkspaceId === 'function'
          ? workspaceService.getActiveWorkspaceId()
          : this.activeWorkspaceId,
      activeWorkspaceIsHome:
        typeof workspaceService?.getIsHomeWorkspace === 'function'
          ? workspaceService.getIsHomeWorkspace()
          : this.activeWorkspaceIsHome,
      isSuperAdmin: this.isSuperAdmin,
      accessibleWorkspaces:
        typeof workspaceService?.getAccessibleWorkspaces === 'function'
          ? workspaceService.getAccessibleWorkspaces()
          : this.accessibleWorkspaces,
      workspaceService
    };
  }

  resetBoardSelfRoleEditorState() {
    if (this.hasSelfRoleSummaryTarget) {
      this.selfRoleSummaryTarget.textContent = '';
    }

    if (this.hasSelfRoleSelectTarget) {
      this.selfRoleSelectTarget.value = 'viewer';
      this.selfRoleSelectTarget.disabled = true;
    }

    if (this.hasSelfRoleSaveButtonTarget) {
      this.selfRoleSaveButtonTarget.disabled = true;
      this.selfRoleSaveButtonTarget.textContent = this.t('boardOptionsDialog.saveSelfRole');
    }

    this.hideBoardSelfRoleError();
    this.isSubmittingBoardSelfRole = false;
  }

  getActiveBoardSelfRole() {
    return canonicalizeBoardRole(this.optionsState?.activeBoardState?.currentRole);
  }

  syncBoardSelfRoleActionState(currentRole = this.getActiveBoardSelfRole()) {
    if (this.hasSelfRoleSelectTarget) {
      this.selfRoleSelectTarget.disabled = this.isSubmittingBoardSelfRole === true;
    }

    if (!this.hasSelfRoleSaveButtonTarget) {
      return;
    }

    const selectedRole = canonicalizeBoardRole(this.selfRoleSelectTarget?.value);

    this.selfRoleSaveButtonTarget.disabled =
      this.isSubmittingBoardSelfRole === true
      || !selectedRole
      || !currentRole
      || selectedRole === currentRole;
    this.selfRoleSaveButtonTarget.textContent = this.t(
      this.isSubmittingBoardSelfRole === true
        ? 'boardOptionsDialog.savingSelfRole'
        : 'boardOptionsDialog.saveSelfRole'
    );
  }

  setBoardSelfRoleSubmittingState(isSubmitting, currentRole = this.getActiveBoardSelfRole()) {
    this.isSubmittingBoardSelfRole = isSubmitting === true;
    this.syncBoardSelfRoleActionState(currentRole);
  }

  showBoardSelfRoleError(message) {
    if (!this.hasSelfRoleErrorTarget) {
      return;
    }

    this.selfRoleErrorTarget.hidden = false;
    this.selfRoleErrorTarget.textContent = message;
  }

  hideBoardSelfRoleError() {
    if (!this.hasSelfRoleErrorTarget) {
      return;
    }

    this.selfRoleErrorTarget.hidden = true;
    this.selfRoleErrorTarget.textContent = '';
  }
}

function getInviterLabel(invitedBy) {
  return normalizeOptionalString(invitedBy?.displayName)
    || normalizeOptionalString(invitedBy?.email)
    || normalizeOptionalString(invitedBy?.id);
}

function getWorkspaceLabel(section, t) {
  const workspaceTitle = normalizeOptionalString(section?.workspaceTitle);

  if (workspaceTitle) {
    return workspaceTitle;
  }

  return normalizeOptionalString(section?.workspaceId);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
