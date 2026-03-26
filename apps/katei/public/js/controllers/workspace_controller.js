import { Controller } from '/vendor/stimulus/stimulus.js';
import {
  findColumnIdByCardId,
  getActiveBoard,
  getCollapsedColumnsForBoard,
  getColumnTitle,
  PRIORITY_LABELS
} from '../domain/workspace.js';
import { LocalWorkspaceRepository } from '../repositories/local_workspace_repository.js';
import { renderBoardState } from '../renderers/board_renderer.js';
import { WorkspaceService } from '../services/workspace_service.js';

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
    'confirmDialog',
    'confirmTitle',
    'confirmMessage',
    'confirmButton'
  ];

  connect() {
    this.service = new WorkspaceService(new LocalWorkspaceRepository(window.localStorage));
    this.templates = {
      columnTemplate: document.getElementById('column-panel-template'),
      cardTemplate: document.getElementById('card-item-template')
    };
    this.pendingConfirmation = null;
    this.viewTriggerElement = null;
    this.confirmTriggerElement = null;
    this.isConfirming = false;
    this.loadWorkspace();
  }

  get activeBoard() {
    return this.workspace ? getActiveBoard(this.workspace) : null;
  }

  async loadWorkspace() {
    await this.runAction(() => this.service.load());
  }

  openBoardOptions(event) {
    if (!this.workspace) {
      return;
    }

    this.dispatchWorkspaceEvent('open-board-options', {
      workspace: this.workspace,
      triggerElement: event?.currentTarget ?? null
    });
  }

  async toggleColumn(event) {
    const board = this.activeBoard;

    if (!board) {
      return;
    }

    const columnId = event.currentTarget.dataset.columnId;

    if (!columnId) {
      return;
    }

    const collapsedColumns = getCollapsedColumnsForBoard(this.workspace, board.id);
    const nextCollapsedState = !collapsedColumns[columnId];

    await this.runAction(
      () => this.service.setColumnCollapsed(board.id, columnId, nextCollapsedState),
      `${getColumnTitle(columnId)} ${nextCollapsedState ? 'collapsed' : 'expanded'}.`
    );
  }

  openCreateBoard() {
    this.dispatchWorkspaceEvent('open-board-editor', { mode: 'create' });
  }

  openRenameBoard() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatchWorkspaceEvent('open-board-editor', {
      mode: 'rename',
      board: this.activeBoard
    });
  }

  async handleBoardSwitch(event) {
    const { boardId } = event.detail;
    const boardTitle = this.workspace?.boards?.[boardId]?.title ?? 'board';

    await this.runAction(() => this.service.setActiveBoard(boardId), `Switched to ${boardTitle}.`);
  }

  async handleBoardEditorSave(event) {
    const { mode, boardId, title } = event.detail;

    if (mode === 'rename') {
      await this.runAction(() => this.service.renameBoard(boardId, title), 'Board renamed.');
      return;
    }

    await this.runAction(() => this.service.createBoard({ title }), 'Board created.');
  }

  confirmDeleteBoard(event) {
    const boardId = event.detail?.boardId ?? this.activeBoard?.id;
    const board = boardId ? this.workspace?.boards?.[boardId] : null;

    if (!board) {
      return;
    }

    this.openConfirmDialog({
      triggerElement: event.target,
      confirmation: {
        type: 'delete-board',
        boardId,
        title: 'Delete board?',
        message: `This action cannot be undone. "${board.title}" will be removed permanently.`,
        confirmLabel: 'Delete board'
      }
    });
  }

  confirmResetBoard(event) {
    const boardId = event.detail?.boardId ?? this.activeBoard?.id;
    const board = boardId ? this.workspace?.boards?.[boardId] : null;

    if (!board) {
      return;
    }

    this.openConfirmDialog({
      triggerElement: event.target,
      confirmation: {
        type: 'reset-board',
        boardId,
        title: 'Reset board?',
        message: `This will clear all cards from "${board.title}" and keep the board itself.`,
        confirmLabel: 'Reset board'
      }
    });
  }

  openCreateCard() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'create',
      boardId: this.activeBoard.id
    });
  }

  openEdit(event) {
    const board = this.activeBoard;

    if (!board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const columnId = button.dataset.columnId || findColumnIdByCardId(board, cardId);
    const card = board.cards[cardId];

    if (!card || !columnId) {
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'edit',
      boardId: board.id,
      card,
      columnId
    });
  }

  openView(event) {
    const board = this.activeBoard;

    if (!board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const columnId = button.dataset.columnId || findColumnIdByCardId(board, cardId);
    const card = board.cards[cardId];

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

  async handleCardEditorSave(event) {
    const { mode, boardId, cardId, sourceColumnId, targetColumnId, input } = event.detail;

    if (mode === 'edit') {
      await this.runAction(async () => {
        let nextWorkspace = await this.service.updateCard(boardId, cardId, input);

        if (sourceColumnId && targetColumnId && sourceColumnId !== targetColumnId) {
          nextWorkspace = await this.service.moveCard(boardId, cardId, sourceColumnId, targetColumnId);
        }

        return nextWorkspace;
      }, 'Card updated.');
      return;
    }

    await this.runAction(() => this.service.createCard(boardId, input), 'Card created.');
  }

  deleteCard(event) {
    const boardId = event.currentTarget.dataset.boardId || this.activeBoard?.id;
    const cardId = event.currentTarget.dataset.cardId;
    const board = boardId ? this.workspace?.boards?.[boardId] : null;
    const card = board?.cards?.[cardId];

    if (!card || !board) {
      return;
    }

    this.openConfirmDialog({
      triggerElement: event.currentTarget,
      confirmation: {
        type: 'delete-card',
        boardId,
        cardId,
        title: 'Delete card?',
        message: `This action cannot be undone. "${card.title}" will be removed permanently.`,
        confirmLabel: 'Delete'
      }
    });
  }

  async moveCardTo(event) {
    try {
      const { cardId, boardId, sourceColumnId, targetColumnId } = event.currentTarget.dataset;
      const nextBoardId = boardId || this.activeBoard?.id;

      await this.runAction(
        () => this.service.moveCard(nextBoardId, cardId, sourceColumnId, targetColumnId),
        `Moved card to ${getColumnTitle(targetColumnId)}.`
      );
    } catch (error) {
      console.error('Failed to move card.', error);
      this.announce('Unable to move card.');
    }
  }

  async runAction(action, successMessage = '') {
    try {
      const nextWorkspace = await action();
      this.workspace = nextWorkspace;
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
    if (!this.workspace || !this.activeBoard) {
      return;
    }

    renderBoardState({
      board: this.activeBoard,
      collapsedColumns: getCollapsedColumnsForBoard(this.workspace, this.activeBoard.id),
      regions: {
        boardTitle: this.boardTitleTarget,
        desktopColumns: this.desktopColumnsTarget
      },
      templates: this.templates
    });

    this.dispatchWorkspaceEvent('sync-board-options', {
      workspace: this.workspace
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

    if (this.confirmTriggerElement?.isConnected && (!triggerDialog || triggerDialog.open)) {
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
      success = await this.runAction(
        () => this.service.deleteCard(confirmation.boardId, confirmation.cardId),
        'Card deleted.'
      );
    } else if (confirmation.type === 'delete-board') {
      success = await this.runAction(
        () => this.service.deleteBoard(confirmation.boardId),
        'Board deleted.'
      );
    } else if (confirmation.type === 'reset-board') {
      success = await this.runAction(
        () => this.service.resetBoard(confirmation.boardId),
        'Board reset.'
      );
    }

    this.confirmButtonTarget.disabled = false;
    this.isConfirming = false;

    if (success) {
      this.closeConfirmDialog();
    }
  }

  dispatchWorkspaceEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(`workspace:${name}`, { detail }));
  }
}
