import { Controller } from '/vendor/stimulus/stimulus.js';

export default class extends Controller {
  static targets = [
    'dialog',
    'form',
    'heading',
    'modeInput',
    'cardIdInput',
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

    this.formTarget.reset();
    this.modeInputTarget.value = mode;
    this.cardIdInputTarget.value = nextCardId;
    this.priorityInputTarget.value = card?.priority ?? 'important';
    this.titleInputTarget.value = card?.title ?? '';
    this.descriptionInputTarget.value = card?.description ?? '';
    this.headingTarget.textContent = isEditMode ? 'Edit card' : 'New card';
    this.syncPriorityOptions();
    this.syncEditActions({
      isEditMode,
      cardId: nextCardId,
      columnId: nextColumnId
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

  submit(event) {
    event.preventDefault();

    const formData = new FormData(this.formTarget);

    this.dispatch('save', {
      detail: {
        mode: formData.get('mode'),
        cardId: formData.get('cardId'),
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

  syncEditActions({ isEditMode, cardId, columnId }) {
    const shouldShowPrioritySection = !isEditMode || (columnId !== 'done' && columnId !== 'archived');

    this.prioritySectionTarget.hidden = !shouldShowPrioritySection;
    this.editActionsTarget.hidden = !isEditMode;
    this.deleteActionsTarget.hidden = !isEditMode || columnId !== 'archived';
    this.deleteActionRegionTarget.replaceChildren();

    if (isEditMode && columnId === 'archived') {
      const deleteButton = this.deleteButtonTemplateTarget.content.firstElementChild.cloneNode(true);
      deleteButton.dataset.cardId = cardId;
      this.deleteActionRegionTarget.append(deleteButton);
    }

    for (const button of this.moveOptionTargets) {
      const isCurrentColumn = button.dataset.targetColumnId === columnId;
      const isArchivedOption = button.dataset.targetColumnId === 'archived';
      const canShowArchivedOption = columnId === 'done' || columnId === 'archived';
      const columnTitle = button.dataset.columnTitle ?? '';
      button.dataset.cardId = cardId;
      button.dataset.sourceColumnId = columnId;
      button.hidden = !isEditMode || (isArchivedOption && !canShowArchivedOption);
      button.disabled = !isEditMode || isCurrentColumn;
      button.setAttribute('aria-disabled', String(!isEditMode || isCurrentColumn));
      button.textContent = isCurrentColumn ? `${columnTitle} (Current)` : columnTitle;
    }
  }
}
