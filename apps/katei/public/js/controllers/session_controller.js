import { Controller } from '../../vendor/stimulus/stimulus.js';
import { getBrowserTranslator } from '/js/i18n/browser.js';
import { localizeErrorMessage } from '/js/i18n/errors.js';
import { markDisableAutoSelectPending } from '/js/utils/google_identity.js';

export default class extends Controller {
  static targets = ['status'];

  static values = {
    authUrl: String,
    redirectUrl: String
  };

  connect() {
    this.t = getBrowserTranslator();
    this.isSubmitting = false;
  }

  async logout(event) {
    event.preventDefault();

    if (this.isSubmitting) {
      return;
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
    } catch (error) {
      console.error('Sign-out failed.', error);
      this.statusTarget.textContent = localizeErrorMessage(error, this.t, {
        fallbackKey: 'session.signOutUnavailable'
      });
      this.isSubmitting = false;
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
