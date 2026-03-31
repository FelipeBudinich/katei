const KNOWN_ERROR_KEY_BY_MESSAGE = Object.freeze({
  'Sign-in request origin is not allowed.': 'errors.authOriginNotAllowed',
  'Google credential is required.': 'errors.googleCredentialRequired',
  'Unable to verify the Google credential.': 'errors.googleCredentialVerifyFailed',
  'This Google account is not enabled for private testing.': 'errors.googleAccessDenied',
  'Unable to sign in with Google.': 'errors.signInUnavailable',
  'Unable to sign out.': 'errors.signOutUnavailable',
  'Authentication required.': 'errors.authenticationRequired',
  'Board title is required.': 'errors.boardTitleRequired',
  'Board language policy is invalid.': 'errors.boardLanguagePolicyInvalid',
  'Board must define at least one stage.': 'errors.boardStagesRequired',
  'Stage ids must be lowercase slugs like "in-review".': 'errors.boardStageIdInvalid',
  'Stage ids must be unique.': 'errors.boardStageIdsUnique',
  'Stage titles are required.': 'errors.boardStageTitleRequired',
  'Stage transitions must use stage ids.': 'errors.boardTransitionsInvalid',
  'Stage transitions must reference existing stages.': 'errors.boardTransitionsMissingTarget',
  'Stage actions must use known action ids.': 'errors.boardStageActionsInvalid',
  'Stage action ids must be unique.': 'errors.boardStageActionIdsUnique',
  'Template ids are required.': 'errors.boardTemplateIdRequired',
  'Template ids must be unique.': 'errors.boardTemplateIdsUnique',
  'Template titles are required.': 'errors.boardTemplateTitleRequired',
  'Template initial stage must reference an existing stage.': 'errors.boardTemplateInitialStageInvalid',
  'Cannot remove a stage that still has cards.': 'errors.boardStageHasCards',
  'Existing cards do not contain the new source locale.': 'errors.boardSourceLocaleMissingOnCards',
  'Card title is required.': 'errors.cardTitleRequired',
  'Cannot delete the last remaining board.': 'errors.cannotDeleteLastBoard',
  'Board not found.': 'errors.boardNotFound',
  'Card not found.': 'errors.cardNotFound',
  'Card is not in the source column.': 'errors.cardNotInSourceColumn',
  'You do not have permission to access this board.': 'errors.boardReadPermissionDenied',
  'You can view this board, but interactive board controls are unavailable until you join it.':
    'errors.boardReadPermissionDenied',
  'You do not have permission to modify this board.': 'errors.boardEditPermissionDenied',
  'You do not have permission to edit this board.': 'errors.boardEditPermissionDenied',
  'You do not have permission to administer this board.': 'errors.boardAdminPermissionDenied',
  'You do not have permission to manage this board.': 'errors.boardAdminPermissionDenied',
  'You do not have permission to respond to this invite.': 'errors.inviteResponsePermissionDenied',
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
