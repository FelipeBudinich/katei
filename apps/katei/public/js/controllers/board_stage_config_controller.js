import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '../i18n/browser.js';
import { localizeErrorMessage } from '../i18n/errors.js';
import { openDialogWithInitialFocus } from './dialog_initial_focus.js';
import { validateAndNormalizeStageDefinitions } from './board_stage_config_schema.js';

export default class extends Controller {
  static targets = ['dialog', 'definitionsInput', 'error'];

  connect() {
    this.t = getBrowserTranslator();
    this.currentBoard = null;
    this.restoreFocusElement = null;
    this.hideError();
  }

  openFromEvent(event) {
    this.currentBoard = event.detail?.currentBoard ?? null;
    this.restoreFocusElement = event.detail?.triggerElement ?? null;
    this.definitionsInputTarget.value = typeof event.detail?.stageDefinitions === 'string' ? event.detail.stageDefinitions : '';
    this.hideError();

    openDialogWithInitialFocus(this.dialogTarget, this.definitionsInputTarget);
  }

  apply(event) {
    event.preventDefault();

    try {
      validateAndNormalizeStageDefinitions(this.definitionsInputTarget.value, {
        currentBoard: this.currentBoard
      });
    } catch (error) {
      this.showError(localizeErrorMessage(error, this.t));
      return;
    }

    this.hideError();
    this.closeDialog({ restoreFocus: false });
    window.dispatchEvent(
      new CustomEvent('board-stage-config:apply', {
        detail: {
          stageDefinitions: this.definitionsInputTarget.value
        }
      })
    );
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
    if (this.dialogTarget.open) {
      this.dialogTarget.close();
    }

    this.hideError();
    this.currentBoard = null;

    if (restoreFocus && this.restoreFocusElement?.isConnected) {
      this.restoreFocusElement.focus();
    }

    this.restoreFocusElement = null;
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
