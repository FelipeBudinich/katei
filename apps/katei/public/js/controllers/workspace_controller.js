import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBoardCardContentVariant } from '../domain/workspace.js';
import { createBrowserDateTimeFormatter, getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { getPriorityDisplayLabel } from '../i18n/workspace_labels.js';
import { logInviteAcceptDebug, logInviteDebug } from '../lib/invite_debug.js';
import { renderMarkdownInto } from '../lib/markdown.js';
import { HttpWorkspaceRepository } from '../repositories/http_workspace_repository.js';
import { renderBoardState } from '../renderers/board_renderer.js';
import { WorkspaceService } from '../services/workspace_service.js';
import {
  createWorkspaceViewerActor,
  getBoardCollaborationState
} from './board_collaboration_state.js';
import {
  performWorkspaceCollaboratorAction,
  performWorkspaceInviteDecision
} from './workspace_collaboration_actions.js';
import {
  buildCardEditorMutationPlan,
  createCardLocaleRequestAction,
  createRuntimeCardDialogState,
  executeWorkspaceCardEditorPlan,
  executeWorkspaceServiceAction
} from './workspace_card_dialog.js';
import { createLocalizedCardViewState } from './card_editor_locale_view.js';
import {
  getBoardStageTitle,
  getDefaultBoardStageId,
  resolveBoardStageId,
  shouldShowPriorityForStage
} from './stage_ui.js';

export default class extends Controller {
  static values = {
    viewerSub: String,
    viewerEmail: String
  };

  static targets = [
    'boardTitle',
    'boardAccessNotice',
    'desktopColumns',
    'createCardButton',
    'announcer',
    'viewDialog',
    'viewLocaleSection',
    'viewLocaleSelect',
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
    this.viewerActor = createWorkspaceViewerActor({
      sub: this.viewerSubValue,
      email: this.hasViewerEmailValue ? this.viewerEmailValue : null
    });
    this.columnCollapseState = new Map();
    this.pendingConfirmation = null;
    this.viewTriggerElement = null;
    this.viewDialogState = null;
    this.confirmTriggerElement = null;
    this.isConfirming = false;
    this.loadWorkspace();
  }

  get activeBoard() {
    const activeBoardId = typeof this.workspace?.ui?.activeBoardId === 'string' ? this.workspace.ui.activeBoardId.trim() : '';
    return activeBoardId ? this.workspace?.boards?.[activeBoardId] ?? null : null;
  }

  get activeBoardCollaborationState() {
    return this.activeBoard ? getBoardCollaborationState(this.activeBoard, this.viewerActor) : null;
  }

  get canEditActiveBoard() {
    return Boolean(this.activeBoardCollaborationState?.canEdit);
  }

  get canAdminActiveBoard() {
    return Boolean(this.activeBoardCollaborationState?.canAdmin);
  }

  async loadWorkspace() {
    await this.runAction(() => this.service.load());
  }

  openBoardOptions(event) {
    if (!this.workspace) {
      return;
    }

    this.dispatchWorkspaceEvent(
      'open-board-options',
      this.createBoardOptionsEventDetail({
        triggerElement: event?.currentTarget ?? null
      })
    );
  }

  openProfileOptions(event) {
    this.dispatchWorkspaceEvent('open-profile-options', {
      triggerElement: event?.currentTarget ?? null
    });
  }

  toggleColumn(event) {
    const board = this.activeBoard;

    if (!board || !this.activeBoardCollaborationState?.canRead) {
      if (board) {
        this.announce(this.t('errors.boardReadPermissionDenied'));
      }
      return;
    }

    const stageId = resolveBoardStageId(board, {
      stageId: event.currentTarget.dataset.stageId,
      columnId: event.currentTarget.dataset.columnId
    });

    if (!stageId) {
      return;
    }

    const collapsedColumns = this.getCollapsedColumnsForBoard(board);
    const nextCollapsedState = !collapsedColumns[stageId];
    this.setColumnCollapsed(board, stageId, nextCollapsedState);
    this.syncColumnPanelState(event?.currentTarget?.closest?.('.column-panel') ?? null, nextCollapsedState);
    this.announce(
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
    if (!this.activeBoard || !this.canAdminActiveBoard) {
      if (this.activeBoard) {
        this.announce(this.t('errors.boardAdminPermissionDenied'));
      }
      return;
    }

    this.dispatchWorkspaceEvent('open-board-editor', {
      mode: 'rename',
      board: this.activeBoard
    });
  }

  openBoardCollaborators(event) {
    const boardId = event.detail?.boardId ?? this.activeBoard?.id;
    const board = boardId ? this.workspace?.boards?.[boardId] : null;

    if (!board) {
      return;
    }

    this.dispatchWorkspaceEvent('open-board-collaborators', {
      workspace: this.workspace,
      viewerActor: this.viewerActor,
      boardId,
      triggerElement: event?.target ?? null
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
    const { mode, boardId, input } = event.detail;

    if (mode === 'rename') {
      await this.runAction(() => this.service.updateBoard(boardId, input), this.t('workspace.announcements.boardUpdated'));
      return;
    }

    await this.runAction(() => this.service.createBoard(input), this.t('workspace.announcements.boardCreated'));
  }

  async handleInviteMember(event) {
    await this.runCollaboratorAction('invite-member', event.detail, this.t('workspace.announcements.inviteSent'));
  }

  async handleRevokeInvite(event) {
    await this.runCollaboratorAction('revoke-invite', event.detail, this.t('workspace.announcements.inviteRevoked'));
  }

  async handleChangeMemberRole(event) {
    await this.runCollaboratorAction('change-member-role', event.detail, this.t('workspace.announcements.memberRoleUpdated'));
  }

  async handleRemoveMember(event) {
    await this.runCollaboratorAction('remove-member', event.detail, this.t('workspace.announcements.memberRemoved'));
  }

  async handleAcceptInvite(event) {
    const detail = event?.detail ?? {};
    const debugContext = this.service?.getDebugContext?.() ?? {};
    const pendingWorkspaceInvites = this.service?.getPendingWorkspaceInvites?.() ?? [];
    const inviteSummary = findPendingWorkspaceInviteSummary(pendingWorkspaceInvites, detail);
    const currentInvite = findWorkspaceInvite(this.workspace, detail?.boardId, detail?.inviteId);

    logInviteAcceptDebug('client.controller.handleAcceptInvite', {
      inviteId: detail?.inviteId ?? null,
      inviteWorkspaceId: detail?.workspaceId ?? this.workspace?.workspaceId ?? null,
      inviteBoardId: detail?.boardId ?? null,
      inviteStatus: currentInvite?.status ?? inviteSummary?.status ?? null,
      currentActiveWorkspaceId: this.service?.getActiveWorkspaceId?.() ?? null,
      currentActiveWorkspaceRevision: debugContext.cachedRevision ?? null,
      currentActiveWorkspaceRevisionSource: debugContext.revisionSource ?? null,
      currentActiveWorkspaceRevisionWorkspaceId: debugContext.revisionWorkspaceId ?? null,
      inviteWorkspaceSummaryRevision: Number.isInteger(inviteSummary?.revision) ? inviteSummary.revision : null,
      inviteWorkspaceSummaryRevisionSource:
        Number.isInteger(inviteSummary?.revision) ? 'pendingWorkspaceInvites' : 'not-available'
    });

    await this.runInviteDecision('accept', event.detail, this.t('workspace.announcements.inviteAccepted'));
  }

  async handleDeclineInvite(event) {
    await this.runInviteDecision('decline', event.detail, this.t('workspace.announcements.inviteDeclined'));
  }

  confirmDeleteBoard(event) {
    const boardId = event.detail?.boardId ?? this.activeBoard?.id;
    const board = boardId ? this.workspace?.boards?.[boardId] : null;
    const boardState = board ? getBoardCollaborationState(board, this.viewerActor) : null;

    if (!board) {
      return;
    }

    if (!boardState?.canAdmin) {
      this.announce(this.t('errors.boardAdminPermissionDenied'));
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
    const boardState = board ? getBoardCollaborationState(board, this.viewerActor) : null;

    if (!board) {
      return;
    }

    if (!boardState?.canAdmin) {
      this.announce(this.t('errors.boardAdminPermissionDenied'));
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

  openCreateCard(event) {
    if (!this.activeBoard || !this.canEditActiveBoard) {
      if (this.activeBoard) {
        this.announce(this.t('errors.boardEditPermissionDenied'));
      }
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'create',
      boardId: this.activeBoard.id,
      board: this.activeBoard,
      currentActorRole: this.activeBoardCollaborationState?.currentRole ?? null,
      canEditLocalizedContent: this.canEditActiveBoard,
      stageId: getDefaultBoardStageId(this.activeBoard),
      triggerElement: event?.currentTarget ?? null
    });
  }

  openEdit(event) {
    const board = this.activeBoard;

    if (!board || !this.canEditActiveBoard) {
      if (board) {
        this.announce(this.t('errors.boardEditPermissionDenied'));
      }
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
      ...createRuntimeCardDialogState(card, board, {
        requestedLocale: button.dataset.requestedLocale ?? button.dataset.locale ?? null,
        currentActorRole: this.activeBoardCollaborationState?.currentRole ?? null,
        canEditLocalizedContent: this.canEditActiveBoard
      }),
      stageId,
      triggerElement: button
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
    this.viewDialogState = {
      board,
      card,
      stageId,
      selectedLocale: button.dataset.requestedLocale ?? button.dataset.locale ?? null
    };
    this.syncViewDialog();

    if (!this.viewDialogTarget.open) {
      this.viewDialogTarget.showModal();
    }

    scheduleBrowserFrame(() => {
      if (
        this.hasViewLocaleSectionTarget &&
        this.hasViewLocaleSelectTarget &&
        !this.viewLocaleSectionTarget.hidden &&
        this.viewLocaleSelectTarget.options.length > 0
      ) {
        this.viewLocaleSelectTarget.focus();
        return;
      }

      this.viewDialogTarget
        .querySelector?.('[data-view-dialog-initial-focus]')
        ?.focus?.();
    });
  }

  changeViewLocale(event) {
    event.preventDefault();

    if (!this.viewDialogState) {
      return;
    }

    this.viewDialogState = {
      ...this.viewDialogState,
      selectedLocale: event.currentTarget.value || null
    };
    this.syncViewDialog();
  }

  async handleCardEditorSave(event) {
    const {
      mode,
      boardId,
      cardId,
      locale,
      sourceStageId,
      targetStageId,
      input
    } = event.detail;

    if (mode === 'edit') {
      const board = boardId ? this.workspace?.boards?.[boardId] : null;
      const card = board?.cards?.[cardId] ?? null;
      const plan = buildCardEditorMutationPlan({
        mode,
        board,
        card,
        boardId,
        cardId,
        locale,
        input,
        sourceStageId,
        targetStageId
      });

      if (plan.operations.length < 1) {
        return;
      }

      await this.runAction(
        () => executeWorkspaceCardEditorPlan(this.service, plan),
        this.t(
          plan.includesLocalizedUpsert
            ? 'workspace.announcements.localizedContentUpdated'
            : 'workspace.announcements.cardUpdated'
        )
      );
      return;
    }

    await this.runAction(() => this.service.createCard(boardId, input), this.t('workspace.announcements.cardCreated'));
  }

  async handleCardLocaleRequest(event) {
    const action = createCardLocaleRequestAction(event.detail);
    const success = await this.runAction(
      () => executeWorkspaceServiceAction(this.service, action),
      this.t('workspace.announcements.localeRequested')
    );

    if (success) {
      this.refreshCardEditor({
        boardId: event.detail?.boardId,
        cardId: event.detail?.cardId,
        locale: event.detail?.locale,
        mode: 'edit'
      });
    }
  }

  async handleCardLocaleRequestClear(event) {
    const action = createCardLocaleRequestAction({
      ...event.detail,
      clear: true
    });
    const success = await this.runAction(
      () => executeWorkspaceServiceAction(this.service, action),
      this.t('workspace.announcements.localeRequestCleared')
    );

    if (success) {
      this.refreshCardEditor({
        boardId: event.detail?.boardId,
        cardId: event.detail?.cardId,
        locale: event.detail?.locale,
        mode: 'edit'
      });
    }
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

  async runCollaboratorAction(actionName, detail, successMessage) {
    return this.runAction(
      () =>
        performWorkspaceCollaboratorAction({
          service: this.service,
          action: actionName,
          detail
        }),
      successMessage
    );
  }

  async runInviteDecision(decision, detail, successMessage) {
    try {
      const activeWorkspaceId = this.service?.getActiveWorkspaceId?.() ?? null;
      const targetWorkspaceId = normalizeOptionalWorkspaceId(detail?.workspaceId) ?? activeWorkspaceId;
      const debugContext = this.service?.getDebugContext?.() ?? {};

      logInviteAcceptDebug('client.controller.runInviteDecision', {
        decision,
        resolvedWorkspaceId: targetWorkspaceId,
        resolvedBoardId: detail?.boardId ?? null,
        resolvedInviteId: detail?.inviteId ?? null,
        resolvedRevision: debugContext.cachedRevision ?? null,
        revisionWorkspaceId: debugContext.revisionWorkspaceId ?? null,
        revisionSource: debugContext.revisionSource ?? null,
        revisionReadFrom: describeRevisionOrigin(debugContext, targetWorkspaceId, activeWorkspaceId)
      });

      const result = await performWorkspaceInviteDecision({
        service: this.service,
        decision,
        detail,
        viewerActor: this.viewerActor,
        activeWorkspaceId: this.service.getActiveWorkspaceId()
      });

      this.workspace = result.workspace;
      this.render();
      this.announce(
        result.leftWorkspace
          ? this.t('workspace.announcements.returnedHomeWorkspace')
          : successMessage
      );

      return true;
    } catch (error) {
      console.error(error);
      this.announce(localizeErrorMessage(error, this.t));
      return false;
    }
  }

  render() {
    const activeBoardState = this.activeBoardCollaborationState;

    if (!this.workspace) {
      return;
    }

    if (!this.activeBoard || !activeBoardState) {
      if (this.hasCreateCardButtonTarget) {
        this.createCardButtonTarget.hidden = true;
        this.createCardButtonTarget.disabled = true;
        this.createCardButtonTarget.setAttribute('aria-disabled', 'true');
      }

      if (this.hasBoardAccessNoticeTarget) {
        this.boardAccessNoticeTarget.hidden = false;
        this.boardAccessNoticeTarget.textContent = this.t('workspace.noVisibleBoardsDescription');
      }

      if (this.hasBoardTitleTarget) {
        this.boardTitleTarget.textContent = this.t('workspace.noVisibleBoardsTitle');
      }

      if (this.hasDesktopColumnsTarget) {
        this.desktopColumnsTarget.hidden = true;
        this.desktopColumnsTarget.replaceChildren();
      }

      this.dispatchWorkspaceEvent('sync-board-options', this.createBoardOptionsEventDetail());
      this.dispatchWorkspaceEvent('sync-board-collaborators', {
        workspace: this.workspace,
        viewerActor: this.viewerActor,
        boardId: null
      });
      return;
    }

    if (this.hasCreateCardButtonTarget) {
      this.createCardButtonTarget.hidden = !activeBoardState.canEdit;
      this.createCardButtonTarget.disabled = !activeBoardState.canEdit;
      this.createCardButtonTarget.setAttribute('aria-disabled', String(!activeBoardState.canEdit));
    }

    if (this.hasBoardAccessNoticeTarget) {
      this.boardAccessNoticeTarget.hidden = activeBoardState.canRead || !activeBoardState.pendingInvite;
      this.boardAccessNoticeTarget.textContent = activeBoardState.pendingInvite
        ? this.t('workspace.boardInvitePendingNotice')
        : '';
    }

    renderBoardState({
      board: this.activeBoard,
      collapsedColumns: this.getCollapsedColumnsForBoard(this.activeBoard),
      canReadBoard: activeBoardState.canRead,
      canEditBoard: activeBoardState.canEdit,
      regions: {
        boardTitle: this.boardTitleTarget,
        desktopColumns: this.desktopColumnsTarget
      },
      templates: this.templates,
      t: this.t,
      dateTimeFormatter: this.dateTimeFormatter
    });

    this.dispatchWorkspaceEvent('sync-board-options', this.createBoardOptionsEventDetail());
    this.dispatchWorkspaceEvent('sync-board-collaborators', {
      workspace: this.workspace,
      viewerActor: this.viewerActor,
      boardId: this.activeBoard.id
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

    this.viewDialogState = null;
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

  syncViewDialog() {
    const { board, card, stageId, selectedLocale } = this.viewDialogState ?? {};
    const localizedView = createLocalizedCardViewState({
      board,
      card,
      selectedLocale,
      localeSelection: 'available'
    });
    const shouldShowPriority = shouldShowPriorityForStage(stageId);
    const content = localizedView.variant;
    const localeOptions = localizedView.availableLocales.map((locale) => createLocaleOption(locale));

    if (this.hasViewLocaleSectionTarget && this.hasViewLocaleSelectTarget) {
      const shouldShowLocaleSection = localeOptions.length > 0;
      this.viewLocaleSectionTarget.hidden = !shouldShowLocaleSection;
      this.viewLocaleSelectTarget.replaceChildren(...localeOptions);
      this.viewLocaleSelectTarget.value = localizedView.selectedLocale ?? '';
      this.viewLocaleSelectTarget.disabled = !shouldShowLocaleSection;
      this.viewLocaleSelectTarget.setAttribute('aria-disabled', String(!shouldShowLocaleSection));
    }

    this.viewDialogState = card
      ? {
          board,
          card,
          stageId,
          selectedLocale: localizedView.selectedLocale
        }
      : null;

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

  createBoardOptionsEventDetail({ triggerElement = null } = {}) {
    const detail = {
      workspace: this.workspace,
      viewerActor: this.viewerActor,
      triggerElement,
      activeWorkspaceId: this.service?.getActiveWorkspaceId?.() ?? null,
      pendingWorkspaceInvites: this.service?.getPendingWorkspaceInvites?.() ?? []
    };

    logInviteDebug('client.invite.state', {
      source: 'workspace-controller',
      viewerSub: this.viewerActor?.id ?? null,
      viewerEmail: this.viewerActor?.email ?? null,
      workspaceId: this.workspace?.workspaceId ?? null,
      workspaceBoardOrder: Array.isArray(this.workspace?.boardOrder) ? this.workspace.boardOrder : [],
      workspaceActiveBoardId: this.workspace?.ui?.activeBoardId ?? null,
      activeWorkspaceId: detail.activeWorkspaceId,
      pendingWorkspaceInvitesCount: detail.pendingWorkspaceInvites.length,
      pendingWorkspaceInviteIds: detail.pendingWorkspaceInvites.map((invite) => invite.inviteId)
    });

    return detail;
  }

  getCollapsedColumnsForBoard(board) {
    if (!board || !Array.isArray(board.stageOrder)) {
      return {};
    }

    if (!(this.columnCollapseState instanceof Map)) {
      this.columnCollapseState = new Map();
    }

    const cacheKey = createColumnCollapseCacheKey(this.workspace?.workspaceId, board.id);
    const currentState = this.columnCollapseState.get(cacheKey) ?? {};
    const nextState = {};

    for (const stageId of board.stageOrder) {
      nextState[stageId] = Boolean(currentState[stageId]);
    }

    this.columnCollapseState.set(cacheKey, nextState);
    return nextState;
  }

  setColumnCollapsed(board, stageId, isCollapsed) {
    if (!board || !stageId) {
      return;
    }

    const cacheKey = createColumnCollapseCacheKey(this.workspace?.workspaceId, board.id);
    const currentState = this.getCollapsedColumnsForBoard(board);
    currentState[stageId] = Boolean(isCollapsed);
    this.columnCollapseState.set(cacheKey, currentState);
  }

  syncColumnPanelState(panelElement, isCollapsed) {
    if (!panelElement) {
      return;
    }

    panelElement.dataset.collapsed = String(Boolean(isCollapsed));

    const toggleElement = panelElement.querySelector('[data-column-toggle]');
    if (toggleElement) {
      toggleElement.setAttribute('aria-expanded', String(!isCollapsed));
    }

    const bodyElement = panelElement.querySelector('.column-panel-body');
    if (!bodyElement) {
      return;
    }

    const cardsContainer = panelElement.querySelector('[data-column-cards]');
    const hasCards = Boolean(cardsContainer?.childElementCount);
    bodyElement.hidden = Boolean(isCollapsed) || !hasCards;
  }

  refreshCardEditor({ boardId, cardId, locale, mode = 'edit' } = {}) {
    const board = boardId ? this.workspace?.boards?.[boardId] : null;
    const card = board?.cards?.[cardId] ?? null;

    if (!board || !card) {
      return;
    }

    const boardState = getBoardCollaborationState(board, this.viewerActor);
    const stageId = resolveBoardStageId(board, { cardId });

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode,
      boardId: board.id,
      board,
      ...createRuntimeCardDialogState(card, board, {
        requestedLocale: locale,
        currentActorRole: boardState?.currentRole ?? null,
        canEditLocalizedContent: boardState?.canEdit ?? false
      }),
      stageId
    });
  }
}

function createColumnCollapseCacheKey(workspaceId, boardId) {
  const normalizedWorkspaceId = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : '__workspace__';
  const normalizedBoardId = typeof boardId === 'string' && boardId.trim() ? boardId.trim() : '__board__';
  return `${normalizedWorkspaceId}::${normalizedBoardId}`;
}

function createLocaleOption(locale) {
  const option = document.createElement('option');
  option.value = locale;
  option.textContent = locale;
  return option;
}

function scheduleBrowserFrame(callback) {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }

  callback();
}

function findPendingWorkspaceInviteSummary(pendingWorkspaceInvites, detail) {
  if (!Array.isArray(pendingWorkspaceInvites)) {
    return null;
  }

  return pendingWorkspaceInvites.find((invite) =>
    invite?.workspaceId === detail?.workspaceId
      && invite?.boardId === detail?.boardId
      && invite?.inviteId === detail?.inviteId
  ) ?? null;
}

function findWorkspaceInvite(workspace, boardId, inviteId) {
  const normalizedBoardId = normalizeOptionalWorkspaceId(boardId);
  const normalizedInviteId = normalizeOptionalWorkspaceId(inviteId);
  const invites = Array.isArray(workspace?.boards?.[normalizedBoardId]?.collaboration?.invites)
    ? workspace.boards[normalizedBoardId].collaboration.invites
    : [];

  return invites.find((invite) => invite?.id === normalizedInviteId) ?? null;
}

function describeRevisionOrigin(debugContext, targetWorkspaceId, activeWorkspaceId) {
  if (!Number.isInteger(debugContext?.cachedRevision)) {
    return 'not-available';
  }

  if (debugContext?.revisionWorkspaceId && targetWorkspaceId && debugContext.revisionWorkspaceId === targetWorkspaceId) {
    return 'invite-workspace-context';
  }

  if (debugContext?.revisionWorkspaceId && activeWorkspaceId && debugContext.revisionWorkspaceId === activeWorkspaceId) {
    return 'active-workspace-context';
  }

  if (debugContext?.revisionSource === 'bootstrap') {
    return 'bootstrap-state';
  }

  return 'prior-api-state';
}

function normalizeOptionalWorkspaceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
