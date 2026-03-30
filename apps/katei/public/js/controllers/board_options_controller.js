import { Controller } from '/vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '/js/i18n/browser.js';

export default class extends Controller {
  static targets = ['dialog', 'summary', 'boardList', 'boardItemTemplate', 'deleteButton'];

  connect() {
    this.t = getBrowserTranslator();
    this.workspace = null;
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.syncWorkspace(event.detail?.workspace);

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.dialogTarget.querySelector('[data-board-options-initial-focus]')?.focus();
    });
  }

  syncFromEvent(event) {
    this.syncWorkspace(event.detail?.workspace);
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

  syncWorkspace(workspace) {
    if (!workspace) {
      return;
    }

    this.workspace = workspace;
    this.render();
  }

  render() {
    if (!this.workspace || !this.activeBoard) {
      return;
    }

    this.summaryTarget.textContent = this.t('boardOptionsDialog.summaryActive', { title: this.activeBoard.title });
    this.deleteButtonTarget.hidden = this.workspace.boardOrder.length === 1;

    const items = this.workspace.boardOrder.map((boardId) => this.createBoardListItem(boardId));
    this.boardListTarget.replaceChildren(...items);
  }

  createBoardListItem(boardId) {
    const board = this.workspace.boards[boardId];
    const isActive = boardId === this.workspace.ui.activeBoardId;
    const item = this.boardItemTemplateTarget.content.firstElementChild.cloneNode(true);
    const titleElement = item.querySelector('[data-board-options-field="title"]');
    const stateElement = item.querySelector('[data-board-options-field="state"]');
    const switchButton = item.querySelector('[data-board-options-field="switchButton"]');

    titleElement.textContent = board.title;
    stateElement.textContent = isActive
      ? this.t('boardOptionsDialog.stateActive')
      : this.t('boardOptionsDialog.stateAvailable');
    switchButton.dataset.boardId = boardId;
    switchButton.hidden = isActive;

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
