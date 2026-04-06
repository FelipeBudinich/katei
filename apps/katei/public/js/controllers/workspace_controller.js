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
  createCardLocaleReviewAction,
  createRuntimeCardDialogState,
  executeWorkspaceCardEditorPlan,
  executeWorkspaceServiceAction
} from './workspace_card_dialog.js';
import { createLocalizedCardViewState } from './card_editor_locale_view.js';
import {
  getBoardStageTitle,
  resolveBoardStageId,
  shouldShowCreateForStage,
  shouldShowPriorityForStage,
  shouldShowPromptRunForStage
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
    'announcer',
    'viewDialog',
    'viewLocaleSection',
    'viewLocaleButton',
    'viewLocaleMenu',
    'viewLocaleSelect',
    'viewReviewState',
    'viewRequestVerificationButton',
    'viewActionRegion',
    'viewDeleteButton',
    'viewEditButton',
    'viewPromptRunButton',
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
    this.browserWindow = typeof window !== 'undefined' ? window : globalThis;
    this.browserLocation = this.browserWindow?.location ?? null;
    this.browserHistory = this.browserWindow?.history ?? null;
    this.handlePopState = this.handlePopState.bind(this);
    this.nextWorkspaceHistoryAction = 'replace';
    this.hasSyncedWorkspaceHistory = false;

    if (!this.hasViewerSubValue || !this.viewerSubValue.trim()) {
      console.error('Workspace viewer sub is missing.');
      this.announce(this.t('workspace.status.loadUnavailable'));
      return;
    }

    this.service = new WorkspaceService(
      new HttpWorkspaceRepository({
        fetchImpl: this.browserWindow.fetch.bind(this.browserWindow),
        viewerSub: this.viewerSubValue,
        workspaceId: resolveWorkspaceIdFromLocation(this.browserLocation),
        storage: this.browserWindow.localStorage
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
    this.pendingLocalizationGenerationKeys = new Set();
    this.pendingStagePromptRunKeys = new Set();

    if (typeof this.browserWindow?.addEventListener === 'function') {
      this.browserWindow.addEventListener('popstate', this.handlePopState);
    }

    this.loadWorkspace();
  }

  disconnect() {
    if (typeof this.browserWindow?.removeEventListener === 'function') {
      this.browserWindow.removeEventListener('popstate', this.handlePopState);
    }
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
    this.dispatchWorkspaceEvent('open-board-editor', {
      mode: 'create',
      canDeleteBoard: false
    });
  }

  openEditBoard() {
    if (!this.activeBoard || !this.canAdminActiveBoard) {
      if (this.activeBoard) {
        this.announce(this.t('errors.boardAdminPermissionDenied'));
      }
      return;
    }

    this.dispatchWorkspaceEvent('open-board-editor', {
      mode: 'edit',
      board: this.activeBoard,
      canDeleteBoard: Array.isArray(this.workspace?.boardOrder) && this.workspace.boardOrder.length > 1
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
    const detail = event?.detail ?? {};
    const boardId = normalizeOptionalWorkspaceId(detail.boardId);
    const targetWorkspaceId = normalizeOptionalWorkspaceId(detail.workspaceId)
      ?? normalizeOptionalWorkspaceId(this.workspace?.workspaceId);
    const currentWorkspaceId = normalizeOptionalWorkspaceId(this.service?.getActiveWorkspaceId?.() ?? this.workspace?.workspaceId);
    const boardTitle = normalizeOptionalString(detail.boardTitle)
      || this.workspace?.boards?.[boardId]?.title
      || this.t('workspace.fallbackBoardTitle');

    if (!boardId) {
      return;
    }

    if (targetWorkspaceId === currentWorkspaceId) {
      if (boardId === this.workspace?.ui?.activeBoardId) {
        return;
      }

      await this.runAction(
        () => this.service.setActiveBoard(boardId),
        this.t('workspace.announcements.switchedBoard', { title: boardTitle })
      );
      return;
    }

    const previousHistoryAction = this.nextWorkspaceHistoryAction;
    let switchedWorkspace = null;

    try {
      switchedWorkspace = await this.service.switchWorkspace(detail.isHomeWorkspace === true ? null : targetWorkspaceId);
      let nextWorkspace = switchedWorkspace;

      if (
        switchedWorkspace?.boards?.[boardId]
        && normalizeOptionalWorkspaceId(switchedWorkspace?.ui?.activeBoardId) !== boardId
      ) {
        nextWorkspace = await this.service.setActiveBoard(boardId);
      }

      this.workspace = nextWorkspace;
      this.queueWorkspaceHistoryAction('push');
      this.render();
      this.announce(this.t('workspace.announcements.switchedBoard', { title: boardTitle }));
    } catch (error) {
      if (switchedWorkspace) {
        this.workspace = switchedWorkspace;
        this.queueWorkspaceHistoryAction('push');
        this.render();
      } else {
        this.nextWorkspaceHistoryAction = previousHistoryAction ?? null;
      }

      console.error(error);
      this.announce(localizeErrorMessage(error, this.t));
    }
  }

  async handleBoardEditorSave(event) {
    const { mode, boardId, input } = event.detail;

    if (mode === 'edit') {
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
    const boardId = event.detail?.boardId ?? event.currentTarget?.dataset.boardId ?? this.activeBoard?.id;
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
      triggerElement: event.currentTarget ?? event.target,
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

    const stageId = resolveBoardStageId(this.activeBoard, {
      stageId: event?.currentTarget?.dataset?.stageId,
      columnId: event?.currentTarget?.dataset?.columnId
    });

    if (!stageId || !shouldShowCreateForStage(this.activeBoard, stageId)) {
      this.announce(this.t('errors.cardCreateStageUnavailable'));
      return;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'create',
      boardId: this.activeBoard.id,
      board: this.activeBoard,
      currentActorRole: this.activeBoardCollaborationState?.currentRole ?? null,
      canEditLocalizedContent: this.canEditActiveBoard,
      stageId,
      triggerElement: event?.currentTarget ?? null
    });
  }

  openEdit(event) {
    const button = event.currentTarget;
    const board = this.activeBoard;
    const cardId = button.dataset.cardId;
    const card = board?.cards?.[cardId] ?? null;
    const stageId = board
      ? resolveBoardStageId(board, {
          stageId: button.dataset.stageId,
          columnId: button.dataset.columnId,
          cardId
        })
      : null;

    this.openEditForCard({
      board,
      stageId,
      card,
      requestedLocale: button.dataset.requestedLocale ?? button.dataset.locale ?? null,
      triggerElement: button
    });
  }

  openEditFromView(event) {
    event.preventDefault();

    const board = this.viewDialogState?.board ?? null;
    const card = this.viewDialogState?.card ?? null;
    const stageId = this.viewDialogState?.stageId ?? null;
    const requestedLocale = this.viewDialogState?.selectedLocale ?? null;
    const triggerElement = this.viewTriggerElement ?? null;
    const boardState = board ? getBoardCollaborationState(board, this.viewerActor) : null;

    if (!board || !card || !stageId || !boardState?.canEdit) {
      return;
    }

    this.dismissViewDialog({ restoreFocus: false });

    this.openEditForCard({
      board,
      card,
      stageId,
      requestedLocale,
      triggerElement
    });
  }

  openEditForCard({
    board,
    card,
    stageId,
    requestedLocale = null,
    triggerElement = null
  } = {}) {
    const boardState = board ? getBoardCollaborationState(board, this.viewerActor) : null;

    if (!board || !boardState?.canEdit) {
      if (board) {
        this.announce(this.t('errors.boardEditPermissionDenied'));
      }
      return false;
    }

    const resolvedStageId = resolveBoardStageId(board, {
      stageId,
      cardId: card?.id
    });

    if (!card || !resolvedStageId) {
      return false;
    }

    this.dispatchWorkspaceEvent('open-card-editor', {
      mode: 'edit',
      boardId: board.id,
      board,
      ...createRuntimeCardDialogState(card, board, {
        requestedLocale,
        uiLocale: this.t.locale,
        currentActorRole: boardState?.currentRole ?? null,
        canEditLocalizedContent: boardState?.canEdit ?? false
      }),
      stageId: resolvedStageId,
      triggerElement
    });

    return true;
  }

  openView(event) {
    this.openViewForCardTrigger(event?.currentTarget ?? null);
  }

  openViewFromToolbar(event) {
    const triggerElement = event?.currentTarget ?? null;

    if (!triggerElement || this.isEventFromInteractiveDescendant(event, triggerElement)) {
      return;
    }

    this.openViewForCardTrigger(triggerElement);
  }

  openViewFromToolbarKeydown(event) {
    const triggerElement = event?.currentTarget ?? null;

    if (!triggerElement || this.isEventFromInteractiveDescendant(event, triggerElement)) {
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
      return;
    }

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
    }

    this.openViewForCardTrigger(triggerElement);
  }

  openViewForCardTrigger(triggerElement) {
    const board = this.activeBoard;

    if (!board || !triggerElement) {
      return false;
    }

    const cardId = triggerElement.dataset.cardId;
    const stageId = resolveBoardStageId(board, {
      stageId: triggerElement.dataset.stageId,
      columnId: triggerElement.dataset.columnId,
      cardId
    });
    const card = board.cards[cardId];

    if (!card || !stageId) {
      return false;
    }

    const boardState = getBoardCollaborationState(board, this.viewerActor);

    this.viewTriggerElement = triggerElement;
    this.viewDialogState = {
      board,
      card,
      stageId,
      selectedLocale: triggerElement.dataset.requestedLocale ?? triggerElement.dataset.locale ?? null,
      canRequestHumanVerification: boardState?.canRead ?? false,
      canEditBoard: boardState?.canEdit ?? false
    };
    this.syncViewDialog();

    if (!this.viewDialogTarget.open) {
      this.viewDialogTarget.showModal();
    }

    scheduleBrowserFrame(() => {
      if (
        this.hasViewLocaleSectionTarget &&
        this.hasViewLocaleButtonTarget &&
        !this.viewLocaleSectionTarget.hidden &&
        this.viewLocaleButtonTarget.hidden !== true &&
        this.viewLocaleButtonTarget.disabled !== true
      ) {
        this.viewLocaleButtonTarget.focus();
        return;
      }

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

    return true;
  }

  isEventFromInteractiveDescendant(event, container) {
    const target = event?.target ?? null;

    if (!container || !target || target === container || typeof target.closest !== 'function') {
      return false;
    }

    const interactiveAncestor = target.closest(
      'button, a, input, select, textarea, [role="button"], [role="link"], [data-prevent-card-toolbar-open]'
    );

    return Boolean(
      interactiveAncestor &&
      interactiveAncestor !== container &&
      typeof container.contains === 'function' &&
      container.contains(interactiveAncestor)
    );
  }

  changeViewLocale(event) {
    event.preventDefault();

    if (!this.viewDialogState) {
      return;
    }

    const nextLocale = normalizeOptionalLocale(
      event?.currentTarget?.dataset?.locale
      ?? event?.currentTarget?.value
      ?? null
    );

    this.viewDialogState = {
      ...this.viewDialogState,
      selectedLocale: nextLocale
    };

    if (this.hasViewLocaleSelectTarget) {
      this.viewLocaleSelectTarget.value = nextLocale ?? '';
    }

    this.syncViewDialog();

    if (event?.currentTarget?.dataset?.locale) {
      this.closeViewLocaleMenu({ restoreFocus: true });
    }
  }

  toggleViewLocaleMenu(event) {
    event.preventDefault();

    if (this.isViewLocaleMenuOpen()) {
      this.closeViewLocaleMenu();
      return;
    }

    this.openViewLocaleMenu();
  }

  openViewLocaleMenu() {
    if (
      !this.hasViewLocaleButtonTarget ||
      !this.hasViewLocaleMenuTarget ||
      this.viewLocaleButtonTarget.disabled === true
    ) {
      return;
    }

    if (this.getViewLocaleMenuOptions().length < 1) {
      return;
    }

    this.viewLocaleMenuTarget.hidden = false;
    this.viewLocaleButtonTarget.setAttribute('aria-expanded', 'true');
  }

  closeViewLocaleMenu({ restoreFocus = false } = {}) {
    if (this.hasViewLocaleMenuTarget) {
      this.viewLocaleMenuTarget.hidden = true;
    }

    if (this.hasViewLocaleButtonTarget) {
      this.viewLocaleButtonTarget.setAttribute('aria-expanded', 'false');

      if (restoreFocus) {
        this.viewLocaleButtonTarget.focus?.();
      }
    }
  }

  handleViewLocaleTriggerKeydown(event) {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      this.openViewLocaleMenu();
      this.focusSelectedViewLocaleMenuOption();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.openViewLocaleMenu();
      this.focusSelectedViewLocaleMenuOption();
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.openViewLocaleMenu();
      this.focusSelectedViewLocaleMenuOption();
    }
  }

  handleViewLocaleMenuKeydown(event) {
    const options = this.getViewLocaleMenuOptions();

    if (options.length < 1) {
      return;
    }

    const activeIndex = options.findIndex((option) => option === event.target);

    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeViewLocaleMenu({ restoreFocus: true });
      return;
    }

    if (event.key === 'Tab') {
      this.closeViewLocaleMenu();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.focusViewLocaleMenuOption(activeIndex >= 0 ? activeIndex + 1 : 0);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.focusViewLocaleMenuOption(activeIndex >= 0 ? activeIndex - 1 : options.length - 1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.focusViewLocaleMenuOption(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.focusViewLocaleMenuOption(options.length - 1);
    }
  }

  handleViewDialogClick(event) {
    if (!this.isViewLocaleMenuOpen()) {
      return;
    }

    const target = event?.target ?? null;
    const clickedMenu = this.hasViewLocaleMenuTarget && this.viewLocaleMenuTarget.contains?.(target);
    const clickedTrigger = this.hasViewLocaleButtonTarget && this.viewLocaleButtonTarget.contains?.(target);

    if (clickedMenu || clickedTrigger) {
      return;
    }

    this.closeViewLocaleMenu();
  }

  isViewLocaleMenuOpen() {
    return this.hasViewLocaleMenuTarget && this.viewLocaleMenuTarget.hidden !== true;
  }

  getViewLocaleMenuOptions() {
    if (!this.hasViewLocaleMenuTarget) {
      return [];
    }

    if (typeof this.viewLocaleMenuTarget.querySelectorAll === 'function') {
      return Array.from(this.viewLocaleMenuTarget.querySelectorAll('.view-locale-menu-option'));
    }

    if (Array.isArray(this.viewLocaleMenuTarget.children)) {
      return this.viewLocaleMenuTarget.children;
    }

    return [];
  }

  focusViewLocaleMenuOption(index) {
    const options = this.getViewLocaleMenuOptions();

    if (options.length < 1) {
      return;
    }

    const boundedIndex = ((index % options.length) + options.length) % options.length;
    options[boundedIndex]?.focus?.();
  }

  focusSelectedViewLocaleMenuOption() {
    const options = this.getViewLocaleMenuOptions();
    const selectedIndex = options.findIndex((option) => option?.attributes?.['aria-checked'] === 'true');
    this.focusViewLocaleMenuOption(selectedIndex >= 0 ? selectedIndex : 0);
  }

  async requestViewLocaleReview(event) {
    event.preventDefault();

    const boardId = this.viewDialogState?.board?.id ?? null;
    const cardId = this.viewDialogState?.card?.id ?? null;
    const locale = this.viewDialogState?.selectedLocale ?? null;

    if (!boardId || !cardId || !locale) {
      return;
    }

    const success = await this.runAction(
      () => executeWorkspaceServiceAction(this.service, createCardLocaleReviewAction({ boardId, cardId, locale })),
      this.t('workspace.announcements.humanVerificationRequested')
    );

    if (success && this.isViewDialogOpenFor({ boardId, cardId })) {
      this.refreshViewDialog({ boardId, cardId, locale });
    }
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

    await this.runAction(
      () => this.service.createCard(boardId, { ...input, stageId: targetStageId }),
      this.t('workspace.announcements.cardCreated')
    );
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

  handleDiscardCardLocale(event) {
    const boardId = normalizeOptionalWorkspaceId(event.detail?.boardId);
    const cardId = normalizeOptionalWorkspaceId(event.detail?.cardId);
    const locale = normalizeOptionalWorkspaceId(event.detail?.locale);
    const board = boardId ? this.workspace?.boards?.[boardId] : null;
    const card = board?.cards?.[cardId] ?? null;

    if (!board || !card || !locale) {
      return;
    }

    this.openConfirmDialog({
      triggerElement: event.detail?.triggerElement ?? null,
      confirmation: {
        type: 'discard-card-locale',
        boardId,
        cardId,
        locale,
        title: this.t('workspace.confirmations.discardLocaleTitle'),
        message: this.t('workspace.confirmations.discardLocaleMessage', {
          locale,
          title: getBoardCardContentVariant(card, board, {
            requestedLocale: locale,
            uiLocale: this.t.locale
          })?.title ?? ''
        }),
        confirmLabel: this.t('workspace.confirmations.discardLocaleConfirm')
      }
    });
  }

  async handleGenerateCardLocalization(event) {
    const boardId = normalizeOptionalWorkspaceId(event.detail?.boardId);
    const cardId = normalizeOptionalWorkspaceId(event.detail?.cardId);
    const locale = normalizeOptionalWorkspaceId(event.detail?.locale);
    const requestKey = createLocalizationGenerationRequestKey({ boardId, cardId, locale });

    if (!requestKey) {
      return;
    }

    if (!(this.pendingLocalizationGenerationKeys instanceof Set)) {
      this.pendingLocalizationGenerationKeys = new Set();
    }

    if (this.pendingLocalizationGenerationKeys.has(requestKey)) {
      return;
    }

    this.pendingLocalizationGenerationKeys.add(requestKey);
    let success = false;

    try {
      success = await this.runAction(
        () => this.service.generateCardLocalization(boardId, cardId, locale),
        this.t('workspace.announcements.localizationGenerated')
      );

      if (success && this.isCardEditorOpenFor({ boardId, cardId })) {
        this.refreshCardEditor({
          boardId,
          cardId,
          locale,
          mode: 'edit'
        });
      }
    } finally {
      this.pendingLocalizationGenerationKeys.delete(requestKey);

      this.dispatchWorkspaceEvent('card-localization-generation-finished', {
        boardId,
        cardId,
        locale,
        success
      });
    }
  }

  async handleRunStagePrompt(event) {
    const boardId =
      normalizeOptionalWorkspaceId(event?.detail?.boardId)
      ?? normalizeOptionalWorkspaceId(event?.currentTarget?.dataset?.boardId)
      ?? this.activeBoard?.id
      ?? null;
    const cardId =
      normalizeOptionalWorkspaceId(event?.detail?.cardId)
      ?? normalizeOptionalWorkspaceId(event?.currentTarget?.dataset?.cardId);
    return this.runStagePromptForCard({ boardId, cardId });
  }

  async handleRunStagePromptFromView(event) {
    event.preventDefault();

    const board = this.viewDialogState?.board ?? null;
    const card = this.viewDialogState?.card ?? null;
    const boardId = normalizeOptionalWorkspaceId(board?.id);
    const cardId = normalizeOptionalWorkspaceId(card?.id);
    const stageId = board
      ? resolveBoardStageId(board, {
          stageId: this.viewDialogState?.stageId,
          cardId
        })
      : null;
    const selectedLocale = this.viewDialogState?.selectedLocale ?? null;
    const canEditBoard = this.viewDialogState?.canEditBoard === true;

    if (!boardId || !cardId || !stageId || !canEditBoard || !shouldShowPromptRunForStage(board, stageId)) {
      return false;
    }

    const success = await this.runStagePromptForCard({ boardId, cardId });

    if (success && this.isViewDialogOpenFor({ boardId, cardId })) {
      this.refreshViewDialog({ boardId, cardId, locale: selectedLocale });
    }

    return success;
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
          title: getBoardCardContentVariant(card, board, { uiLocale: this.t.locale })?.title ?? ''
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
        cachedRevisionBeforeDecision: debugContext.cachedRevision ?? null,
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
      if (normalizeOptionalWorkspaceId(this.service?.getActiveWorkspaceId?.() ?? result.workspace?.workspaceId) !== normalizeOptionalWorkspaceId(activeWorkspaceId)) {
        this.queueWorkspaceHistoryAction('push');
      }
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
      this.syncWorkspaceHistory();
      return;
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
    this.syncWorkspaceHistory();
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

    this.dismissViewDialog({ restoreFocus: true });
  }

  dismissViewDialog({ restoreFocus = true } = {}) {
    this.closeViewLocaleMenu({ restoreFocus: false });

    if (this.viewDialogTarget.open) {
      this.viewDialogTarget.close();
    }

    if (restoreFocus && this.viewTriggerElement?.isConnected) {
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
    const {
      board,
      card,
      stageId,
      selectedLocale,
      canRequestHumanVerification = false,
      canEditBoard = false
    } = this.viewDialogState ?? {};
    const localizedView = createLocalizedCardViewState({
      board,
      card,
      selectedLocale,
      uiLocale: this.t.locale,
      localeSelection: 'available'
    });
    const resolvedStageId = board && card
      ? resolveBoardStageId(board, {
          stageId,
          cardId: card.id
        })
      : null;
    const shouldShowPriority = shouldShowPriorityForStage(resolvedStageId);
    const content = localizedView.variant;
    const localeOptions = localizedView.availableLocales.map((locale) => createLocaleOption(locale));
    const localeMenuOptions = localizedView.availableLocales.map((locale) =>
      createLocaleMenuOption(locale, localizedView.selectedLocale)
    );
    const promptRunRequestKey = createStagePromptRunRequestKey({
      boardId: board?.id,
      cardId: card?.id
    });
    const shouldShowPromptRunButton = Boolean(
      canEditBoard
      && board
      && card
      && resolvedStageId
      && shouldShowPromptRunForStage(board, resolvedStageId)
    );
    const shouldShowDeleteButton = Boolean(
      canEditBoard
      && board
      && card
    );
    const shouldShowEditButton = Boolean(
      canEditBoard
      && board
      && card
      && resolvedStageId
    );
    const isPromptRunPending = Boolean(
      shouldShowPromptRunButton
      && promptRunRequestKey
      && this.pendingStagePromptRunKeys instanceof Set
      && this.pendingStagePromptRunKeys.has(promptRunRequestKey)
    );

    if (this.hasViewLocaleSectionTarget && this.hasViewLocaleSelectTarget) {
      const shouldShowLocaleSection = localeOptions.length > 0;
      this.viewLocaleSectionTarget.hidden = !shouldShowLocaleSection;
      this.viewLocaleSelectTarget.replaceChildren(...localeOptions);
      this.viewLocaleSelectTarget.value = localizedView.selectedLocale ?? '';
      this.viewLocaleSelectTarget.disabled = !shouldShowLocaleSection;
      this.viewLocaleSelectTarget.setAttribute('aria-disabled', String(!shouldShowLocaleSection));

      if (this.hasViewLocaleButtonTarget) {
        this.viewLocaleButtonTarget.hidden = !shouldShowLocaleSection;
        this.viewLocaleButtonTarget.disabled = !shouldShowLocaleSection;
        this.viewLocaleButtonTarget.setAttribute('aria-disabled', String(!shouldShowLocaleSection));
        this.viewLocaleButtonTarget.setAttribute('aria-expanded', 'false');
      }

      if (this.hasViewLocaleMenuTarget) {
        this.viewLocaleMenuTarget.hidden = true;
        this.viewLocaleMenuTarget.replaceChildren(...localeMenuOptions);
      }
    }

    if (this.hasViewReviewStateTarget) {
      this.viewReviewStateTarget.hidden = localizedView.reviewState.status == null;
      this.viewReviewStateTarget.textContent = localizedView.reviewState.status == null
        ? ''
        : this.t(`cardViewDialog.reviewState.${localizedView.reviewState.status}`);
    }

    if (this.hasViewRequestVerificationButtonTarget) {
      const shouldShowRequestVerificationButton =
        canRequestHumanVerification &&
        localizedView.reviewState.status === 'ai';

      this.viewRequestVerificationButtonTarget.hidden = !shouldShowRequestVerificationButton;
      this.viewRequestVerificationButtonTarget.disabled = !shouldShowRequestVerificationButton;
      this.viewRequestVerificationButtonTarget.setAttribute(
        'aria-disabled',
        String(!shouldShowRequestVerificationButton)
      );
    }

    if (this.hasViewActionRegionTarget) {
      this.viewActionRegionTarget.hidden = true;
    }

    if (this.hasViewDeleteButtonTarget) {
      this.viewDeleteButtonTarget.hidden = !shouldShowDeleteButton;
      this.viewDeleteButtonTarget.disabled = !shouldShowDeleteButton;
      this.viewDeleteButtonTarget.setAttribute(
        'aria-disabled',
        String(!shouldShowDeleteButton)
      );

      setOptionalDatasetValue(
        this.viewDeleteButtonTarget,
        'boardId',
        shouldShowDeleteButton ? board.id : null
      );
      setOptionalDatasetValue(
        this.viewDeleteButtonTarget,
        'cardId',
        shouldShowDeleteButton ? card.id : null
      );
    }

    if (this.hasViewEditButtonTarget) {
      this.viewEditButtonTarget.hidden = !shouldShowEditButton;
      this.viewEditButtonTarget.disabled = !shouldShowEditButton;
      this.viewEditButtonTarget.setAttribute(
        'aria-disabled',
        String(!shouldShowEditButton)
      );

      setOptionalDatasetValue(
        this.viewEditButtonTarget,
        'boardId',
        shouldShowEditButton ? board.id : null
      );
      setOptionalDatasetValue(
        this.viewEditButtonTarget,
        'cardId',
        shouldShowEditButton ? card.id : null
      );
      setOptionalDatasetValue(
        this.viewEditButtonTarget,
        'stageId',
        shouldShowEditButton ? resolvedStageId : null
      );
    }

    if (this.hasViewPromptRunButtonTarget) {
      this.viewPromptRunButtonTarget.hidden = !shouldShowPromptRunButton;
      this.viewPromptRunButtonTarget.disabled = !shouldShowPromptRunButton || isPromptRunPending;
      this.viewPromptRunButtonTarget.setAttribute(
        'aria-disabled',
        String(!shouldShowPromptRunButton || isPromptRunPending)
      );

      setOptionalDatasetValue(
        this.viewPromptRunButtonTarget,
        'boardId',
        shouldShowPromptRunButton ? board.id : null
      );
      setOptionalDatasetValue(
        this.viewPromptRunButtonTarget,
        'cardId',
        shouldShowPromptRunButton ? card.id : null
      );
      setOptionalDatasetValue(
        this.viewPromptRunButtonTarget,
        'stageId',
        shouldShowPromptRunButton ? resolvedStageId : null
      );
    }

    this.viewDialogState = card
      ? {
          board,
          card,
          stageId: resolvedStageId,
          selectedLocale: localizedView.selectedLocale,
          canRequestHumanVerification,
          canEditBoard
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
    const shouldCloseViewDialogAfterDelete = (
      confirmation.type === 'delete-card' &&
      this.isViewDialogOpenFor({
        boardId: confirmation.boardId,
        cardId: confirmation.cardId
      })
    );
    this.isConfirming = true;
    this.confirmButtonTarget.disabled = true;

    let success = false;

    if (confirmation.type === 'delete-card') {
      success = await this.runAction(
        () => this.service.deleteCard(confirmation.boardId, confirmation.cardId),
        this.t('workspace.announcements.cardDeleted')
      );
    } else if (confirmation.type === 'discard-card-locale') {
      success = await this.runAction(
        () => this.service.discardCardLocale(confirmation.boardId, confirmation.cardId, confirmation.locale),
        this.t('workspace.announcements.localeDiscarded')
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
      if (shouldCloseViewDialogAfterDelete) {
        this.dismissViewDialog({ restoreFocus: false });
      }

      if (confirmation.type === 'discard-card-locale' && this.isCardEditorOpenFor(confirmation)) {
        this.refreshCardEditor({
          boardId: confirmation.boardId,
          cardId: confirmation.cardId,
          locale: confirmation.locale,
          mode: 'edit'
        });
      }

      this.closeConfirmDialog();
    }
  }

  dispatchWorkspaceEvent(name, detail) {
    window.dispatchEvent(new CustomEvent(`workspace:${name}`, { detail }));
  }

  async handlePopState() {
    const previousHistoryAction = this.nextWorkspaceHistoryAction;

    this.service.setActiveWorkspace(resolveWorkspaceIdFromLocation(this.browserLocation));
    this.queueWorkspaceHistoryAction('skip');
    const success = await this.runAction(() => this.service.load());

    if (!success) {
      this.nextWorkspaceHistoryAction = previousHistoryAction ?? null;
    }
  }

  createBoardOptionsEventDetail({ triggerElement = null } = {}) {
    const detail = {
      workspace: this.workspace,
      viewerActor: this.viewerActor,
      triggerElement,
      activeWorkspaceId: this.service?.getActiveWorkspaceId?.() ?? null,
      activeWorkspaceIsHome: this.service?.getIsHomeWorkspace?.() ?? false,
      pendingWorkspaceInvites: this.service?.getPendingWorkspaceInvites?.() ?? [],
      accessibleWorkspaces: this.service?.getAccessibleWorkspaces?.() ?? []
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

  queueWorkspaceHistoryAction(action) {
    this.nextWorkspaceHistoryAction = action;
  }

  syncWorkspaceHistory() {
    const requestedAction = this.nextWorkspaceHistoryAction ?? (this.hasSyncedWorkspaceHistory ? null : 'replace');

    this.nextWorkspaceHistoryAction = null;

    if (!requestedAction) {
      return;
    }

    this.hasSyncedWorkspaceHistory = true;

    if (
      requestedAction === 'skip'
      || !this.browserHistory
      || typeof this.browserHistory.replaceState !== 'function'
    ) {
      return;
    }

    const href = buildWorkspaceBoardsHref(this.browserLocation, {
      workspaceId: this.service?.getActiveWorkspaceId?.() ?? this.workspace?.workspaceId ?? null,
      isHomeWorkspace: this.service?.getIsHomeWorkspace?.() ?? false
    });
    const state = {
      workspaceId: this.service?.getActiveWorkspaceId?.() ?? null
    };

    if (requestedAction === 'push' && typeof this.browserHistory.pushState === 'function') {
      this.browserHistory.pushState(state, '', href);
      return;
    }

    this.browserHistory.replaceState(state, '', href);
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

    const toggleElements = panelElement.querySelectorAll('[data-column-toggle]');
    for (const toggleElement of toggleElements) {
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
        uiLocale: this.t.locale,
        currentActorRole: boardState?.currentRole ?? null,
        canEditLocalizedContent: boardState?.canEdit ?? false
      }),
      stageId
    });
  }

  refreshViewDialog({ boardId, cardId, locale = null } = {}) {
    const board = boardId ? this.workspace?.boards?.[boardId] : null;
    const card = board?.cards?.[cardId] ?? null;

    if (!board || !card) {
      return;
    }

    const boardState = getBoardCollaborationState(board, this.viewerActor);
    const stageId = resolveBoardStageId(board, { cardId });

    this.viewDialogState = {
      board,
      card,
      stageId,
      selectedLocale: locale,
      canRequestHumanVerification: boardState?.canRead ?? false,
      canEditBoard: boardState?.canEdit ?? false
    };
    this.syncViewDialog();
  }

  isCardEditorOpenFor({ boardId, cardId } = {}) {
    const cardEditorDialog = this.element?.querySelector?.('[data-controller="card-editor"]');

    if (!cardEditorDialog?.open) {
      return false;
    }

    const currentBoardIdInput = cardEditorDialog.querySelector?.('[data-card-editor-target="boardIdInput"]');
    const currentCardIdInput = cardEditorDialog.querySelector?.('[data-card-editor-target="cardIdInput"]');

    return currentBoardIdInput?.value === boardId && currentCardIdInput?.value === cardId;
  }

  isViewDialogOpenFor({ boardId, cardId } = {}) {
    return Boolean(
      this.viewDialogTarget?.open &&
      this.viewDialogState?.board?.id === boardId &&
      this.viewDialogState?.card?.id === cardId
    );
  }

  async runStagePromptForCard({ boardId, cardId } = {}) {
    const requestKey = createStagePromptRunRequestKey({ boardId, cardId });

    if (!requestKey) {
      return false;
    }

    if (!(this.pendingStagePromptRunKeys instanceof Set)) {
      this.pendingStagePromptRunKeys = new Set();
    }

    if (this.pendingStagePromptRunKeys.has(requestKey)) {
      return false;
    }

    this.pendingStagePromptRunKeys.add(requestKey);

    if (this.isViewDialogOpenFor({ boardId, cardId })) {
      this.syncViewDialog();
    }

    try {
      return await this.runAction(
        () => this.service.runStagePrompt(boardId, cardId),
        this.t('workspace.announcements.stagePromptRunSucceeded')
      );
    } finally {
      this.pendingStagePromptRunKeys.delete(requestKey);

      if (this.isViewDialogOpenFor({ boardId, cardId })) {
        this.syncViewDialog();
      }
    }
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

function createLocaleMenuOption(locale, selectedLocale) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'view-locale-menu-option';
  button.value = locale;
  button.dataset.locale = locale;
  button.textContent = locale;
  button.tabIndex = -1;
  button.setAttribute('role', 'menuitemradio');
  button.setAttribute('aria-checked', String(locale === selectedLocale));
  button.setAttribute('data-action', 'workspace#changeViewLocale');
  return button;
}

function normalizeOptionalLocale(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createLocalizationGenerationRequestKey({ boardId, cardId, locale } = {}) {
  const normalizedBoardId = normalizeOptionalWorkspaceId(boardId);
  const normalizedCardId = normalizeOptionalWorkspaceId(cardId);
  const normalizedLocale = normalizeOptionalWorkspaceId(locale);

  if (!normalizedBoardId || !normalizedCardId || !normalizedLocale) {
    return null;
  }

  return `${normalizedBoardId}::${normalizedCardId}::${normalizedLocale}`;
}

function createStagePromptRunRequestKey({ boardId, cardId } = {}) {
  const normalizedBoardId = normalizeOptionalWorkspaceId(boardId);
  const normalizedCardId = normalizeOptionalWorkspaceId(cardId);

  if (!normalizedBoardId || !normalizedCardId) {
    return null;
  }

  return `${normalizedBoardId}::${normalizedCardId}`;
}

function setOptionalDatasetValue(element, name, value) {
  if (!element?.dataset) {
    return;
  }

  if (typeof value === 'string' && value.trim()) {
    element.dataset[name] = value;
    return;
  }

  delete element.dataset[name];
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

function resolveWorkspaceIdFromLocation(location) {
  const url = parseLocationUrl(location);
  return normalizeOptionalWorkspaceId(url?.searchParams.get('workspaceId'));
}

function buildWorkspaceBoardsHref(location, { workspaceId = null, isHomeWorkspace = false } = {}) {
  const url = parseLocationUrl(location);
  const normalizedWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);

  if (!url) {
    return normalizedWorkspaceId && !isHomeWorkspace
      ? `/boards?workspaceId=${encodeURIComponent(normalizedWorkspaceId)}`
      : '/boards';
  }

  if (!normalizedWorkspaceId || isHomeWorkspace) {
    url.searchParams.delete('workspaceId');
  } else {
    url.searchParams.set('workspaceId', normalizedWorkspaceId);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function parseLocationUrl(location) {
  const href = typeof location?.href === 'string' && location.href.trim()
    ? location.href
    : `http://localhost${location?.pathname ?? '/boards'}${location?.search ?? ''}${location?.hash ?? ''}`;

  try {
    return new URL(href, 'http://localhost');
  } catch (error) {
    return null;
  }
}

function normalizeOptionalWorkspaceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
