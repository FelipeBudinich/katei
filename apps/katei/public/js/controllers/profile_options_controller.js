import { Controller } from '../../vendor/stimulus/stimulus.js';
import { closeSheetDialog, openSheetDialog } from './sheet_dialog.js';

export default class extends Controller {
  static targets = ['dialog'];

  connect() {
    this.restoreFocusElement = null;
  }

  openFromEvent(event) {
    this.restoreFocusElement = event.detail?.triggerElement ?? null;

    openSheetDialog(this.dialogTarget);

    requestAnimationFrame(() => {
      this.dialogTarget.querySelector('[data-profile-options-initial-focus]')?.focus();
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

  closeDialog({ restoreFocus = true } = {}) {
    closeSheetDialog(this.dialogTarget);

    if (restoreFocus && this.restoreFocusElement?.isConnected) {
      this.restoreFocusElement.focus();
    }

    this.restoreFocusElement = null;
  }
}
