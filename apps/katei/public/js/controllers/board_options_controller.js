import { Controller } from '/vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '/js/i18n/browser.js';
import {
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
    'renameButton',
    'resetButton',
    'deleteButton',
    'collaboratorsButton',
    'collaboratorBadge'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.workspace = null;
    this.viewerActor = null;
    this.optionsState = null;
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor);

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.dialogTarget.querySelector('[data-board-options-initial-focus]')?.focus();
    });
  }

  syncFromEvent(event) {
    this.syncWorkspace(event.detail?.workspace, event.detail?.viewerActor);
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

  get activeBoard() {
    return this.workspace ? this.workspace.boards[this.workspace.ui.activeBoardId] : null;
  }

  syncWorkspace(workspace, viewerActor = this.viewerActor) {
    if (!workspace) {
      return;
    }

    this.workspace = workspace;
    this.viewerActor = viewerActor ?? this.viewerActor;
    this.optionsState = createBoardOptionsState(this.workspace, this.viewerActor);
    this.render();
  }

  render() {
    const activeBoardState = this.optionsState?.activeBoardState ?? null;

    if (!this.workspace || !this.activeBoard || !activeBoardState) {
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
    this.resetButtonTarget.hidden = !activeBoardState.canAdmin;
    this.deleteButtonTarget.hidden = !activeBoardState.canAdmin || this.workspace.boardOrder.length === 1;
    this.collaboratorsButtonTarget.hidden = !this.activeBoard;
    this.collaboratorBadgeTarget.hidden = activeBoardState.pendingInviteCount === 0;
    this.collaboratorBadgeTarget.textContent = String(activeBoardState.pendingInviteCount);

    const items = this.optionsState.boardStates.map((boardState) => this.createBoardListItem(boardState));
    this.boardListTarget.replaceChildren(...items);
  }

  createBoardListItem(boardState) {
    const item = this.boardItemTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="title"]');
    const stateElement = item.querySelector('[data-board-options-field="state"]');
    const switchButton = item.querySelector('[data-board-options-field="switchButton"]');

    titleElement.textContent = boardState.title;
    stateElement.textContent = boardState.isActive
      ? this.t('boardOptionsDialog.stateActive')
      : this.t(getBoardRoleTranslationKey(boardState.currentRoleStatus));
    switchButton.dataset.boardId = boardState.boardId;
    switchButton.hidden = !boardState.canSwitch;

    return item;
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
