import { Controller } from '/vendor/stimulus/stimulus.js';
import { findColumnIdByCardId, PRIORITY_LABELS } from '../domain/board.js';
import { LocalBoardRepository } from '../repositories/local_board_repository.js';
import { renderBoardState } from '../renderers/board_renderer.js';
import { BoardService } from '../services/board_service.js';

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export default class extends Controller {
  static targets = [
    'boardTitle',
    'desktopColumns',
    'announcer',
    'viewDialog',
    'viewCardTitle',
    'viewCardDescription',
    'viewCardPrioritySection',
    'viewCardPriority',
    'viewCardUpdated',
    'resetMenuDialog',
    'confirmDialog',
    'confirmTitle',
    'confirmMessage',
    'confirmButton'
  ];

  connect() {
    this.service = new BoardService(new LocalBoardRepository(window.localStorage));
    this.templates = {
      columnTemplate: document.getElementById('column-panel-template'),
      cardTemplate: document.getElementById('card-item-template')
    };
    this.pendingConfirmation = null;
    this.viewTriggerElement = null;
    this.resetMenuTriggerElement = null;
    this.confirmTriggerElement = null;
    this.isConfirming = false;
    this.loadBoard();
  }

  async loadBoard() {
    await this.runAction(() => this.service.load());
  }

  openCreate() {
    if (!this.board) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('board:open-editor', {
        detail: {
          mode: 'create'
        }
      })
    );
  }

  openResetMenu(event) {
    this.resetMenuTriggerElement = event?.currentTarget ?? null;

    if (!this.resetMenuDialogTarget.open) {
      this.resetMenuDialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.resetMenuDialogTarget.querySelector('[data-reset-menu-initial-focus]')?.focus();
    });
  }

  backdropCloseResetMenu(event) {
    if (event.target === this.resetMenuDialogTarget) {
      this.closeResetMenu();
    }
  }

  closeResetMenu(event) {
    if (event) {
      event.preventDefault();
    }

    this.closeResetMenuDialog();
  }

  openEdit(event) {
    if (!this.board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const columnId = button.dataset.columnId || findColumnIdByCardId(this.board, cardId);
    const card = this.board.cards[cardId];

    if (!card || !columnId) {
      return;
    }

    window.dispatchEvent(
      new CustomEvent('board:open-editor', {
        detail: {
          mode: 'edit',
          card,
          columnId
        }
      })
    );
  }

  openView(event) {
    if (!this.board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const columnId = button.dataset.columnId || findColumnIdByCardId(this.board, cardId);
    const card = this.board.cards[cardId];

    if (!card || !columnId) {
      return;
    }

    this.viewTriggerElement = button;
    this.syncViewDialog({ card, columnId });

    if (!this.viewDialogTarget.open) {
      this.viewDialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.viewDialogTarget.querySelector('[data-view-dialog-initial-focus]')?.focus();
    });
  }

  async handleEditorSave(event) {
    const { mode, cardId, input } = event.detail;

    if (mode === 'edit') {
      await this.runAction(() => this.service.updateCard(cardId, input), 'Card updated.');
      return;
    }

    await this.runAction(() => this.service.createCard(input), 'Card created.');
  }

  async deleteCard(event) {
    const { cardId } = event.currentTarget.dataset;
    const card = this.board?.cards[cardId];

    if (!card) {
      return;
    }

    this.openConfirmDialog({
      triggerElement: event.currentTarget,
      confirmation: {
        type: 'delete-card',
        cardId,
        title: 'Delete card?',
        message: `This action cannot be undone. "${card.title}" will be removed permanently.`,
        confirmLabel: 'Delete'
      }
    });
  }

  async moveCardTo(event) {
    const { cardId, sourceColumnId, targetColumnId } = event.currentTarget.dataset;

    await this.runAction(
      () => this.service.moveCard(cardId, sourceColumnId, targetColumnId),
      `Moved card to ${getColumnTitle(targetColumnId)}.`
    );
  }

  async resetBoard(event) {
    this.closeResetMenuDialog({ restoreFocus: false });

    this.openConfirmDialog({
      triggerElement: event?.currentTarget ?? null,
      confirmation: {
        type: 'reset-board',
        title: 'Reset board?',
        message: 'This will clear all saved cards and restore the default board state.',
        confirmLabel: 'Reset board'
      }
    });
  }

  async runAction(action, successMessage = '') {
    try {
      const nextBoard = await action();
      this.board = nextBoard;
      this.render();

      if (successMessage) {
        this.announce(successMessage);
      }

      return true;
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      this.announce(message);
      return false;
    }
  }

  render() {
    renderBoardState({
      board: this.board,
      regions: {
        boardTitle: this.boardTitleTarget,
        desktopColumns: this.desktopColumnsTarget
      },
      templates: this.templates
    });
  }

  announce(message) {
    this.announcerTarget.textContent = message;
  }

  backdropCloseViewDialog(event) {
    if (event.target === this.viewDialogTarget) {
      this.closeViewDialog();
    }
  }

  closeViewDialog(event) {
    if (event) {
      event.preventDefault();
    }

    if (this.viewDialogTarget.open) {
      this.viewDialogTarget.close();
    }

    if (this.viewTriggerElement?.isConnected) {
      this.viewTriggerElement.focus();
    }

    this.viewTriggerElement = null;
  }

  closeResetMenuDialog({ restoreFocus = true } = {}) {
    if (this.resetMenuDialogTarget.open) {
      this.resetMenuDialogTarget.close();
    }

    if (restoreFocus && this.resetMenuTriggerElement?.isConnected) {
      this.resetMenuTriggerElement.focus();
    }

    this.resetMenuTriggerElement = null;
  }

  openConfirmDialog({ triggerElement, confirmation }) {
    this.pendingConfirmation = confirmation;
    this.confirmTriggerElement = triggerElement;
    this.confirmTitleTarget.textContent = confirmation.title;
    this.confirmMessageTarget.textContent = confirmation.message;
    this.confirmButtonTarget.textContent = confirmation.confirmLabel;

    if (!this.confirmDialogTarget.open) {
      this.confirmDialogTarget.showModal();
    }

    requestAnimationFrame(() => this.confirmButtonTarget.focus());
  }

  backdropCloseConfirmDialog(event) {
    if (event.target === this.confirmDialogTarget) {
      this.closeConfirmDialog();
    }
  }

  closeConfirmDialog(event) {
    if (event) {
      event.preventDefault();
    }

    this.pendingConfirmation = null;

    if (this.confirmDialogTarget.open) {
      this.confirmDialogTarget.close();
    }

    const triggerDialog = this.confirmTriggerElement?.closest?.('dialog');

    if (
      this.confirmTriggerElement?.isConnected &&
      (!triggerDialog || triggerDialog.open)
    ) {
      this.confirmTriggerElement.focus();
    }

    this.confirmTriggerElement = null;
  }

  syncViewDialog({ card, columnId }) {
    const shouldShowPriority = columnId !== 'done' && columnId !== 'archived';

    this.viewCardTitleTarget.textContent = card.title;
    this.viewCardDescriptionTarget.textContent = card.description || 'No description added.';
    this.viewCardPrioritySectionTarget.hidden = !shouldShowPriority;
    this.viewCardPriorityTarget.textContent = shouldShowPriority ? PRIORITY_LABELS[card.priority] : '';
    this.viewCardUpdatedTarget.textContent = timestampFormatter.format(new Date(card.updatedAt));
  }

  async confirmPendingAction(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.pendingConfirmation || this.isConfirming) {
      return;
    }

    const confirmation = this.pendingConfirmation;
    this.isConfirming = true;
    this.confirmButtonTarget.disabled = true;

    let success = false;

    if (confirmation.type === 'delete-card') {
      success = await this.runAction(() => this.service.deleteCard(confirmation.cardId), 'Card deleted.');
    } else if (confirmation.type === 'reset-board') {
      success = await this.runAction(() => this.service.reset(), 'Board reset to defaults.');
    }

    this.confirmButtonTarget.disabled = false;
    this.isConfirming = false;

    if (success) {
      this.closeConfirmDialog();
    }
  }
}
