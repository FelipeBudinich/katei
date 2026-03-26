import { Controller } from '/vendor/stimulus/stimulus.js';

export default class extends Controller {
  static targets = ['dialog', 'form', 'heading', 'modeInput', 'boardIdInput', 'titleInput', 'submitButton'];

  openFromEvent(event) {
    const { mode, board } = event.detail;
    const isRenameMode = mode === 'rename';

    this.formTarget.reset();
    this.modeInputTarget.value = mode;
    this.boardIdInputTarget.value = board?.id ?? '';
    this.titleInputTarget.value = isRenameMode ? board?.title ?? '' : '';
    this.headingTarget.textContent = isRenameMode ? 'Rename board' : 'New board';
    this.submitButtonTarget.textContent = isRenameMode ? 'Save Board' : 'Create Board';

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

  submit(event) {
    event.preventDefault();

    const formData = new FormData(this.formTarget);

    this.dispatch('save', {
      detail: {
        mode: formData.get('mode'),
        boardId: formData.get('boardId'),
        title: formData.get('title')
      }
    });

    this.closeDialog();
  }

  closeDialog() {
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }
  }
}
