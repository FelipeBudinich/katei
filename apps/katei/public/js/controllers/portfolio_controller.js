import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { HttpWorkspaceRepository } from '../repositories/http_workspace_repository.js';
import { WorkspaceService } from '../services/workspace_service.js';
import { openDialogWithInitialFocus } from './dialog_initial_focus.js';

export default class extends Controller {
  static values = {
    viewerSub: String,
    viewerSuperAdmin: Boolean
  };

  static targets = [
    'dialog',
    'heading',
    'titleInput',
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
    this.currentWorkspaceId = null;
    this.currentWorkspaceFallbackLabel = null;
    this.isSubmitting = false;
    this.resetDialogState();
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

  handleTitleInput() {
    this.hideError();
  }

  backdropClose(event) {
    if (this.hasDialogTarget && event?.target === this.dialogTarget) {
      this.close(event);
    }
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

    if (!this.canManageWorkspaceTitles() || !this.currentWorkspaceId || this.isSubmitting || !this.service) {
      return;
    }

    this.hideError();
    this.setSubmittingState(true);

    try {
      const result = await this.service.setWorkspaceTitle(
        this.currentWorkspaceId,
        this.hasTitleInputTarget ? this.titleInputTarget.value : ''
      );

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

  closeDialog({ restoreFocus = true } = {}) {
    const restoreFocusElement = this.restoreFocusElement;

    if (this.hasDialogTarget && this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    this.restoreFocusElement = null;
    this.currentWorkspaceId = null;
    this.currentWorkspaceFallbackLabel = null;
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
      this.headingTarget.textContent = this.t('portfolio.workspaceTitleEditor.assignHeading');
    }

    if (this.hasTitleInputTarget) {
      this.titleInputTarget.value = '';
      this.titleInputTarget.disabled = false;
    }

    if (this.hasSaveButtonTarget) {
      this.saveButtonTarget.disabled = false;
      this.saveButtonTarget.textContent = this.t('common.save');
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
        this.isSubmitting ? 'portfolio.workspaceTitleEditor.savingAction' : 'common.save'
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
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
