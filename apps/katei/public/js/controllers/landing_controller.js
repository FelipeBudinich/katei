import { Controller } from '/vendor/stimulus/stimulus.js';
import { isLandingControllerConnected } from '/js/controllers/landing_controller_connection.js';
import {
  EMPTY_GOOGLE_BUTTON_SLOT_ERROR_CODE,
  assertValidGoogleClientId,
  consumeDisableAutoSelectFlag,
  initializeGoogleIdentityClient,
  renderGoogleIdentityButton,
  waitForGoogleIdentity
} from '/js/utils/google_identity.js';

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
    let clientId;

    try {
      clientId = assertValidGoogleClientId(this.googleClientIdValue);
    } catch (error) {
      console.error('GIS client ID validation failed', error);
      this.showStatus('Google client ID is missing.');
      return;
    }

    let googleIdentity;

    try {
      googleIdentity = await waitForGoogleIdentity();
    } catch (error) {
      console.error('GIS readiness failed', error);
      this.showStatus('Google Identity Services did not load.');
      return;
    }

    if (!isLandingControllerConnected(this)) {
      return;
    }

    try {
      initializeGoogleIdentityClient(googleIdentity, {
        clientId,
        callback: (credentialResponse) => {
          void this.handleCredentialResponse(credentialResponse);
        }
      });
    } catch (error) {
      console.error('GIS initialize failed', error);
      this.showStatus('Google sign-in could not be initialized for this origin.');
      return;
    }

    try {
      await renderGoogleIdentityButton(googleIdentity, this.buttonTarget);
    } catch (error) {
      if (error?.code === EMPTY_GOOGLE_BUTTON_SLOT_ERROR_CODE) {
        console.error('GIS renderButton produced an empty slot', error);
        this.showStatus('Google sign-in button was not rendered. Check the allowed JavaScript origins for this client ID.');
      } else {
        console.error('GIS renderButton failed', error);
        this.showStatus('Google sign-in button could not be rendered.');
      }
      return;
    }

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
