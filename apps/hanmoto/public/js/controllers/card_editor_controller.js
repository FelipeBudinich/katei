import { Controller } from '/vendor/stimulus/stimulus.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'form',
    'heading',
    'modeInput',
    'cardIdInput',
    'sourceColumnIdInput',
    'targetColumnIdInput',
    'prioritySection',
    'priorityInput',
    'priorityOption',
    'titleInput',
    'descriptionInput',
    'editActions',
    'deleteActions',
    'deleteActionRegion',
    'deleteButtonTemplate',
    'moveOption'
  ];

  openFromEvent(event) {
    const { mode, card, columnId } = event.detail;
    const isEditMode = mode === 'edit';
    const nextColumnId = columnId ?? 'backlog';
    const nextCardId = card?.id ?? '';
    const sourceColumnId = isEditMode ? nextColumnId : '';
    const targetColumnId = nextColumnId;

    this.formTarget.reset();
    this.modeInputTarget.value = mode;
    this.cardIdInputTarget.value = nextCardId;
    this.sourceColumnIdInputTarget.value = sourceColumnId;
    this.targetColumnIdInputTarget.value = targetColumnId;
    this.priorityInputTarget.value = card?.priority ?? 'important';
    this.titleInputTarget.value = card?.title ?? '';
    this.descriptionInputTarget.value = card?.description ?? '';
    this.headingTarget.textContent = isEditMode ? 'Edit card' : 'New card';
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
        cardId: formData.get('cardId'),
        sourceColumnId: formData.get('sourceColumnId'),
        targetColumnId: formData.get('targetColumnId'),
        input: {
          title: formData.get('title'),
          description: formData.get('description'),
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
    const isEditMode = this.modeInputTarget.value === 'edit';

    for (const button of this.priorityOptionTargets) {
      const isCurrentPriority = button.dataset.priorityId === selectedPriority;
      const priorityLabel = button.dataset.priorityLabel ?? '';
      button.disabled = isCurrentPriority;
      button.setAttribute('aria-disabled', String(isCurrentPriority));
      button.setAttribute('aria-pressed', String(isCurrentPriority));
      button.textContent = isEditMode && isCurrentPriority ? `${priorityLabel} (Current)` : priorityLabel;
    }
  }

  syncEditActions({ isEditMode, cardId, sourceColumnId, targetColumnId }) {
    const shouldShowPrioritySection = targetColumnId !== 'done' && targetColumnId !== 'archived';

    this.prioritySectionTarget.hidden = !shouldShowPrioritySection;
    this.editActionsTarget.hidden = false;
    this.deleteActionsTarget.hidden = !isEditMode || sourceColumnId !== 'archived';
    this.deleteActionRegionTarget.replaceChildren();

    if (isEditMode && sourceColumnId === 'archived') {
      const deleteButton = this.deleteButtonTemplateTarget.content.firstElementChild.cloneNode(true);
      deleteButton.dataset.cardId = cardId;
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
        ? `${columnTitle} (${isCurrentColumn ? 'Current' : 'Selected'})`
        : columnTitle;
    }
  }
}
