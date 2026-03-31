import { Controller } from '/vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import {
  getDefaultBoardStageId,
  getStageMoveOptions,
  resolveBoardStageId,
  shouldShowDeleteForStage,
  shouldShowPriorityForStage
} from './stage_ui.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'form',
    'heading',
    'modeInput',
    'boardIdInput',
    'cardIdInput',
    'sourceColumnIdInput',
    'targetColumnIdInput',
    'prioritySection',
    'priorityInput',
    'priorityOption',
    'titleInput',
    'markdownInput',
    'editActions',
    'deleteActions',
    'deleteActionRegion',
    'deleteButtonTemplate',
    'moveOptionRegion',
    'moveOptionTemplate'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.editor = null;
    this.board = null;
  }

  disconnect() {
    this.editor?.toTextArea();
    this.editor?.cleanup();
    this.editor = null;
    this.board = null;
  }

  ensureEditor() {
    if (this.editor) {
      return this.editor;
    }

    if (!window.EasyMDE) {
      throw new Error('EasyMDE is unavailable.');
    }

    this.editor = new window.EasyMDE({
      element: this.markdownInputTarget,
      forceSync: true,
      autoRefresh: { delay: 200 },
      autoDownloadFontAwesome: false,
      autosave: { enabled: false },
      status: false,
      spellChecker: false,
      nativeSpellcheck: false,
      toolbar: createMarkdownToolbar(window.EasyMDE, this.t)
    });

    return this.editor;
  }

  openFromEvent(event) {
    const { mode, boardId, board, card, stageId, columnId } = event.detail;
    const isEditMode = mode === 'edit';
    const nextStageId =
      resolveBoardStageId(board, { stageId, columnId, cardId: card?.id }) ??
      getDefaultBoardStageId(board);
    const nextCardId = card?.id ?? '';
    const sourceStageId = isEditMode ? nextStageId : '';
    const targetStageId = nextStageId;

    this.formTarget.reset();
    this.board = board ?? null;
    this.modeInputTarget.value = mode;
    this.boardIdInputTarget.value = boardId ?? '';
    this.cardIdInputTarget.value = nextCardId;
    this.sourceColumnIdInputTarget.value = sourceStageId;
    this.targetColumnIdInputTarget.value = targetStageId;
    this.priorityInputTarget.value = card?.priority ?? 'important';
    this.titleInputTarget.value = card?.title ?? '';
    this.ensureEditor().value(card?.detailsMarkdown ?? '');
    this.headingTarget.textContent = isEditMode ? this.t('cardEditor.editHeading') : this.t('cardEditor.newHeading');
    this.renderMoveOptions({ board, sourceStageId });
    this.syncPriorityOptions();
    this.syncEditActions({
      isEditMode,
      cardId: nextCardId,
      sourceStageId,
      targetStageId
    });

    if (!this.dialogTarget.open) {
      this.dialogTarget.showModal();
    }

    requestAnimationFrame(() => {
      this.editor?.codemirror?.refresh();
      this.titleInputTarget.focus();
    });
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
    this.closeDialog();
  }

  selectPriority(event) {
    event.preventDefault();
    this.priorityInputTarget.value = event.currentTarget.dataset.priorityId;
    this.syncPriorityOptions();
  }

  selectColumn(event) {
    event.preventDefault();
    this.targetColumnIdInputTarget.value =
      event.currentTarget.dataset.targetStageId ??
      event.currentTarget.dataset.targetColumnId ??
      this.targetColumnIdInputTarget.value;
    this.syncEditActions({
      isEditMode: this.modeInputTarget.value === 'edit',
      cardId: this.cardIdInputTarget.value,
      sourceStageId: this.sourceColumnIdInputTarget.value,
      targetStageId: this.targetColumnIdInputTarget.value
    });
  }

  submit(event) {
    event.preventDefault();

    const formData = new FormData(this.formTarget);

    this.dispatch('save', {
      detail: {
        mode: formData.get('mode'),
        boardId: formData.get('boardId'),
        cardId: formData.get('cardId'),
        sourceStageId: formData.get('sourceColumnId'),
        targetStageId: formData.get('targetColumnId'),
        sourceColumnId: formData.get('sourceColumnId'),
        targetColumnId: formData.get('targetColumnId'),
        input: {
          title: formData.get('title'),
          detailsMarkdown: formData.get('detailsMarkdown'),
          priority: formData.get('priority')
        }
      }
    });

    this.closeDialog();
  }

  closeDialog() {
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    this.board = null;
  }

  syncPriorityOptions() {
    const selectedPriority = this.priorityInputTarget.value;

    for (const button of this.priorityOptionTargets) {
      const isCurrentPriority = button.dataset.priorityId === selectedPriority;
      button.disabled = false;
      button.setAttribute('aria-disabled', 'false');
      button.setAttribute('aria-pressed', String(isCurrentPriority));
    }
  }

  renderMoveOptions({ board, sourceStageId }) {
    const moveOptionButtons = getStageMoveOptions(board, sourceStageId).map(({ id, title }) => {
      const button = this.moveOptionTemplateTarget.content.firstElementChild.cloneNode(true);
      button.dataset.targetStageId = id;
      button.dataset.targetColumnId = id;
      button.dataset.stageTitle = title;
      button.dataset.columnTitle = title;
      button.textContent = title;
      return button;
    });

    this.moveOptionRegionTarget.replaceChildren(...moveOptionButtons);
  }

  syncEditActions({ isEditMode, cardId, sourceStageId, targetStageId }) {
    const shouldShowPrioritySection = shouldShowPriorityForStage(targetStageId);
    const shouldShowDeleteAction = isEditMode && shouldShowDeleteForStage(this.board, sourceStageId);

    this.prioritySectionTarget.hidden = !shouldShowPrioritySection;
    this.editActionsTarget.hidden = !isEditMode;
    this.deleteActionsTarget.hidden = !shouldShowDeleteAction;
    this.deleteActionRegionTarget.replaceChildren();

    if (shouldShowDeleteAction) {
      const deleteButton = this.deleteButtonTemplateTarget.content.firstElementChild.cloneNode(true);
      deleteButton.dataset.cardId = cardId;
      deleteButton.dataset.boardId = this.boardIdInputTarget.value;
      this.deleteActionRegionTarget.append(deleteButton);
    }

    for (const button of this.getMoveOptionButtons()) {
      const buttonTargetStageId = button.dataset.targetStageId ?? button.dataset.targetColumnId;
      const isSelectedStage = buttonTargetStageId === targetStageId;
      const isCurrentStage = buttonTargetStageId === sourceStageId;
      const stageTitle = button.dataset.stageTitle ?? button.dataset.columnTitle ?? '';
      button.disabled = isSelectedStage;
      button.setAttribute('aria-disabled', String(isSelectedStage));
      button.textContent = isSelectedStage
        ? `${stageTitle} (${this.t(isCurrentStage ? 'cardEditor.moveStateCurrent' : 'cardEditor.moveStateSelected')})`
        : stageTitle;
    }
  }

  getMoveOptionButtons() {
    return [...this.moveOptionRegionTarget.querySelectorAll('[data-card-editor-target="moveOption"]')];
  }
}

function createMarkdownToolbar(EasyMDE, t) {
  return [
    createToolbarButton('bold', t('cardEditor.markdownToolbar.bold'), EasyMDE.toggleBold),
    createToolbarButton('italic', t('cardEditor.markdownToolbar.italic'), EasyMDE.toggleItalic),
    createToolbarButton('heading-2', t('cardEditor.markdownToolbar.heading'), EasyMDE.toggleHeading2),
    '|',
    createToolbarButton('quote', t('cardEditor.markdownToolbar.quote'), EasyMDE.toggleBlockquote),
    createToolbarButton('unordered-list', t('cardEditor.markdownToolbar.bullets'), EasyMDE.toggleUnorderedList),
    createToolbarButton('ordered-list', t('cardEditor.markdownToolbar.numbers'), EasyMDE.toggleOrderedList),
    '|',
    createToolbarButton('code', t('cardEditor.markdownToolbar.code'), EasyMDE.toggleCodeBlock),
    createToolbarButton('link', t('cardEditor.markdownToolbar.link'), EasyMDE.drawLink),
    '|',
    createToolbarButton('preview', t('cardEditor.markdownToolbar.preview'), EasyMDE.togglePreview, { noDisable: true })
  ];
}

function createToolbarButton(name, text, action, overrides = {}) {
  return {
    name,
    action,
    text,
    title: text,
    ...overrides
  };
}
