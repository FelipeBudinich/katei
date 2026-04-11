import { Controller } from '../../vendor/stimulus/stimulus.js';
import { canonicalizeBoardRole } from '../domain/board_collaboration.js';
import { getBoardMembershipForActor } from '../domain/board_permissions.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { HttpWorkspaceRepository } from '../repositories/http_workspace_repository.js';
import { WorkspaceService } from '../services/workspace_service.js';
import { createWorkspaceViewerActor, getBoardRoleTranslationKey } from './board_collaboration_state.js';
import { openDialogWithInitialFocus } from './dialog_initial_focus.js';
import { closeSheetDialog } from './sheet_dialog.js';

export default class extends Controller {
  static values = {
    viewerSub: String,
    viewerSuperAdmin: Boolean
  };

  static targets = [
    'dialog',
    'heading',
    'titleInput',
    'help',
    'error',
    'saveButton',
    'cancelButton',
    'closeButton',
    'announcer'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.browserWindow = typeof window !== 'undefined' ? window : globalThis;
    this.service = this.buildWorkspaceService();
    this.restoreFocusElement = null;
    this.dialogMode = 'rename';
    this.currentWorkspaceId = null;
    this.currentWorkspaceFallbackLabel = null;
    this.isSubmitting = false;
    this.setDialogMode('rename');
    this.resetDialogState();
    this.syncBoardSelfRoleForms();
  }

  openCreateDialog(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.canManageWorkspaceTitles() || !this.hasDialogTarget || !this.hasTitleInputTarget) {
      return;
    }

    this.restoreFocusElement = event?.currentTarget ?? null;
    this.currentWorkspaceId = null;
    this.currentWorkspaceFallbackLabel = null;
    this.setDialogMode('create');
    this.resetDialogState();

    openDialogWithInitialFocus(this.dialogTarget, this.titleInputTarget);
  }

  openRenameDialog(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.canManageWorkspaceTitles() || !this.hasDialogTarget || !this.hasTitleInputTarget) {
      return;
    }

    const triggerElement = event?.currentTarget ?? null;
    const workspaceId = normalizeOptionalString(triggerElement?.dataset?.workspaceId);

    if (!workspaceId) {
      return;
    }

    const workspaceTitle = normalizeOptionalString(triggerElement?.dataset?.workspaceTitle);

    this.restoreFocusElement = triggerElement;
    this.currentWorkspaceId = workspaceId;
    this.currentWorkspaceFallbackLabel =
      normalizeOptionalString(triggerElement?.dataset?.workspaceFallbackLabel) || workspaceId;
    this.setDialogMode('rename');
    this.resetDialogState();
    if (this.hasHeadingTarget) {
      this.headingTarget.textContent = this.t(
        workspaceTitle
          ? 'portfolio.workspaceTitleEditor.editHeading'
          : 'portfolio.workspaceTitleEditor.assignHeading'
      );
    }
    this.titleInputTarget.value = workspaceTitle;

    openDialogWithInitialFocus(this.dialogTarget, this.titleInputTarget);
  }

  openProfileOptions(event) {
    const browserWindow = this.browserWindow ?? globalThis.window;

    if (typeof browserWindow?.dispatchEvent !== 'function') {
      return;
    }

    browserWindow.dispatchEvent(new CustomEvent('workspace:open-profile-options', {
      detail: {
        triggerElement: event?.currentTarget ?? null
      }
    }));
  }

  handleTitleInput() {
    this.hideError();
  }

  close(event) {
    if (event) {
      event.preventDefault();
    }

    if (this.isSubmitting) {
      return;
    }

    this.closeDialog();
  }

  async saveWorkspaceTitle(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.canManageWorkspaceTitles() || this.isSubmitting || !this.service) {
      return;
    }

    if (this.dialogMode !== 'create' && !this.currentWorkspaceId) {
      return;
    }

    this.hideError();
    this.setSubmittingState(true);

    try {
      const title = this.hasTitleInputTarget ? this.titleInputTarget.value : '';

      if (this.dialogMode === 'create') {
        await this.service.createWorkspace({ title });
        this.closeDialog({ restoreFocus: false });
        this.reloadPortfolioPage();
        return;
      }

      const result = await this.service.setWorkspaceTitle(this.currentWorkspaceId, title);
      this.applyWorkspaceTitleResult(result);
      this.closeDialog();
      this.announce(this.t('portfolio.workspaceTitleEditor.savedStatus'));
    } catch (error) {
      console.error(error);
      this.showError(localizeErrorMessage(error, this.t));
    } finally {
      this.setSubmittingState(false);
    }
  }

  handleBoardSelfRoleInput(event) {
    const form = this.resolveBoardRoleFormElement(event?.currentTarget ?? event?.target ?? null);

    if (!form) {
      return;
    }

    this.hideBoardRoleError(form);
    this.syncBoardSelfRoleForm(form);
  }

  openBoardFromPortfolio(event) {
    const link = event?.currentTarget ?? null;

    if (readElementBooleanAttribute(link, 'aria-disabled')) {
      event?.preventDefault?.();
    }
  }

  async saveBoardSelfRole(event) {
    if (event) {
      event.preventDefault();
    }

    if (!this.canManageWorkspaceTitles() || !this.service) {
      return;
    }

    const form = this.resolveBoardRoleFormElement(event?.currentTarget ?? null);

    if (!form || this.isBoardRoleSubmitting(form)) {
      return;
    }

    const workspaceId = normalizeOptionalString(form?.dataset?.workspaceId);
    const boardId = normalizeOptionalString(form?.dataset?.boardId);
    const select = this.getBoardRoleSelect(form);
    const requestedRole = canonicalizeBoardRole(select?.value);

    if (!workspaceId || !boardId || !select) {
      return;
    }

    if (!requestedRole) {
      this.showBoardRoleError(form, this.t('portfolio.boardSelfRole.requiredError'));
      this.syncBoardSelfRoleForm(form);
      return;
    }

    this.hideBoardRoleError(form);
    this.setBoardRoleSubmitting(form, true);

    try {
      const result = await this.service.setBoardSelfRole(boardId, requestedRole, { workspaceId });
      const effectiveRole = this.resolveEffectiveBoardRole(result, boardId) ?? requestedRole;
      const boardTitle = normalizeOptionalString(form?.dataset?.boardTitle) || boardId;

      this.applyBoardSelfRoleResult(form, effectiveRole);
      this.announce(this.t('portfolio.boardSelfRole.savedStatus', {
        board: boardTitle,
        role: this.getBoardRoleLabel(effectiveRole)
      }));
    } catch (error) {
      console.error(error);
      this.showBoardRoleError(form, localizeErrorMessage(error, this.t));
    } finally {
      this.setBoardRoleSubmitting(form, false);
    }
  }

  closeDialog({ restoreFocus = true } = {}) {
    const restoreFocusElement = this.restoreFocusElement;

    if (this.hasDialogTarget) {
      closeSheetDialog(this.dialogTarget);
    }

    this.restoreFocusElement = null;
    this.currentWorkspaceId = null;
    this.currentWorkspaceFallbackLabel = null;
    this.setDialogMode('rename');
    this.resetDialogState();

    if (restoreFocus && restoreFocusElement?.isConnected) {
      restoreFocusElement.focus();
    }
  }

  buildWorkspaceService() {
    if (!this.canManageWorkspaceTitles()) {
      return null;
    }

    const viewerSub = this.hasViewerSubValue ? normalizeOptionalString(this.viewerSubValue) : null;
    const fetchImpl =
      typeof this.browserWindow?.fetch === 'function'
        ? this.browserWindow.fetch.bind(this.browserWindow)
        : null;

    if (!viewerSub || !fetchImpl) {
      return null;
    }

    return new WorkspaceService(
      new HttpWorkspaceRepository({
        fetchImpl,
        viewerSub,
        document: this.browserWindow?.document
      })
    );
  }

  canManageWorkspaceTitles() {
    return this.hasViewerSuperAdminValue ? this.viewerSuperAdminValue === true : false;
  }

  resetDialogState() {
    this.hideError();

    if (this.hasHeadingTarget) {
      this.headingTarget.textContent = this.t(this.getDialogHeadingKey());
    }

    if (this.hasTitleInputTarget) {
      this.titleInputTarget.value = '';
      this.titleInputTarget.disabled = false;
      this.titleInputTarget.placeholder = this.t(this.dialogPlaceholderKey);
    }

    if (this.hasHelpTarget) {
      this.helpTarget.textContent = this.t(this.dialogHelpKey);
    }

    if (this.hasSaveButtonTarget) {
      this.saveButtonTarget.disabled = false;
      this.saveButtonTarget.textContent = this.t(this.dialogSubmitLabelKey);
    }

    if (this.hasCancelButtonTarget) {
      this.cancelButtonTarget.disabled = false;
    }

    if (this.hasCloseButtonTarget) {
      this.closeButtonTarget.disabled = false;
    }
  }

  setSubmittingState(isSubmitting) {
    this.isSubmitting = isSubmitting === true;

    if (this.hasTitleInputTarget) {
      this.titleInputTarget.disabled = this.isSubmitting;
    }

    if (this.hasSaveButtonTarget) {
      this.saveButtonTarget.disabled = this.isSubmitting;
      this.saveButtonTarget.textContent = this.t(
        this.isSubmitting ? this.dialogSubmittingLabelKey : this.dialogSubmitLabelKey
      );
    }

    if (this.hasCancelButtonTarget) {
      this.cancelButtonTarget.disabled = this.isSubmitting;
    }

    if (this.hasCloseButtonTarget) {
      this.closeButtonTarget.disabled = this.isSubmitting;
    }
  }

  showError(message) {
    if (!this.hasErrorTarget) {
      return;
    }

    this.errorTarget.hidden = false;
    this.errorTarget.textContent = message;
  }

  hideError() {
    if (!this.hasErrorTarget) {
      return;
    }

    this.errorTarget.hidden = true;
    this.errorTarget.textContent = '';
  }

  announce(message) {
    if (!this.hasAnnouncerTarget) {
      return;
    }

    this.announcerTarget.textContent = message;
  }

  applyWorkspaceTitleResult(result) {
    const workspaceId = normalizeOptionalString(result?.workspaceId) || this.currentWorkspaceId;

    if (!workspaceId) {
      return;
    }

    const workspaceTitle = normalizeOptionalString(result?.workspaceTitle);
    const fallbackLabel = this.currentWorkspaceFallbackLabel || workspaceId;
    const workspaceLabel = workspaceTitle || fallbackLabel;

    for (const element of this.getWorkspaceLabelElements(workspaceId)) {
      element.textContent = workspaceLabel;
      element.dataset.portfolioWorkspaceFallbackLabel = fallbackLabel;
    }

    for (const button of this.getWorkspaceRenameButtons(workspaceId)) {
      button.dataset.workspaceTitle = workspaceTitle;
      button.dataset.workspaceFallbackLabel = fallbackLabel;
      button.textContent = this.t(
        workspaceTitle
          ? 'portfolio.workspaceTitleEditor.editAction'
          : 'portfolio.workspaceTitleEditor.assignAction'
      );
    }
  }

  setDialogMode(mode) {
    this.dialogMode = mode === 'create' ? 'create' : 'rename';
    this.dialogPlaceholderKey =
      this.dialogMode === 'create'
        ? 'portfolio.workspaceTitleEditor.createPlaceholder'
        : 'portfolio.workspaceTitleEditor.placeholder';
    this.dialogHelpKey =
      this.dialogMode === 'create'
        ? 'portfolio.workspaceTitleEditor.createHelp'
        : 'portfolio.workspaceTitleEditor.help';
    this.dialogSubmitLabelKey =
      this.dialogMode === 'create'
        ? 'portfolio.workspaceTitleEditor.createAction'
        : 'common.save';
    this.dialogSubmittingLabelKey =
      this.dialogMode === 'create'
        ? 'portfolio.workspaceTitleEditor.creatingAction'
        : 'portfolio.workspaceTitleEditor.savingAction';
  }

  getDialogHeadingKey() {
    return this.dialogMode === 'create'
      ? 'portfolio.workspaceTitleEditor.createHeading'
      : 'portfolio.workspaceTitleEditor.assignHeading';
  }

  reloadPortfolioPage() {
    const browserWindow = this.browserWindow ?? globalThis.window;

    if (typeof browserWindow?.location?.reload === 'function') {
      browserWindow.location.reload();
    }
  }

  syncBoardSelfRoleForms() {
    for (const form of this.getBoardRoleForms()) {
      this.syncBoardSelfRoleForm(form);
    }
  }

  syncBoardSelfRoleForm(form) {
    const select = this.getBoardRoleSelect(form);
    const saveButton = this.getBoardRoleSaveButton(form);

    if (!saveButton) {
      return;
    }

    const canSubmit = Boolean(canonicalizeBoardRole(select?.value));

    saveButton.disabled = this.isBoardRoleSubmitting(form) || !canSubmit;
    saveButton.textContent = this.t(
      this.isBoardRoleSubmitting(form)
        ? 'portfolio.boardSelfRole.savingAction'
        : 'portfolio.boardSelfRole.saveAction'
    );
  }

  applyBoardSelfRoleResult(form, role) {
    const normalizedRole = canonicalizeBoardRole(role) ?? 'none';
    const currentRoleValue = this.getBoardRoleCurrentValue(form);
    const select = this.getBoardRoleSelect(form);

    form.dataset.currentRole = normalizedRole;

    if (currentRoleValue) {
      currentRoleValue.dataset.role = normalizedRole;
      currentRoleValue.textContent = this.t('collaborators.currentRoleValue', {
        role: this.getBoardRoleLabel(normalizedRole)
      });
    }

    if (select) {
      select.value = normalizedRole === 'none' ? '' : normalizedRole;
    }

    this.updateBoardOpenState(form, normalizedRole !== 'none');
    this.hideBoardRoleError(form);
    this.syncBoardSelfRoleForm(form);
  }

  resolveEffectiveBoardRole(workspace, boardId) {
    const viewerActor = this.getViewerActor();
    const normalizedBoardId = normalizeOptionalString(boardId);
    const board = normalizedBoardId ? workspace?.boards?.[normalizedBoardId] ?? null : null;

    if (!viewerActor || !board) {
      return null;
    }

    return canonicalizeBoardRole(getBoardMembershipForActor(board, viewerActor)?.role);
  }

  getViewerActor() {
    if (!this.hasViewerSubValue) {
      return null;
    }

    return createWorkspaceViewerActor({
      sub: normalizeOptionalString(this.viewerSubValue)
    });
  }

  getBoardRoleLabel(roleOrStatus) {
    return this.t(getBoardRoleTranslationKey(roleOrStatus));
  }

  setBoardRoleSubmitting(form, isSubmitting) {
    if (!form?.dataset) {
      return;
    }

    form.dataset.submitting = isSubmitting === true ? 'true' : 'false';

    const select = this.getBoardRoleSelect(form);

    if (select) {
      select.disabled = isSubmitting === true;
    }

    this.syncBoardSelfRoleForm(form);
  }

  isBoardRoleSubmitting(form) {
    return form?.dataset?.submitting === 'true';
  }

  showBoardRoleError(form, message) {
    const error = this.getBoardRoleError(form);

    if (!error) {
      return;
    }

    error.hidden = false;
    error.textContent = message;
  }

  hideBoardRoleError(form) {
    const error = this.getBoardRoleError(form);

    if (!error) {
      return;
    }

    error.hidden = true;
    error.textContent = '';
  }

  updateBoardOpenState(form, canOpen) {
    const link = this.getBoardOpenLink(form);
    const hint = this.getBoardOpenHint(form);

    if (hint) {
      hint.hidden = canOpen;
    }

    if (!link) {
      return;
    }

    writeElementBooleanAttribute(link, 'aria-disabled', !canOpen);

    if (canOpen) {
      clearElementAttribute(link, 'tabindex');
    } else {
      writeElementAttribute(link, 'tabindex', '-1');
    }

    toggleClassToken(link, 'portfolio-link-disabled', !canOpen);
  }

  getWorkspaceLabelElements(workspaceId) {
    return Array.from(this.element?.querySelectorAll?.('[data-portfolio-workspace-id]') ?? [])
      .filter((element) => (
        element?.dataset?.portfolioField === 'workspace-label'
        && normalizeOptionalString(element?.dataset?.portfolioWorkspaceId) === workspaceId
      ));
  }

  getWorkspaceRenameButtons(workspaceId) {
    return Array.from(this.element?.querySelectorAll?.('[data-portfolio-action="rename-workspace-title"]') ?? [])
      .filter((element) => normalizeOptionalString(element?.dataset?.workspaceId) === workspaceId);
  }

  getBoardRoleForms() {
    return Array.from(this.element?.querySelectorAll?.('[data-portfolio-board-role-form]') ?? []);
  }

  resolveBoardRoleFormElement(element) {
    if (!element) {
      return null;
    }

    if (element?.dataset && Object.hasOwn(element.dataset, 'portfolioBoardRoleForm')) {
      return element;
    }

    if (typeof element?.closest === 'function') {
      return element.closest('[data-portfolio-board-role-form]');
    }

    return null;
  }

  getBoardRoleCurrentValue(form) {
    return form?.querySelector?.('[data-portfolio-field="board-self-role-current-value"]') ?? null;
  }

  getBoardRoleSelect(form) {
    return form?.querySelector?.('[data-portfolio-field="board-self-role-select"]') ?? null;
  }

  getBoardRoleSaveButton(form) {
    return form?.querySelector?.('[data-portfolio-field="board-self-role-save"]') ?? null;
  }

  getBoardRoleError(form) {
    return form?.querySelector?.('[data-portfolio-field="board-self-role-error"]') ?? null;
  }

  getBoardOpenHint(form) {
    return form?.querySelector?.('[data-portfolio-field="board-open-hint"]') ?? null;
  }

  getBoardOpenLink(form) {
    return form?.querySelector?.('[data-portfolio-open-board-link]') ?? null;
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readElementBooleanAttribute(element, name) {
  const value = readElementAttribute(element, name);
  return value === 'true';
}

function writeElementBooleanAttribute(element, name, value) {
  writeElementAttribute(element, name, value ? 'true' : 'false');
}

function readElementAttribute(element, name) {
  if (!element) {
    return '';
  }

  if (typeof element.getAttribute === 'function') {
    return normalizeOptionalString(element.getAttribute(name));
  }

  if (typeof element[name] === 'string') {
    return normalizeOptionalString(element[name]);
  }

  if (isPlainObject(element.attributes) && typeof element.attributes[name] === 'string') {
    return normalizeOptionalString(element.attributes[name]);
  }

  return '';
}

function writeElementAttribute(element, name, value) {
  if (!element) {
    return;
  }

  if (typeof element.setAttribute === 'function') {
    element.setAttribute(name, value);
  }

  if (isPlainObject(element.attributes)) {
    element.attributes[name] = value;
  } else {
    element.attributes = {
      [name]: value
    };
  }

  element[name] = value;
}

function clearElementAttribute(element, name) {
  if (!element) {
    return;
  }

  if (typeof element.removeAttribute === 'function') {
    element.removeAttribute(name);
  }

  if (isPlainObject(element.attributes)) {
    delete element.attributes[name];
  }

  if (Object.hasOwn(element, name)) {
    delete element[name];
  }
}

function toggleClassToken(element, token, enabled) {
  if (!element || !token) {
    return;
  }

  if (element.classList && typeof element.classList.toggle === 'function') {
    element.classList.toggle(token, enabled);
    return;
  }

  const classNames = normalizeOptionalString(element.className)
    .split(/\s+/u)
    .filter(Boolean);
  const nextClassNames = new Set(classNames);

  if (enabled) {
    nextClassNames.add(token);
  } else {
    nextClassNames.delete(token);
  }

  element.className = Array.from(nextClassNames).join(' ');
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
