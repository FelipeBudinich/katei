import { Controller } from '/vendor/stimulus/stimulus.js';
import { consumeDisableAutoSelectFlag, waitForGoogleIdentity } from '/js/utils/google_identity.js';

export default class extends Controller {
  static targets = ['button', 'status', 'loading'];

  static values = {
    googleClientId: String,
    authUrl: String,
    redirectUrl: String
  };

  connect() {
    this.isSubmitting = false;
    this.initializeGoogleIdentity().catch((error) => {
      console.error('Failed to initialize Google Identity Services.', error);
      this.showStatus('Google sign-in is unavailable right now.');
    });
  }

  async initializeGoogleIdentity() {
    const googleIdentity = await waitForGoogleIdentity();

    if (!this.isConnected) {
      return;
    }

    googleIdentity.accounts.id.initialize({
      client_id: this.googleClientIdValue,
      callback: (credentialResponse) => {
        void this.handleCredentialResponse(credentialResponse);
      }
    });

    googleIdentity.accounts.id.renderButton(this.buttonTarget, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 280,
      logo_alignment: 'left'
    });

    if (consumeDisableAutoSelectFlag()) {
      googleIdentity.accounts.id.disableAutoSelect();
    }
  }

  async handleCredentialResponse(credentialResponse) {
    if (this.isSubmitting) {
      return;
    }

    const credential = credentialResponse?.credential;

    if (typeof credential !== 'string' || !credential.trim()) {
      this.showStatus('Google sign-in did not return a credential.');
      return;
    }

    this.isSubmitting = true;
    this.buttonTarget.dataset.state = 'loading';
    this.loadingTarget.hidden = false;
    this.showStatus('');

    try {
      const response = await fetch(this.authUrlValue, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ credential })
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        throw new Error(data?.error || 'Unable to sign in with Google.');
      }

      window.location.assign(data?.redirectTo || this.redirectUrlValue);
    } catch (error) {
      console.error('Google sign-in failed.', error);
      this.showStatus(error instanceof Error ? error.message : 'Unable to sign in with Google.');
      this.loadingTarget.hidden = true;
      this.buttonTarget.dataset.state = 'idle';
      this.isSubmitting = false;
    }
  }

  showStatus(message) {
    this.statusTarget.textContent = message;
    this.statusTarget.hidden = !message;
  }
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}
