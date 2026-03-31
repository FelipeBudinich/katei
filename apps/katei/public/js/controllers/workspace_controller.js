import { Controller } from '/vendor/stimulus/stimulus.js';
import {
  getBoardCardContentVariant,
  getActiveBoard,
  getCollapsedColumnsForBoard
} from '../domain/workspace.js';
import { createBrowserDateTimeFormatter, getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { getPriorityDisplayLabel } from '../i18n/workspace_labels.js';
import { renderMarkdownInto } from '../lib/markdown.js';
import { HttpWorkspaceRepository } from '../repositories/http_workspace_repository.js';
import { renderBoardState } from '../renderers/board_renderer.js';
import { WorkspaceService } from '../services/workspace_service.js';
import {
  getBoardStageTitle,
  getDefaultBoardStageId,
  resolveBoardStageId,
  shouldShowPriorityForStage
} from './stage_ui.js';

export default class extends Controller {
  static values = {
    viewerSub: String
  };

  static targets = [
    'boardTitle',
    'desktopColumns',
    'announcer',
    'viewDialog',
    'viewCardTitle',
    'viewCardBody',
    'viewCardPrioritySection',
    'viewCardPriority',
    'viewCardUpdated',
    'confirmDialog',
    'confirmTitle',
    'confirmMessage',
    'confirmButton'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.dateTimeFormatter = createBrowserDateTimeFormatter();

    if (!this.hasViewerSubValue || !this.viewerSubValue.trim()) {
      console.error('Workspace viewer sub is missing.');
      this.announce(this.t('workspace.status.loadUnavailable'));
      return;
    }

    this.service = new WorkspaceService(
      new HttpWorkspaceRepository({
        fetchImpl: window.fetch.bind(window),
        viewerSub: this.viewerSubValue,
        storage: window.localStorage
      })
    );
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

    const stageId = resolveBoardStageId(board, {
      stageId: event.currentTarget.dataset.stageId,
      columnId: event.currentTarget.dataset.columnId
    });

    if (!stageId) {
      return;
    }

    const collapsedColumns = getCollapsedColumnsForBoard(this.workspace, board.id);
    const nextCollapsedState = !collapsedColumns[stageId];

    await this.runAction(
      () => this.service.setColumnCollapsed(board.id, stageId, nextCollapsedState),
      this.t(
        nextCollapsedState
          ? 'workspace.announcements.columnCollapsed'
          : 'workspace.announcements.columnExpanded',
        { column: getBoardStageTitle(board, stageId) }
      )
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
    const boardTitle = this.workspace?.boards?.[boardId]?.title ?? this.t('workspace.fallbackBoardTitle');

    await this.runAction(
      () => this.service.setActiveBoard(boardId),
      this.t('workspace.announcements.switchedBoard', { title: boardTitle })
    );
  }

  async handleBoardEditorSave(event) {
    const { mode, boardId, title } = event.detail;

    if (mode === 'rename') {
      await this.runAction(() => this.service.renameBoard(boardId, title), this.t('workspace.announcements.boardRenamed'));
      return;
    }

    await this.runAction(() => this.service.createBoard({ title }), this.t('workspace.announcements.boardCreated'));
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
        title: this.t('workspace.confirmations.deleteBoardTitle'),
        message: this.t('workspace.confirmations.deleteBoardMessage', { title: board.title }),
        confirmLabel: this.t('workspace.confirmations.deleteBoardConfirm')
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
        title: this.t('workspace.confirmations.resetBoardTitle'),
        message: this.t('workspace.confirmations.resetBoardMessage', { title: board.title }),
        confirmLabel: this.t('workspace.confirmations.resetBoardConfirm')
      }
    });
  }

  openCreateCard() {
    if (!this.activeBoard) {
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'create',
      boardId: this.activeBoard.id,
      board: this.activeBoard,
      stageId: getDefaultBoardStageId(this.activeBoard)
    });
  }

  openEdit(event) {
    const board = this.activeBoard;

    if (!board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const stageId = resolveBoardStageId(board, {
      stageId: button.dataset.stageId,
      columnId: button.dataset.columnId,
      cardId
    });
    const card = board.cards[cardId];

    if (!card || !stageId) {
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'edit',
      boardId: board.id,
      board,
      card: createRuntimeCardViewModel(card, board),
      stageId,
      columnId: stageId
    });
  }

  openView(event) {
    const board = this.activeBoard;

    if (!board) {
      return;
    }

    const button = event.currentTarget;
    const cardId = button.dataset.cardId;
    const stageId = resolveBoardStageId(board, {
      stageId: button.dataset.stageId,
      columnId: button.dataset.columnId,
      cardId
    });
    const card = board.cards[cardId];

    if (!card || !stageId) {
      return;
    }

    this.viewTriggerElement = button;
    this.syncViewDialog({ board, card, stageId });

    if (!this.viewDialogTarget.open) {
      this.viewDialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.viewDialogTarget.querySelector('[data-view-dialog-initial-focus]')?.focus();
    });
  }

  async handleCardEditorSave(event) {
    const {
      mode,
      boardId,
      cardId,
      sourceStageId,
      targetStageId,
      sourceColumnId,
      targetColumnId,
      input
    } = event.detail;
    const nextSourceStageId = sourceStageId || sourceColumnId;
    const nextTargetStageId = targetStageId || targetColumnId;

    if (mode === 'edit') {
      await this.runAction(async () => {
        let nextWorkspace = await this.service.updateCard(boardId, cardId, input);

        if (nextSourceStageId && nextTargetStageId && nextSourceStageId !== nextTargetStageId) {
          nextWorkspace = await this.service.moveCard(boardId, cardId, nextSourceStageId, nextTargetStageId);
        }

        return nextWorkspace;
      }, this.t('workspace.announcements.cardUpdated'));
      return;
    }

    await this.runAction(() => this.service.createCard(boardId, input), this.t('workspace.announcements.cardCreated'));
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
        title: this.t('workspace.confirmations.deleteCardTitle'),
        message: this.t('workspace.confirmations.deleteCardMessage', {
          title: getBoardCardContentVariant(card, board)?.title ?? ''
        }),
        confirmLabel: this.t('workspace.confirmations.deleteCardConfirm')
      }
    });
  }

  async moveCardTo(event) {
    try {
      const {
        cardId,
        boardId,
        sourceStageId,
        targetStageId,
        sourceColumnId,
        targetColumnId
      } = event.currentTarget.dataset;
      const nextBoardId = boardId || this.activeBoard?.id;
      const board = nextBoardId ? this.workspace?.boards?.[nextBoardId] : null;
      const nextSourceStageId = sourceStageId || sourceColumnId;
      const nextTargetStageId = targetStageId || targetColumnId;

      if (!board || !nextSourceStageId || !nextTargetStageId) {
        return;
      }

      await this.runAction(
        () => this.service.moveCard(nextBoardId, cardId, nextSourceStageId, nextTargetStageId),
        this.t('workspace.announcements.movedCard', {
          column: getBoardStageTitle(board, nextTargetStageId)
        })
      );
    } catch (error) {
      console.error('Failed to move card.', error);
      this.announce(this.t('workspace.status.moveUnavailable'));
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
      this.announce(localizeErrorMessage(error, this.t));
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
      templates: this.templates,
      t: this.t,
      dateTimeFormatter: this.dateTimeFormatter
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

  syncViewDialog({ board, card, stageId }) {
    const shouldShowPriority = shouldShowPriorityForStage(stageId);
    const content = getBoardCardContentVariant(card, board);

    this.viewCardTitleTarget.textContent = content?.title ?? '';
    if (content?.detailsMarkdown) {
      renderMarkdownInto(this.viewCardBodyTarget, content.detailsMarkdown);
    } else {
      this.viewCardBodyTarget.textContent = this.t('workspace.view.noDetails');
    }
    this.viewCardPrioritySectionTarget.hidden = !shouldShowPriority;
    this.viewCardPriorityTarget.textContent = shouldShowPriority ? getPriorityDisplayLabel(card.priority, this.t) : '';
    this.viewCardUpdatedTarget.textContent = this.dateTimeFormatter.format(new Date(card.updatedAt));
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
        this.t('workspace.announcements.cardDeleted')
      );
    } else if (confirmation.type === 'delete-board') {
      success = await this.runAction(
        () => this.service.deleteBoard(confirmation.boardId),
        this.t('workspace.announcements.boardDeleted')
      );
    } else if (confirmation.type === 'reset-board') {
      success = await this.runAction(
        () => this.service.resetBoard(confirmation.boardId),
        this.t('workspace.announcements.boardReset')
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

function createRuntimeCardViewModel(card, board) {
  const content = getBoardCardContentVariant(card, board);

  return {
    ...card,
    title: content?.title ?? '',
    detailsMarkdown: content?.detailsMarkdown ?? ''
  };
}
