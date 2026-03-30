import { Controller } from '/vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '/js/i18n/browser.js';

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
    'moveOption'
  ];

  connect() {
    this.t = getBrowserTranslator();
    this.editor = null;
  }

  disconnect() {
    this.editor?.toTextArea();
    this.editor?.cleanup();
    this.editor = null;
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
    const { mode, boardId, card, columnId } = event.detail;
    const isEditMode = mode === 'edit';
    const nextColumnId = columnId ?? 'backlog';
    const nextCardId = card?.id ?? '';
    const sourceColumnId = isEditMode ? nextColumnId : '';
    const targetColumnId = nextColumnId;

    this.formTarget.reset();
    this.modeInputTarget.value = mode;
    this.boardIdInputTarget.value = boardId ?? '';
    this.cardIdInputTarget.value = nextCardId;
    this.sourceColumnIdInputTarget.value = sourceColumnId;
    this.targetColumnIdInputTarget.value = targetColumnId;
    this.priorityInputTarget.value = card?.priority ?? 'important';
    this.titleInputTarget.value = card?.title ?? '';
    this.ensureEditor().value(card?.detailsMarkdown ?? '');
    this.headingTarget.textContent = isEditMode ? this.t('cardEditor.editHeading') : this.t('cardEditor.newHeading');
    this.syncPriorityOptions();
    this.syncEditActions({
      isEditMode,
      cardId: nextCardId,
      sourceColumnId,
      targetColumnId
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
    this.targetColumnIdInputTarget.value = event.currentTarget.dataset.targetColumnId ?? this.targetColumnIdInputTarget.value;
    this.syncEditActions({
      isEditMode: this.modeInputTarget.value === 'edit',
      cardId: this.cardIdInputTarget.value,
      sourceColumnId: this.sourceColumnIdInputTarget.value,
      targetColumnId: this.targetColumnIdInputTarget.value
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

  syncEditActions({ isEditMode, cardId, sourceColumnId, targetColumnId }) {
    const shouldShowPrioritySection = targetColumnId !== 'done' && targetColumnId !== 'archived';

    this.prioritySectionTarget.hidden = !shouldShowPrioritySection;
    this.editActionsTarget.hidden = !isEditMode;
    this.deleteActionsTarget.hidden = !isEditMode || sourceColumnId !== 'archived';
    this.deleteActionRegionTarget.replaceChildren();

    if (isEditMode && sourceColumnId === 'archived') {
      const deleteButton = this.deleteButtonTemplateTarget.content.firstElementChild.cloneNode(true);
      deleteButton.dataset.cardId = cardId;
      deleteButton.dataset.boardId = this.boardIdInputTarget.value;
      this.deleteActionRegionTarget.append(deleteButton);
    }

    for (const button of this.moveOptionTargets) {
      const isSelectedColumn = button.dataset.targetColumnId === targetColumnId;
      const isCurrentColumn = button.dataset.targetColumnId === sourceColumnId;
      const isArchivedOption = button.dataset.targetColumnId === 'archived';
      const canShowArchivedOption = sourceColumnId === 'done' || sourceColumnId === 'archived';
      const columnTitle = button.dataset.columnTitle ?? '';
      button.hidden = isArchivedOption && !canShowArchivedOption;
      button.disabled = isSelectedColumn;
      button.setAttribute('aria-disabled', String(isSelectedColumn));
      button.textContent = isSelectedColumn
        ? `${columnTitle} (${this.t(isCurrentColumn ? 'cardEditor.moveStateCurrent' : 'cardEditor.moveStateSelected')})`
        : columnTitle;
    }
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
