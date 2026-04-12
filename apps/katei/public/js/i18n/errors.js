const KNOWN_ERROR_KEY_BY_CODE = Object.freeze({
  BOARD_OPENAI_KEY_MISSING: 'errors.boardOpenAiKeyMissing',
  BOARD_OPENAI_KEY_UNAVAILABLE: 'errors.boardOpenAiKeyUnavailable',
  TARGET_LOCALE_UNSUPPORTED: 'errors.targetLocaleUnsupported',
  SOURCE_LOCALE_MISSING: 'errors.sourceLocaleMissing',
  LOCALIZATION_HUMAN_AUTHORED_CONFLICT: 'errors.localizationHumanAuthoredConflict',
  LOCALIZATION_ALREADY_PRESENT: 'errors.localizationAlreadyPresent',
  OPENAI_UPSTREAM_ERROR: 'errors.localizationGenerateFailed',
  STAGE_PROMPT_ACTION_DISABLED: 'errors.stagePromptActionDisabled',
  STAGE_PROMPT_ACTION_CONFIG_MISSING: 'errors.stagePromptActionConfigMissing',
  STAGE_PROMPT_RUN_FAILED: 'errors.stagePromptRunFailed',
  STAGE_PROMPT_OUTPUT_INVALID: 'errors.stagePromptRunFailed'
});

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
  'Each stage must use "stage-id | Title", "stage-id | Title | target-a, target-b", or "stage-id | Title | target-a, target-b | action-a, action-b".':
    'errors.boardStageDefinitionFormatInvalid',
  'Stage ids must be lowercase slugs like "in-review".': 'errors.boardStageIdInvalid',
  'Stage ids must be unique.': 'errors.boardStageIdsUnique',
  'Stage titles are required.': 'errors.boardStageTitleRequired',
  'Stage transitions must use stage ids.': 'errors.boardTransitionsInvalid',
  'Stage transitions must reference existing stages.': 'errors.boardTransitionsMissingTarget',
  'Stage actions must use known action ids.': 'errors.boardStageActionsInvalid',
  'Stage action ids must be unique.': 'errors.boardStageActionIdsUnique',
  'Stages with "card.prompt.run" must define a prompt action.': 'errors.boardStagePromptActionRequired',
  'Stage prompt actions require the "card.prompt.run" action id.': 'errors.boardStagePromptActionRequiresActionId',
  'Stage prompt action is invalid.': 'errors.boardStagePromptActionInvalid',
  'Stage prompt action must be enabled when provided.': 'errors.boardStagePromptActionEnabledRequired',
  'Stage prompt action prompt is required.': 'errors.boardStagePromptActionPromptRequired',
  'Stage prompt action target stage is required.': 'errors.boardStagePromptActionTargetRequired',
  'Stage prompt actions must target an existing stage.': 'errors.boardStagePromptActionTargetMissing',
  'Stage prompt actions must use a JSON object.': 'errors.boardStagePromptActionJsonInvalid',
  'Stage prompt actions must reference stages in the current draft.': 'errors.boardStagePromptActionStageMissing',
  'Stage review policies require the "card.review" action id.': 'errors.boardStageReviewPolicyRequiresActionId',
  'Stage review policy is invalid.': 'errors.boardStageReviewPolicyInvalid',
  'Stage review approver role must be "editor" or "admin".': 'errors.boardStageReviewApproverRoleInvalid',
  'Stage review policies must use a JSON object.': 'errors.boardStageReviewPolicyJsonInvalid',
  'Stage review policies must reference stages in the current draft.': 'errors.boardStageReviewPolicyStageMissing',
  'Template ids are required.': 'errors.boardTemplateIdRequired',
  'Template ids must be unique.': 'errors.boardTemplateIdsUnique',
  'Template titles are required.': 'errors.boardTemplateTitleRequired',
  'Template initial stage must reference an existing stage.': 'errors.boardTemplateInitialStageInvalid',
  'Cannot remove a stage that still has cards.': 'errors.boardStageHasCards',
  'Existing cards do not contain the new source locale.': 'errors.boardSourceLocaleMissingOnCards',
  'Each glossary line must use "Source term | locale=value | locale=value".': 'errors.boardLocalizationGlossaryInvalid',
  'Board localization glossary is invalid.': 'errors.boardLocalizationGlossaryInvalid',
  'Localization glossary source terms are required.': 'errors.boardLocalizationGlossarySourceRequired',
  'Localization glossary source terms must be unique.': 'errors.boardLocalizationGlossarySourcesUnique',
  'Localization glossary translations are required.': 'errors.boardLocalizationGlossaryTranslationsRequired',
  'Localization glossary translations must use supported locale ids.': 'errors.boardLocalizationGlossaryLocalesInvalid',
  'Card title is required.': 'errors.cardTitleRequired',
  'Cards can only be created in create-enabled stages.': 'errors.cardCreateStageUnavailable',
  'Cards can only be deleted in delete-enabled stages.': 'errors.cardDeleteStageUnavailable',
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
  'This workspace changed elsewhere. Refresh to continue.': 'errors.workspaceConflict',
  'Unable to complete the request.': 'errors.requestUnavailable'
});

export function localizeErrorMessage(error, t, { fallbackKey = 'errors.genericUnexpected' } = {}) {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);

  if (code) {
    const translationKey = KNOWN_ERROR_KEY_BY_CODE[code];

    if (translationKey && typeof t === 'function') {
      return t(translationKey);
    }
  }

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

function getErrorCode(error) {
  if (typeof error?.code === 'string' && error.code.trim()) {
    return error.code.trim();
  }

  if (typeof error?.data?.errorCode === 'string' && error.data.errorCode.trim()) {
    return error.data.errorCode.trim();
  }

  return '';
}

function translateFallback(t, fallbackKey) {
  if (typeof t !== 'function') {
    return fallbackKey;
  }

  return t(fallbackKey);
}
