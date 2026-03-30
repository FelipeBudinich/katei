const KNOWN_ERROR_KEY_BY_MESSAGE = Object.freeze({
  'Sign-in request origin is not allowed.': 'errors.authOriginNotAllowed',
  'Google credential is required.': 'errors.googleCredentialRequired',
  'Unable to verify the Google credential.': 'errors.googleCredentialVerifyFailed',
  'This Google account is not enabled for private testing.': 'errors.googleAccessDenied',
  'Unable to sign in with Google.': 'errors.signInUnavailable',
  'Unable to sign out.': 'errors.signOutUnavailable',
  'Authentication required.': 'errors.authenticationRequired',
  'Board title is required.': 'errors.boardTitleRequired',
  'Card title is required.': 'errors.cardTitleRequired',
  'Cannot delete the last remaining board.': 'errors.cannotDeleteLastBoard',
  'Board not found.': 'errors.boardNotFound',
  'Card not found.': 'errors.cardNotFound',
  'Card is not in the source column.': 'errors.cardNotInSourceColumn',
  'Unable to complete the request.': 'errors.requestUnavailable'
});

export function localizeErrorMessage(error, t, { fallbackKey = 'errors.genericUnexpected' } = {}) {
  const message = getErrorMessage(error);

  if (!message) {
    return translateFallback(t, fallbackKey);
  }

  const translationKey = KNOWN_ERROR_KEY_BY_MESSAGE[message];

  if (translationKey && typeof t === 'function') {
    return t(translationKey);
  }

  return message;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    return typeof error.message === 'string' ? error.message : '';
  }

  if (typeof error === 'string') {
    return error;
  }

  return '';
}

function translateFallback(t, fallbackKey) {
  if (typeof t !== 'function') {
    return fallbackKey;
  }

  return t(fallbackKey);
}
