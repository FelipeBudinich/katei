import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '/js/i18n/browser.js';
import { localizeErrorMessage } from '/js/i18n/errors.js';
import { markDisableAutoSelectPending } from '/js/utils/google_identity.js';

export default class extends Controller {
  static targets = [
    'status',
    'logoutButton',
    'confirmDialog',
    'confirmTitle',
    'confirmMessage',
    'confirmButton'
  ];

  static values = {
    authUrl: String,
    redirectUrl: String
  };

  connect() {
    this.t = getBrowserTranslator();
    this.isSubmitting = false;
  }

  openLogoutConfirm(event) {
    event.preventDefault();

    if (this.isSubmitting) {
      return;
    }

    if (!this.hasConfirmDialogTarget) {
      return;
    }

    if (this.hasConfirmTitleTarget) {
      this.confirmTitleTarget.textContent = this.t('session.logoutConfirmTitle');
    }

    if (this.hasConfirmMessageTarget) {
      this.confirmMessageTarget.textContent = this.t('session.logoutConfirmMessage');
    }

    if (!this.confirmDialogTarget.open) {
      this.confirmDialogTarget.showModal();
    }

    requestAnimationFrame(() => this.confirmButtonTarget?.focus?.());
  }

  backdropCloseConfirmDialog(event) {
    if (event.target === this.confirmDialogTarget) {
      this.closeConfirmDialog();
    }
  }

  closeConfirmDialog(event) {
    if (event) {
      event.preventDefault();
    }

    if (this.hasConfirmDialogTarget && this.confirmDialogTarget.open) {
      this.confirmDialogTarget.close();
    }

    const triggerDialog = this.logoutButtonTarget?.closest?.('dialog');

    if (this.logoutButtonTarget?.isConnected && (!triggerDialog || triggerDialog.open)) {
      this.logoutButtonTarget.focus();
    }
  }

  async confirmLogout(event) {
    event.preventDefault();

    if (this.isSubmitting) {
      return;
    }

    if (this.hasConfirmButtonTarget) {
      this.confirmButtonTarget.disabled = true;
    }

    const success = await this.performLogout();

    if (!success) {
      if (this.hasConfirmButtonTarget) {
        this.confirmButtonTarget.disabled = false;
      }
      return;
    }

    if (this.hasConfirmDialogTarget && this.confirmDialogTarget.open) {
      this.confirmDialogTarget.close();
    }
  }

  async performLogout() {
    if (this.isSubmitting) {
      return false;
    }

    this.isSubmitting = true;
    this.statusTarget.textContent = this.t('session.signingOut');

    try {
      const response = await fetch(this.authUrlValue, {
        method: 'POST',
        headers: {
          Accept: 'application/json'
        },
        credentials: 'same-origin'
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || this.t('errors.signOutUnavailable'));
      }

      markDisableAutoSelectPending();
      window.location.assign(data?.redirectTo || this.redirectUrlValue);
      return true;
    } catch (error) {
      console.error('Sign-out failed.', error);
      this.statusTarget.textContent = localizeErrorMessage(error, this.t, {
        fallbackKey: 'session.signOutUnavailable'
      });
      this.isSubmitting = false;
      return false;
    }
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
