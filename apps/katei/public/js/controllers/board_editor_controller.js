import { Controller } from '../../vendor/stimulus/stimulus.js';
import { createBoardEditorFormState, parseBoardEditorFormInput } from './board_editor_schema.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'form',
    'heading',
    'modeInput',
    'boardIdInput',
    'titleInput',
    'sourceLocaleInput',
    'defaultLocaleInput',
    'supportedLocalesInput',
    'requiredLocalesInput',
    'stageDefinitionsInput',
    'deleteActions',
    'deleteButton',
    'submitButton',
    'error'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.currentBoard = null;
    this.resetDialogState();
  }

  openFromEvent(event) {
    const { mode, board, canDeleteBoard = false } = event.detail;
    const isRenameMode = mode === 'rename';
    const formState = createBoardEditorFormState(board);

    this.formTarget.reset();
    this.currentBoard = board ?? null;
    this.modeInputTarget.value = mode;
    this.boardIdInputTarget.value = board?.id ?? '';
    this.titleInputTarget.value = isRenameMode ? formState.title : '';
    this.sourceLocaleInputTarget.value = formState.sourceLocale;
    this.defaultLocaleInputTarget.value = formState.defaultLocale;
    this.supportedLocalesInputTarget.value = formState.supportedLocales;
    this.requiredLocalesInputTarget.value = formState.requiredLocales;
    this.stageDefinitionsInputTarget.value = formState.stageDefinitions;
    this.headingTarget.textContent = isRenameMode ? this.t('boardEditor.renameHeading') : this.t('boardEditor.newHeading');
    this.submitButtonTarget.textContent = isRenameMode ? this.t('boardEditor.saveButton') : this.t('boardEditor.createButton');
    this.syncDeleteAction({
      boardId: board?.id ?? '',
      isRenameMode,
      canDeleteBoard
    });
    this.hideError();

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => this.titleInputTarget.focus());
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

  closeForAction() {
    this.closeDialog({ clearDeleteBoardId: false });
    queueMicrotask(() => {
      if (!this.dialogTarget.open) {
        this.resetDialogState();
      }
    });
  }

  submit(event) {
    event.preventDefault();

    let input;

    try {
      const formData = new FormData(this.formTarget);
      input = parseBoardEditorFormInput(
        {
          title: formData.get('title'),
          sourceLocale: formData.get('sourceLocale'),
          defaultLocale: formData.get('defaultLocale'),
          supportedLocales: formData.get('supportedLocales'),
          requiredLocales: formData.get('requiredLocales'),
          stageDefinitions: formData.get('stageDefinitions')
        },
        {
          currentBoard: this.currentBoard
        }
      );
    } catch (error) {
      this.showError(localizeErrorMessage(error, this.t));
      return;
    }

    this.dispatch('save', {
      detail: {
        mode: this.modeInputTarget.value,
        boardId: this.boardIdInputTarget.value,
        input
      }
    });

    this.closeDialog();
  }

  closeDialog({ clearDeleteBoardId = true } = {}) {
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    this.resetDialogState({ clearDeleteBoardId });
  }

  syncDeleteAction({ boardId = '', isRenameMode = false, canDeleteBoard = false } = {}) {
    const shouldShowDeleteAction = Boolean(isRenameMode && canDeleteBoard && boardId);

    this.deleteActionsTarget.hidden = !shouldShowDeleteAction;
    this.deleteButtonTarget.dataset.boardId = shouldShowDeleteAction ? boardId : '';
  }

  resetDialogState({ clearDeleteBoardId = true } = {}) {
    this.currentBoard = null;
    this.deleteActionsTarget.hidden = true;

    if (clearDeleteBoardId) {
      this.deleteButtonTarget.dataset.boardId = '';
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
}
