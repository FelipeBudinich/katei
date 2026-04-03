import { Controller } from '../../vendor/stimulus/stimulus.js';
import { createBoardEditorFormState, parseBoardEditorFormInput } from './board_editor_schema.js';
import { createStageDefinitionsSummary } from './board_stage_config_schema.js';
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
    'aiSection',
    'aiProviderInput',
    'apiKeyStatus',
    'openAiApiKeyInput',
    'clearOpenAiApiKeyInput',
    'localizationGlossaryInput',
    'stageDefinitionsInput',
    'stageSummary',
    'configureStagesButton',
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
    const isEditMode = mode === 'edit';
    const formState = createBoardEditorFormState(board);

    this.formTarget.reset();
    this.currentBoard = board ?? null;
    this.modeInputTarget.value = mode;
    this.boardIdInputTarget.value = board?.id ?? '';
    this.titleInputTarget.value = isEditMode ? formState.title : '';
    this.sourceLocaleInputTarget.value = formState.sourceLocale;
    this.defaultLocaleInputTarget.value = formState.defaultLocale;
    this.supportedLocalesInputTarget.value = formState.supportedLocales;
    this.requiredLocalesInputTarget.value = formState.requiredLocales;
    this.aiSectionTarget.hidden = !isEditMode;
    this.aiProviderInputTarget.value = formState.aiProvider === 'openai' ? 'OpenAI' : formState.aiProvider;
    this.openAiApiKeyInputTarget.value = '';
    this.clearOpenAiApiKeyInputTarget.checked = false;
    this.localizationGlossaryInputTarget.value = formState.localizationGlossary;
    this.syncApiKeyStatus(formState);
    this.stageDefinitionsInputTarget.value = formState.stageDefinitions;
    this.syncStageSummary();
    this.headingTarget.textContent = isEditMode ? this.t('boardEditor.editHeading') : this.t('boardEditor.newHeading');
    this.submitButtonTarget.textContent = isEditMode ? this.t('boardEditor.saveButton') : this.t('boardEditor.createButton');
    this.syncDeleteAction({
      boardId: board?.id ?? '',
      isEditMode,
      canDeleteBoard
    });
    this.hideError();

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => this.titleInputTarget.focus());
  }

  openStageConfig(event) {
    if (event) {
      event.preventDefault();
    }

    window.dispatchEvent(
      new CustomEvent('workspace:open-board-stage-config', {
        detail: {
          stageDefinitions: this.stageDefinitionsInputTarget.value,
          currentBoard: this.currentBoard,
          triggerElement: event?.currentTarget ?? this.configureStagesButtonTarget
        }
      })
    );
  }

  applyStageConfig(event) {
    if (typeof event.detail?.stageDefinitions !== 'string') {
      return;
    }

    this.stageDefinitionsInputTarget.value = event.detail.stageDefinitions;
    this.syncStageSummary();
    this.hideError();

    if ((this.configureStagesButtonTarget?.isConnected ?? true) && typeof this.configureStagesButtonTarget?.focus === 'function') {
      this.configureStagesButtonTarget.focus();
    }
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
          aiProvider: formData.get('aiProvider'),
          openAiApiKey: formData.get('openAiApiKey'),
          clearOpenAiApiKey: formData.get('clearOpenAiApiKey') === 'true',
          localizationGlossary: formData.get('localizationGlossary'),
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

  syncDeleteAction({ boardId = '', isEditMode = false, canDeleteBoard = false } = {}) {
    const shouldShowDeleteAction = Boolean(isEditMode && canDeleteBoard && boardId);

    this.deleteActionsTarget.hidden = !shouldShowDeleteAction;
    this.deleteButtonTarget.dataset.boardId = shouldShowDeleteAction ? boardId : '';
  }

  resetDialogState({ clearDeleteBoardId = true } = {}) {
    this.currentBoard = null;
    this.deleteActionsTarget.hidden = true;
    this.aiSectionTarget.hidden = true;
    this.apiKeyStatusTarget.hidden = true;
    this.apiKeyStatusTarget.textContent = '';
    this.stageSummaryTarget.textContent = this.t('boardEditor.stageSummaryEmpty');

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

  syncApiKeyStatus(formState) {
    if (!formState?.hasOpenAiApiKey) {
      this.apiKeyStatusTarget.hidden = true;
      this.apiKeyStatusTarget.textContent = '';
      return;
    }

    this.apiKeyStatusTarget.hidden = false;
    this.apiKeyStatusTarget.textContent = formState.openAiApiKeyLast4
      ? this.t('boardEditor.openAiApiKeySavedWithLast4', { last4: formState.openAiApiKeyLast4 })
      : this.t('boardEditor.openAiApiKeySaved');
  }

  syncStageSummary() {
    try {
      const summary = createStageDefinitionsSummary(this.stageDefinitionsInputTarget.value);

      if (summary.count < 1 || !summary.stages) {
        this.stageSummaryTarget.textContent = this.t('boardEditor.stageSummaryEmpty');
        return;
      }

      this.stageSummaryTarget.textContent = this.t('boardEditor.stageSummaryValue', summary);
    } catch (error) {
      this.stageSummaryTarget.textContent = this.t('boardEditor.stageSummaryEmpty');
    }
  }
}
