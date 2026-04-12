const EN_MESSAGES = freezeCatalog({
  common: {
    appTitle: '過程 (katei)',
    close: 'Close',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    logout: 'Logout',
    switch: 'Switch',
    welcomeUser: 'Welcome, {name}.'
  },
  pageTitles: {
    landing: '{appTitle} · Sign in',
    workspace: '{appTitle} · Boards',
    portfolio: '{appTitle} · Portfolio'
  },
  landing: {
    eyebrow: 'Private tester preview',
    description: 'Katei keeps your boards focused and tactile. Sign in with Google to open your private test workspace.',
    authTitle: 'Enter Your Boards',
    authDescription:
      'Google confirms who you are. Katei verifies that identity, then opens your board workspace with its own private session.',
    loading: 'Verifying your Google sign-in...',
    status: {
      googleUnavailable: 'Google sign-in is unavailable right now.',
      missingClientId: 'Google client ID is missing.',
      gisDidNotLoad: 'Google Identity Services did not load.',
      initOriginUnavailable: 'Google sign-in could not be initialized for this origin.',
      buttonNotRenderedDetailed:
        'Google sign-in button was not rendered. Check the allowed JavaScript origins for this client ID.',
      buttonNotRendered: 'Google sign-in button could not be rendered.',
      missingCredential: 'Google sign-in did not return a credential.'
    }
  },
  session: {
    logoutConfirmTitle: 'Log out?',
    logoutConfirmMessage: 'You will be signed out of Katei on this device.',
    signingOut: 'Signing out...',
    signOutUnavailable: 'Unable to sign out right now.'
  },
  uiLocale: {
    label: 'UI language'
  },
  portfolio: {
    eyebrow: 'Super admin portfolio',
    title: 'Portfolio',
    description:
      'A dedicated super-admin surface for cross-workspace portfolio summaries and workspace title management.',
    openBoards: 'Back to boards',
    superAdminBadge: 'Super admin',
    readOnlyBadge: 'Board data read-only',
    coverage: {
      complete: 'Complete',
      incomplete: 'Needs locales'
    },
    filters: {
      searchLabel: 'Search portfolio',
      searchPlaceholder: 'Search by workspace, board, or locale',
      applyAction: 'Apply',
      clearAction: 'Clear',
      resultsLabel: '{count} matching boards'
    },
    summary: {
      heading: 'Summary',
      description: 'Portfolio totals are rendered from a dedicated server-side summary read model.',
      workspacesLabel: 'Workspaces',
      boardsLabel: 'Boards',
      cardsLabel: 'Cards',
      cardsMissingRequiredLocalesLabel: 'Cards missing required locales',
      openLocaleRequestCountLabel: 'Open locale requests',
      awaitingHumanVerificationCountLabel: 'Awaiting human verification',
      agentProposalCountLabel: 'Agent proposals'
    },
    directory: {
      heading: 'Board directory',
      description: 'Cross-workspace board summaries are listed here without exposing full editable board payloads.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      localeCoverageColumnLabel: 'Locale coverage',
      keyCountsColumnLabel: 'Key counts',
      actionsColumnLabel: 'Actions',
      workspaceLabel: 'Workspace',
      workspaceIdLabel: 'Workspace ID',
      boardIdLabel: 'Board ID',
      sourceLocaleLabel: 'Source locale',
      defaultLocaleLabel: 'Default locale',
      supportedLocalesLabel: 'Supported locales',
      requiredLocalesLabel: 'Required locales',
      cardCountLabel: 'Cards',
      cardsMissingRequiredLocalesLabel: 'Cards missing required locales',
      openLocaleRequestCountLabel: 'Open locale requests',
      awaitingHumanVerificationCountLabel: 'Awaiting human verification',
      agentProposalCountLabel: 'Agent proposals',
      openBoardAction: 'Open board',
      boardCreatedAtLabel: 'Board created',
      boardUpdatedAtLabel: 'Board updated',
      workspaceUpdatedAtLabel: 'Workspace updated',
      oldestMissingRequiredLocaleUpdatedAtLabel: 'Oldest missing required locale',
      oldestOpenLocaleRequestAtLabel: 'Oldest open locale request',
      oldestAwaitingHumanVerificationAtLabel: 'Oldest awaiting human verification',
      oldestAgentProposalAtLabel: 'Oldest agent proposal',
      emptyFiltered: {
        heading: 'No boards match this search',
        description: 'Try another workspace, board, or locale term.'
      }
    },
    workspaceTitleEditor: {
      createAction: 'Create workspace',
      createHeading: 'Create workspace',
      assignAction: 'Assign title',
      editAction: 'Edit title',
      assignHeading: 'Assign workspace title',
      editHeading: 'Edit workspace title',
      fieldLabel: 'Workspace title',
      createPlaceholder: 'Leave blank to use the default workspace name',
      createHelp: 'Blank titles use your display name plus the next sequence number.',
      placeholder: 'Leave blank to show the workspace ID',
      help: 'Clear the title to fall back to the workspace ID.',
      creatingAction: 'Creating...',
      savingAction: 'Saving...',
      savedStatus: 'Workspace title saved.'
    },
    boardSelfRole: {
      fieldLabel: 'My role on this board',
      selectPlaceholder: 'Choose role',
      saveAction: 'Save role',
      savingAction: 'Saving...',
      savedStatus: '{board}: role saved as {role}.',
      openBoardHelp: 'Assign yourself a role to open this board.',
      requiredError: 'Choose a role before saving.'
    },
    awaitingApproval: {
      heading: 'Awaiting approval',
      description: 'AI-origin localized variants that already need human verification are listed across boards here.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      cardColumnLabel: 'Card',
      localeColumnLabel: 'Locale',
      stateColumnLabel: 'State',
      verificationRequestedAtColumnLabel: 'Verification requested',
      actionsColumnLabel: 'Actions',
      openBoardAction: 'Open board',
      empty: {
        heading: 'No items awaiting approval',
        description: 'Nothing currently needs human verification.'
      },
      emptyFiltered: {
        heading: 'No approval items match this search',
        description: 'Try another workspace, board, card, or locale term.'
      }
    },
    agentProposals: {
      heading: 'Agent proposals',
      description: 'AI-origin localized variants without a human verification request yet are listed here.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      cardColumnLabel: 'Card',
      localeColumnLabel: 'Locale',
      stateColumnLabel: 'State',
      proposedAtColumnLabel: 'Proposed',
      actionsColumnLabel: 'Actions',
      openBoardAction: 'Open board',
      empty: {
        heading: 'No agent proposals',
        description: 'Nothing is waiting in the AI-origin proposal state right now.'
      },
      emptyFiltered: {
        heading: 'No proposals match this search',
        description: 'Try another workspace, board, card, or locale term.'
      }
    },
    missingRequiredLocalizations: {
      heading: 'Missing required localizations',
      description: 'Cards still missing one or more required locales are listed across boards here.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      cardColumnLabel: 'Card',
      missingLocalesColumnLabel: 'Missing locales',
      updatedAtColumnLabel: 'Card updated',
      actionsColumnLabel: 'Actions',
      openBoardAction: 'Open board',
      empty: {
        heading: 'No missing required localizations',
        description: 'Every required locale currently has card content.'
      },
      emptyFiltered: {
        heading: 'No missing-localization items match this search',
        description: 'Try another workspace, board, card, or locale term.'
      }
    },
    incompleteCoverage: {
      heading: 'Incomplete locale coverage',
      description: 'Boards with one or more cards still missing required locales are listed here.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      statusColumnLabel: 'Coverage status',
      cardsMissingRequiredLocalesColumnLabel: 'Cards missing required locales',
      oldestMissingRequiredLocaleUpdatedAtColumnLabel: 'Oldest missing required locale',
      actionsColumnLabel: 'Actions',
      openBoardAction: 'Open board',
      empty: {
        heading: 'No boards have incomplete locale coverage',
        description: 'Every board currently satisfies its required-locale policy.'
      },
      emptyFiltered: {
        heading: 'No incomplete-coverage boards match this search',
        description: 'Try another workspace, board, or locale term.'
      }
    },
    aging: {
      heading: 'Aging and bottlenecks',
      description: 'Boards are sorted here by the oldest pending signals already tracked in the current data model.',
      workspaceColumnLabel: 'Workspace',
      boardColumnLabel: 'Board',
      actionsColumnLabel: 'Actions',
      openBoardAction: 'Open board',
      awaitingApproval: {
        heading: 'Oldest awaiting approval',
        description: 'Boards ordered by their oldest human-verification request.',
        countColumnLabel: 'Awaiting approval',
        timestampColumnLabel: 'Oldest awaiting approval',
        empty: {
          heading: 'No awaiting-approval backlog',
          description: 'No boards currently have items waiting for human verification.'
        }
      },
      openLocaleRequests: {
        heading: 'Oldest open locale requests',
        description: 'Boards ordered by their oldest open locale request.',
        countColumnLabel: 'Open locale requests',
        timestampColumnLabel: 'Oldest open locale request',
        empty: {
          heading: 'No open locale-request backlog',
          description: 'No boards currently have open locale requests.'
        }
      },
      missingRequiredLocales: {
        heading: 'Oldest missing required locales',
        description: 'Boards ordered by the oldest card still missing one or more required locales.',
        countColumnLabel: 'Cards missing required locales',
        timestampColumnLabel: 'Oldest missing required locale',
        empty: {
          heading: 'No missing-required-locale backlog',
          description: 'No boards currently have cards missing required locales.'
        }
      }
    },
    empty: {
      heading: 'No portfolio data yet',
      description: 'No workspace summaries are available yet.'
    }
  },
  workspace: {
    viewerSignedIn: 'Signed in',
    boardOptions: 'Boards',
    openPortfolio: 'Portfolio',
    profileOptions: 'Profile',
    addCard: 'Add Card',
    detailsLabel: 'Details',
    updatedLabel: 'Updated',
    cardCount: '{count} cards',
    fallbackBoardTitle: 'board',
    noVisibleBoardsTitle: 'No visible boards',
    noVisibleBoardsDescription: 'This workspace no longer has any boards you can open.',
    boardInvitePendingNotice: 'This board is shared with you. Open Collaborators to accept or decline the invite.',
    status: {
      loadUnavailable: 'Unable to load this workspace.',
      moveUnavailable: 'Unable to move card.',
      copyCardDetailsUnavailable: 'Could not copy card details'
    },
    view: {
      noDetails: 'No details added.'
    },
    announcements: {
      columnCollapsed: '{column} collapsed.',
      columnExpanded: '{column} expanded.',
      switchedBoard: 'Switched to {title}.',
      boardRenamed: 'Board renamed.',
      boardUpdated: 'Board saved.',
      boardCreated: 'Board created.',
      inviteSent: 'Invite sent.',
      inviteRevoked: 'Invite revoked.',
      inviteAccepted: 'Invite accepted.',
      inviteDeclined: 'Invite declined.',
      memberRoleUpdated: 'Member role updated.',
      memberRemoved: 'Member removed.',
      returnedHomeWorkspace: 'Returned to your home workspace.',
      cardUpdated: 'Card updated.',
      cardCreated: 'Card created.',
      localizedContentUpdated: 'Localized content updated.',
      localizationGenerated: 'Localization generated.',
      localeDiscarded: 'Localized content discarded.',
      localeRequested: 'Locale requested.',
      localeRequestCleared: 'Locale request cleared.',
      humanVerificationRequested: 'Human verification requested.',
      localeVerified: 'Localization verified.',
      cardDetailsCopied: 'Card details copied',
      stagePromptRunSucceeded: 'Prompt run completed.',
      movedCard: 'Moved card to {column}.',
      cardDeleted: 'Card deleted.',
      boardDeleted: 'Board deleted.',
      boardReset: 'Board reset.'
    },
    cardPromptRunButton: 'Run prompt',
    confirmations: {
      deleteBoardTitle: 'Delete board?',
      deleteBoardMessage: 'This action cannot be undone. "{title}" will be removed permanently.',
      deleteBoardConfirm: 'Delete board',
      resetBoardTitle: 'Reset board?',
      resetBoardMessage: 'This will clear all cards from "{title}" and keep the board itself.',
      resetBoardConfirm: 'Reset board',
      deleteCardTitle: 'Delete card?',
      deleteCardMessage: 'This action cannot be undone. "{title}" will be removed permanently.',
      deleteCardConfirm: 'Delete',
      discardLocaleTitle: 'Discard localized content?',
      discardLocaleMessage: 'This action cannot be undone. The {locale} localization for "{title}" will be removed.',
      discardLocaleConfirm: 'Discard localization'
    },
    columns: {
      backlog: 'Backlog',
      doing: 'Doing',
      done: 'Done',
      archived: 'Archived'
    },
    priorities: {
      urgent: 'Urgent',
      important: 'Important',
      normal: 'Normal'
    }
  },
  cardItem: {
    editAriaLabel: 'Edit card',
    viewAriaLabel: 'View card'
  },
  boardOptionsDialog: {
    sectionLabel: 'Boards',
    heading: 'Board options',
    switchBoardLabel: 'Switch board',
    invitesHeading: 'Pending workspace invites',
    inviteContext: 'Workspace: {workspace}. From {inviter}',
    inviteFrom: 'From {inviter}',
    inviteRole: 'Role: {role}',
    acceptInvite: 'Accept',
    declineInvite: 'Reject',
    boardTitlePlaceholder: 'Board title',
    activeStatePlaceholder: 'Active',
    switchButton: 'Switch',
    acceptInviteButton: 'Accept invite',
    declineInviteButton: 'Decline invite',
    newBoard: 'New Board',
    collaboratorsButton: 'Collaborators',
    editBoard: 'Edit Board',
    resetBoard: 'Reset Board',
    deleteBoard: 'Delete Board',
    summaryActive: 'Active board: {title}',
    currentRoleSummary: 'Your access: {role}',
    pendingInvitesSummary: '{count} pending invites',
    noVisibleBoards: 'No visible boards in this workspace.',
    stateActive: 'Active board',
    stateAvailable: 'Available',
    homeWorkspaceLabel: 'Home workspace'
  },
  profileOptionsDialog: {
    sectionLabel: 'Profile',
    heading: 'Profile options'
  },
  collaborators: {
    sectionLabel: 'Collaboration',
    heading: 'Collaborators · {title}',
    currentRoleValue: 'Current role: {role}',
    inviteHeading: 'Invite member',
    inviteHelp: 'Admins can invite people by email and set their starting role.',
    inviteEmailLabel: 'Invite email',
    inviteRoleLabel: 'Invite role',
    inviteSubmit: 'Send invite',
    membersHeading: 'Members',
    pendingHeading: 'Pending invites',
    pendingStatus: 'Pending',
    revokeInvite: 'Revoke invite',
    removeMember: 'Remove member',
    acceptInvite: 'Accept invite',
    declineInvite: 'Decline invite',
    roles: {
      admin: 'Admin',
      editor: 'Editor',
      viewer: 'Viewer',
      invited: 'Pending invite',
      none: 'No board role'
    }
  },
  cardEditor: {
    newHeading: 'New card',
    editHeading: 'Edit card',
    viewHeading: 'View card',
    titleLabel: 'Title',
    titlePlaceholder: 'What needs doing?',
    detailsLabel: 'Details',
    detailsPlaceholder: 'Optional context, notes, or next steps.',
    localeSectionLabel: 'Localized content',
    localeLabel: 'Locale',
    selectedLocaleValue: 'Viewing: {locale}',
    viewingLocaleValue: 'Viewing locale: {locale}',
    renderedLocaleValue: 'Rendered from: {locale}',
    selectedLocaleMissing: 'Missing in selected locale',
    noLocalizedContent: 'No localized content is available for this card.',
    localizedContentSummary: '{presentCount} present · {requestedCount} requested · {missingCount} missing',
    localeFallbackNotice: '{selectedLocale} is missing. Showing {renderedLocale} instead.',
    localeFallbackLegacyNotice: '{selectedLocale} is missing. Showing legacy card content from {renderedLocale}.',
    editingLocaleValue: 'Editing locale: {locale}',
    missingLocaleValue: 'Missing locale: {locale}',
    requestedLocaleValue: 'Requested locale: {locale}',
    generateLocaleButton: 'Generate localization',
    generatingLocaleButton: 'Generating localization...',
    generateLocaleHelp: 'Uses this board\'s AI localization settings.',
    manualLocaleHelp: 'You can write and save this locale manually, even without AI localization configured.',
    discardLocaleButton: 'Discard localization',
    generateLocaleBlockedReadOnly: 'Only editors can generate localizations.',
    generateLocaleBlockedNoAiKey: 'This board does not have AI localization configured.',
    generateLocaleBlockedSourceLocale: 'The source locale must be written by hand.',
    generateLocaleBlockedAlreadyPresent: 'Localized content already exists for this locale.',
    requestLocaleButton: 'Request locale',
    clearLocaleRequestButton: 'Clear locale request',
    verifyLocaleButton: 'Verify',
    reviewState: {
      ai: 'AI',
      'needs-human-verification': 'Needs human verification',
      verified: 'Verified'
    },
    localeReadOnlyNotice: 'This localized card view is read-only.',
    viewerReadOnlyNotice:
      'Viewers can inspect localized content and request human verification, but cannot edit or verify it.',
    priorityLabel: 'Priority',
    priorityGroupAriaLabel: 'Priority',
    statusLabel: 'Task Status',
    deleteButton: 'Delete',
    saveButton: 'Save Card',
    moveStateCurrent: 'Current',
    moveStateSelected: 'Selected',
    markdownToolbar: {
      bold: {
        text: 'B',
        label: 'Bold'
      },
      italic: {
        text: 'I',
        label: 'Italic'
      },
      heading: {
        text: 'H',
        label: 'Heading 2'
      },
      quote: 'Quote',
      bullets: {
        text: '•',
        label: 'Bulleted list'
      },
      numbers: 'Numbers',
      code: {
        text: 'Code',
        label: 'Code'
      },
      link: 'Link',
      preview: 'Preview'
    }
  },
  cardViewDialog: {
    titlePlaceholder: 'Card title',
    copyButton: 'Copy card details',
    editButton: 'Edit',
    detailsLabel: 'Details',
    updatedLabel: 'Updated',
    requestHumanVerificationButton: 'Request human verification',
    copyFields: {
      title: 'Title',
      locale: 'Locale',
      stage: 'Stage',
      priority: 'Priority',
      cardId: 'Card ID'
    },
    reviewState: {
      ai: 'AI',
      'needs-human-verification': 'Needs human verification',
      verified: 'Verified'
    }
  },
  boardEditor: {
    newHeading: 'New board',
    editHeading: 'Edit board',
    titleLabel: 'Board title',
    titlePlaceholder: 'What board is this for?',
    languagePolicyLabel: 'Language policy',
    languagePolicyHelp: 'Use canonical locales. Source and default must both appear in supported locales.',
    sourceLocaleLabel: 'Source locale',
    defaultLocaleLabel: 'Default locale',
    supportedLocalesLabel: 'Supported locales',
    requiredLocalesLabel: 'Required locales',
    aiLocalizationLabel: 'AI localization',
    aiLocalizationHelp: 'OpenAI is the only provider for v1. Leave the API key blank to keep the current saved key. Enter a new key to replace it, or check the clear option to remove it.',
    aiProviderLabel: 'Provider',
    openAiApiKeyLabel: 'OpenAI API key',
    openAiApiKeyHelp: 'The full key is never rendered back to the browser after saving.',
    openAiApiKeySaved: 'A saved OpenAI API key already exists for this board.',
    openAiApiKeySavedWithLast4: 'A saved OpenAI API key already exists for this board. Last 4: {last4}.',
    localizationGlossaryLabel: 'Terms of art',
    localizationGlossaryHelp:
      'One line per term: Source term | locale=value | locale=value. Example: Omen of Sorrow | es=Omen of Sorrow',
    clearOpenAiApiKeyLabel: 'Clear the saved OpenAI API key',
    stagesLabel: 'Stages',
    stagesHelp:
      'One line per stage: stage-id | Display title | target-a, target-b | action-a, action-b. Example: backlog | Backlog | doing, done | card.create',
    stageSummaryLabel: 'Current draft',
    stageSummaryEmpty: 'No stages configured.',
    stageSummaryValue: '{count} stages · {stages}',
    configureStagesButton: 'Configure stages',
    saveButton: 'Save Board',
    createButton: 'Create Board',
    deleteButton: 'Delete Board'
  },
  boardStageConfigDialog: {
    sectionLabel: 'Stages',
    heading: 'Configure stages',
    help:
      'Use one line per stage: stage-id | Title | target-a, target-b | action-a, action-b. You can omit the third or fourth segment, and leave transitions empty before actions when needed.',
    definitionsLabel: 'Stage definitions',
    promptActionSectionLabel: 'Prompt actions',
    promptActionEnableLabel: 'Enable prompt run',
    promptActionPromptLabel: 'Prompt',
    promptActionPromptPlaceholder: 'Turn this card into a new implementation task.',
    promptActionTargetStageLabel: 'Target stage',
    promptActionHelp: 'Use the stage prompt plus the source card content to create a new card in the selected target stage.',
    promptActionRequiresActionHelp:
      'Add "card.prompt.run" to the stage action list above before configuring this prompt action.',
    promptActionUncheckedHelp:
      'This prompt action will be removed from the stage when you apply these changes.',
    applyButton: 'Apply stages'
  },
  confirmDialog: {
    deleteCardTitle: 'Delete card?',
    deleteCardMessage: 'This action cannot be undone.'
  },
  errors: {
    genericUnexpected: 'Something went wrong.',
    authOriginNotAllowed: 'Sign-in request origin is not allowed.',
    googleCredentialRequired: 'Google credential is required.',
    googleCredentialVerifyFailed: 'Unable to verify the Google credential.',
    googleAccessDenied: 'This Google account is not enabled for private testing.',
    signInUnavailable: 'Unable to sign in with Google.',
    signOutUnavailable: 'Unable to sign out.',
    authenticationRequired: 'Authentication required.',
    boardTitleRequired: 'Board title is required.',
    boardLanguagePolicyInvalid: 'Board language policy is invalid.',
    boardStagesRequired: 'Add at least one stage.',
    boardStageDefinitionFormatInvalid:
      'Each stage must use "stage-id | Title", "stage-id | Title | target-a, target-b", or "stage-id | Title | target-a, target-b | action-a, action-b".',
    boardStageIdInvalid: 'Stage ids must use lowercase slugs.',
    boardStageIdsUnique: 'Stage ids must be unique.',
    boardStageTitleRequired: 'Each stage needs a title.',
    boardTransitionsInvalid: 'Stage transitions must use stage ids.',
    boardTransitionsMissingTarget: 'Stage transitions must point to existing stages.',
    boardStageActionsInvalid: 'Stage actions must use known action ids.',
    boardStageActionIdsUnique: 'Stage action ids must be unique.',
    boardStagePromptActionRequired: 'Stages with prompt runs need a prompt action configuration.',
    boardStagePromptActionRequiresActionId: 'Prompt actions require the card.prompt.run action id.',
    boardStagePromptActionInvalid: 'Stage prompt action settings are invalid.',
    boardStagePromptActionEnabledRequired: 'Enabled prompt actions must be stored as enabled.',
    boardStagePromptActionPromptRequired: 'Prompt-enabled stages need a prompt.',
    boardStagePromptActionTargetRequired: 'Prompt-enabled stages need a target stage.',
    boardStagePromptActionTargetMissing: 'Prompt actions must target an existing stage.',
    boardStagePromptActionJsonInvalid: 'Prompt action draft data is invalid.',
    boardStagePromptActionStageMissing: 'Prompt action draft data must reference current stages.',
    boardTemplateIdRequired: 'Each template needs an id.',
    boardTemplateIdsUnique: 'Template ids must be unique.',
    boardTemplateTitleRequired: 'Each template needs a title.',
    boardTemplateInitialStageInvalid: 'Template initial stages must point to existing stages.',
    boardStageHasCards: 'Move cards out of a stage before removing it.',
    boardSourceLocaleMissingOnCards: 'Existing cards must already include the new source locale.',
    boardLocalizationGlossaryInvalid: 'Terms of art must use "Source term | locale=value | locale=value".',
    boardLocalizationGlossarySourceRequired: 'Each term of art needs a source term.',
    boardLocalizationGlossarySourcesUnique: 'Terms of art must be unique.',
    boardLocalizationGlossaryTranslationsRequired: 'Each term of art needs at least one translation.',
    boardLocalizationGlossaryLocalesInvalid: 'Terms of art translations must use supported locale ids.',
    boardOpenAiKeyMissing: 'This board does not have AI localization configured.',
    boardOpenAiKeyUnavailable: 'The saved AI localization settings are unavailable.',
    cardTitleRequired: 'Card title is required.',
    cardCreateStageUnavailable: 'Cards can only be created in create-enabled stages.',
    cardDeleteStageUnavailable: 'Cards can only be deleted in delete-enabled stages.',
    cannotDeleteLastBoard: 'Cannot delete the last remaining board.',
    boardNotFound: 'Board not found.',
    cardNotFound: 'Card not found.',
    cardNotInSourceColumn: 'Card is not in the source column.',
    boardReadPermissionDenied: 'You can view this board, but interactive board controls are unavailable until you join it.',
    boardEditPermissionDenied: 'You do not have permission to edit this board.',
    boardAdminPermissionDenied: 'You do not have permission to manage this board.',
    inviteResponsePermissionDenied: 'You do not have permission to respond to this invite.',
    targetLocaleUnsupported: 'This locale is not supported on this board.',
    sourceLocaleMissing: 'Source locale content is required before generating a localization.',
    localizationHumanAuthoredConflict: 'Cannot overwrite human-authored localization with AI-generated content.',
    localizationAlreadyPresent: 'Localized content already exists for this locale.',
    localizationGenerateFailed: 'Unable to generate localization right now.',
    stagePromptActionDisabled: 'This stage does not allow prompt runs.',
    stagePromptActionConfigMissing: 'This stage needs a valid prompt action configuration first.',
    stagePromptRunFailed: 'Unable to run the stage prompt right now.',
    workspaceConflict: 'This workspace changed elsewhere. Refresh to continue.',
    requestUnavailable: 'Unable to complete the request.'
  }
});

const ES_CL_MESSAGES = freezeCatalog({
  common: {
    appTitle: '過程 (katei)',
    close: 'Cerrar',
    save: 'Guardar',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    logout: 'Cerrar sesión',
    switch: 'Cambiar',
    welcomeUser: 'Bienvenido, {name}.'
  },
  pageTitles: {
    landing: '{appTitle} · Iniciar sesión',
    workspace: '{appTitle} · Tableros',
    portfolio: '{appTitle} · Portafolio'
  },
  landing: {
    eyebrow: 'Vista previa privada para testers',
    description:
      'Katei mantiene tus tableros enfocados y táctiles. Inicia sesión con Google para abrir tu espacio privado de prueba.',
    authTitle: 'Entra a tus tableros',
    authDescription:
      'Google confirma quién eres. Katei verifica esa identidad y luego abre tu espacio de tableros con su propia sesión privada.',
    loading: 'Verificando tu acceso con Google...',
    status: {
      googleUnavailable: 'El acceso con Google no está disponible en este momento.',
      missingClientId: 'Falta el client ID de Google.',
      gisDidNotLoad: 'Google Identity Services no se cargó.',
      initOriginUnavailable: 'No se pudo inicializar el acceso con Google para este origen.',
      buttonNotRenderedDetailed:
        'No se renderizó el botón de acceso con Google. Revisa los orígenes de JavaScript permitidos para este client ID.',
      buttonNotRendered: 'No se pudo renderizar el botón de acceso con Google.',
      missingCredential: 'El acceso con Google no devolvió una credencial.'
    }
  },
  session: {
    logoutConfirmTitle: '¿Cerrar sesión?',
    logoutConfirmMessage: 'Se cerrará tu sesión de Katei en este dispositivo.',
    signingOut: 'Cerrando sesión...',
    signOutUnavailable: 'No se pudo cerrar sesión en este momento.'
  },
  uiLocale: {
    label: 'Idioma de la interfaz'
  },
  portfolio: {
    eyebrow: 'Portafolio de super admin',
    title: 'Portafolio',
    description:
      'Una superficie dedicada para super admins con resúmenes de portafolio entre espacios y gestión de títulos de espacio.',
    openBoards: 'Volver a tableros',
    superAdminBadge: 'Super admin',
    readOnlyBadge: 'Datos de tableros en solo lectura',
    coverage: {
      complete: 'Completo',
      incomplete: 'Faltan locales'
    },
    filters: {
      searchLabel: 'Buscar en portafolio',
      searchPlaceholder: 'Busca por espacio, tablero o locale',
      applyAction: 'Aplicar',
      clearAction: 'Limpiar',
      resultsLabel: '{count} tableros coincidentes'
    },
    summary: {
      heading: 'Resumen',
      description: 'Los totales del portafolio se renderizan desde un read model resumido dedicado del servidor.',
      workspacesLabel: 'Espacios',
      boardsLabel: 'Tableros',
      cardsLabel: 'Tarjetas',
      cardsMissingRequiredLocalesLabel: 'Tarjetas con locales requeridos faltantes',
      openLocaleRequestCountLabel: 'Solicitudes de locale abiertas',
      awaitingHumanVerificationCountLabel: 'Esperando verificación humana',
      agentProposalCountLabel: 'Propuestas de agente'
    },
    directory: {
      heading: 'Directorio de tableros',
      description: 'Aquí se listan resúmenes de tableros entre espacios sin exponer payloads editables completos.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      localeCoverageColumnLabel: 'Cobertura de locales',
      keyCountsColumnLabel: 'Conteos clave',
      actionsColumnLabel: 'Acciones',
      workspaceLabel: 'Espacio',
      workspaceIdLabel: 'ID del espacio',
      boardIdLabel: 'ID del tablero',
      sourceLocaleLabel: 'Locale fuente',
      defaultLocaleLabel: 'Locale por defecto',
      supportedLocalesLabel: 'Locales soportados',
      requiredLocalesLabel: 'Locales requeridos',
      cardCountLabel: 'Tarjetas',
      cardsMissingRequiredLocalesLabel: 'Tarjetas con locales requeridos faltantes',
      openLocaleRequestCountLabel: 'Solicitudes de locale abiertas',
      awaitingHumanVerificationCountLabel: 'Esperando verificación humana',
      agentProposalCountLabel: 'Propuestas de agente',
      openBoardAction: 'Abrir tablero',
      boardCreatedAtLabel: 'Tablero creado',
      boardUpdatedAtLabel: 'Tablero actualizado',
      workspaceUpdatedAtLabel: 'Espacio actualizado',
      oldestMissingRequiredLocaleUpdatedAtLabel: 'Falta más antigua de locale requerido',
      oldestOpenLocaleRequestAtLabel: 'Solicitud de locale abierta más antigua',
      oldestAwaitingHumanVerificationAtLabel: 'Espera más antigua de verificación humana',
      oldestAgentProposalAtLabel: 'Propuesta de agente más antigua',
      emptyFiltered: {
        heading: 'Ningún tablero coincide con esta búsqueda',
        description: 'Prueba con otro espacio, tablero o término de locale.'
      }
    },
    workspaceTitleEditor: {
      createAction: 'Crear espacio',
      createHeading: 'Crear espacio',
      assignAction: 'Asignar título',
      editAction: 'Editar título',
      assignHeading: 'Asignar título del espacio',
      editHeading: 'Editar título del espacio',
      fieldLabel: 'Título del espacio',
      createPlaceholder: 'Déjalo vacío para usar el nombre predeterminado del espacio',
      createHelp: 'Los títulos vacíos usan tu nombre visible más el siguiente número de secuencia.',
      placeholder: 'Déjalo vacío para mostrar el ID del espacio',
      help: 'Borra el título para volver a usar el ID del espacio.',
      creatingAction: 'Creando...',
      savingAction: 'Guardando...',
      savedStatus: 'Título del espacio guardado.'
    },
    boardSelfRole: {
      fieldLabel: 'Mi rol en este tablero',
      selectPlaceholder: 'Elige un rol',
      saveAction: 'Guardar rol',
      savingAction: 'Guardando...',
      savedStatus: '{board}: rol guardado como {role}.',
      openBoardHelp: 'Asígnate un rol para abrir este tablero.',
      requiredError: 'Elige un rol antes de guardar.'
    },
    awaitingApproval: {
      heading: 'Esperando aprobación',
      description: 'Aquí se listan entre tableros las variantes localizadas de origen IA que ya necesitan verificación humana.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      cardColumnLabel: 'Tarjeta',
      localeColumnLabel: 'Locale',
      stateColumnLabel: 'Estado',
      verificationRequestedAtColumnLabel: 'Verificación solicitada',
      actionsColumnLabel: 'Acciones',
      openBoardAction: 'Abrir tablero',
      empty: {
        heading: 'No hay elementos esperando aprobación',
        description: 'Actualmente nada necesita verificación humana.'
      },
      emptyFiltered: {
        heading: 'Ningún elemento de aprobación coincide con esta búsqueda',
        description: 'Prueba con otro espacio, tablero, tarjeta o término de locale.'
      }
    },
    agentProposals: {
      heading: 'Propuestas de agente',
      description: 'Aquí se listan las variantes localizadas de origen IA que todavía no tienen solicitud de verificación humana.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      cardColumnLabel: 'Tarjeta',
      localeColumnLabel: 'Locale',
      stateColumnLabel: 'Estado',
      proposedAtColumnLabel: 'Propuesta',
      actionsColumnLabel: 'Acciones',
      openBoardAction: 'Abrir tablero',
      empty: {
        heading: 'No hay propuestas de agente',
        description: 'Ahora mismo no hay nada esperando en el estado de propuesta de origen IA.'
      },
      emptyFiltered: {
        heading: 'Ninguna propuesta coincide con esta búsqueda',
        description: 'Prueba con otro espacio, tablero, tarjeta o término de locale.'
      }
    },
    missingRequiredLocalizations: {
      heading: 'Localizaciones requeridas faltantes',
      description: 'Aquí se listan entre tableros las tarjetas a las que todavía les falta uno o más locales requeridos.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      cardColumnLabel: 'Tarjeta',
      missingLocalesColumnLabel: 'Locales faltantes',
      updatedAtColumnLabel: 'Tarjeta actualizada',
      actionsColumnLabel: 'Acciones',
      openBoardAction: 'Abrir tablero',
      empty: {
        heading: 'No faltan localizaciones requeridas',
        description: 'Cada locale requerido ya tiene contenido de tarjeta.'
      },
      emptyFiltered: {
        heading: 'Ningún elemento con localización faltante coincide con esta búsqueda',
        description: 'Prueba con otro espacio, tablero, tarjeta o término de locale.'
      }
    },
    incompleteCoverage: {
      heading: 'Cobertura de locales incompleta',
      description: 'Aquí se listan los tableros que todavía tienen una o más tarjetas con locales requeridos faltantes.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      statusColumnLabel: 'Estado de cobertura',
      cardsMissingRequiredLocalesColumnLabel: 'Tarjetas con locales requeridos faltantes',
      oldestMissingRequiredLocaleUpdatedAtColumnLabel: 'Falta más antigua de locale requerido',
      actionsColumnLabel: 'Acciones',
      openBoardAction: 'Abrir tablero',
      empty: {
        heading: 'Ningún tablero tiene cobertura incompleta',
        description: 'Cada tablero cumple actualmente su política de locales requeridos.'
      },
      emptyFiltered: {
        heading: 'Ningún tablero con cobertura incompleta coincide con esta búsqueda',
        description: 'Prueba con otro espacio, tablero o término de locale.'
      }
    },
    aging: {
      heading: 'Antigüedad y cuellos de botella',
      description: 'Aquí se ordenan los tableros según las señales pendientes más antiguas que ya existen en el modelo actual.',
      workspaceColumnLabel: 'Espacio',
      boardColumnLabel: 'Tablero',
      actionsColumnLabel: 'Acciones',
      openBoardAction: 'Abrir tablero',
      awaitingApproval: {
        heading: 'Espera de aprobación más antigua',
        description: 'Tableros ordenados por su solicitud más antigua de verificación humana.',
        countColumnLabel: 'Esperando aprobación',
        timestampColumnLabel: 'Espera de aprobación más antigua',
        empty: {
          heading: 'No hay backlog esperando aprobación',
          description: 'Actualmente ningún tablero tiene elementos esperando verificación humana.'
        }
      },
      openLocaleRequests: {
        heading: 'Solicitudes de locale abiertas más antiguas',
        description: 'Tableros ordenados por su solicitud abierta de locale más antigua.',
        countColumnLabel: 'Solicitudes de locale abiertas',
        timestampColumnLabel: 'Solicitud de locale abierta más antigua',
        empty: {
          heading: 'No hay backlog de solicitudes de locale abiertas',
          description: 'Actualmente ningún tablero tiene solicitudes de locale abiertas.'
        }
      },
      missingRequiredLocales: {
        heading: 'Locales requeridos faltantes más antiguos',
        description: 'Tableros ordenados por la tarjeta más antigua que todavía tiene uno o más locales requeridos faltantes.',
        countColumnLabel: 'Tarjetas con locales requeridos faltantes',
        timestampColumnLabel: 'Falta más antigua de locale requerido',
        empty: {
          heading: 'No hay backlog de locales requeridos faltantes',
          description: 'Actualmente ningún tablero tiene tarjetas con locales requeridos faltantes.'
        }
      }
    },
    empty: {
      heading: 'Todavía no hay datos de portafolio',
      description: 'Todavía no hay resúmenes de espacios disponibles.'
    }
  },
  workspace: {
    viewerSignedIn: 'Sesión iniciada',
    boardOptions: 'Tableros',
    openPortfolio: 'Portafolio',
    profileOptions: 'Perfil',
    addCard: 'Agregar tarjeta',
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado',
    cardCount: '{count} tarjetas',
    fallbackBoardTitle: 'tablero',
    noVisibleBoardsTitle: 'No hay tableros visibles',
    noVisibleBoardsDescription: 'Este espacio de trabajo ya no tiene tableros que puedas abrir.',
    boardInvitePendingNotice: 'Este tablero fue compartido contigo. Abre Colaboradores para aceptar o rechazar la invitación.',
    status: {
      loadUnavailable: 'No se pudo cargar este espacio de trabajo.',
      moveUnavailable: 'No se pudo mover la tarjeta.',
      copyCardDetailsUnavailable: 'No se pudieron copiar los detalles de la tarjeta'
    },
    view: {
      noDetails: 'No se agregaron detalles.'
    },
    announcements: {
      columnCollapsed: '{column} colapsada.',
      columnExpanded: '{column} expandida.',
      switchedBoard: 'Cambiaste a {title}.',
      boardRenamed: 'Tablero renombrado.',
      boardUpdated: 'Tablero guardado.',
      boardCreated: 'Tablero creado.',
      inviteSent: 'Invitación enviada.',
      inviteRevoked: 'Invitación revocada.',
      inviteAccepted: 'Invitación aceptada.',
      inviteDeclined: 'Invitación rechazada.',
      memberRoleUpdated: 'Rol actualizado.',
      memberRemoved: 'Miembro eliminado.',
      returnedHomeWorkspace: 'Volviste a tu espacio principal.',
      cardUpdated: 'Tarjeta actualizada.',
      cardCreated: 'Tarjeta creada.',
      localizedContentUpdated: 'Contenido localizado actualizado.',
      localizationGenerated: 'Localización generada.',
      localeDiscarded: 'Contenido localizado descartado.',
      localeRequested: 'Locale solicitado.',
      localeRequestCleared: 'Solicitud de locale eliminada.',
      humanVerificationRequested: 'Se solicitó verificación humana.',
      localeVerified: 'Localización verificada.',
      cardDetailsCopied: 'Detalles de la tarjeta copiados',
      stagePromptRunSucceeded: 'La ejecución del prompt terminó.',
      movedCard: 'Tarjeta movida a {column}.',
      cardDeleted: 'Tarjeta eliminada.',
      boardDeleted: 'Tablero eliminado.',
      boardReset: 'Tablero reiniciado.'
    },
    cardPromptRunButton: 'Ejecutar prompt',
    confirmations: {
      deleteBoardTitle: '¿Eliminar tablero?',
      deleteBoardMessage: 'Esta acción no se puede deshacer. "{title}" se eliminará permanentemente.',
      deleteBoardConfirm: 'Eliminar tablero',
      resetBoardTitle: '¿Reiniciar tablero?',
      resetBoardMessage: 'Esto eliminará todas las tarjetas de "{title}" y mantendrá el tablero.',
      resetBoardConfirm: 'Reiniciar tablero',
      deleteCardTitle: '¿Eliminar tarjeta?',
      deleteCardMessage: 'Esta acción no se puede deshacer. "{title}" se eliminará permanentemente.',
      deleteCardConfirm: 'Eliminar',
      discardLocaleTitle: '¿Descartar contenido localizado?',
      discardLocaleMessage: 'Esta acción no se puede deshacer. La localización {locale} de "{title}" se eliminará.',
      discardLocaleConfirm: 'Descartar localización'
    },
    columns: {
      backlog: 'Pendientes',
      doing: 'En curso',
      done: 'Hecho',
      archived: 'Archivado'
    },
    priorities: {
      urgent: 'Urgente',
      important: 'Importante',
      normal: 'Normal'
    }
  },
  cardItem: {
    editAriaLabel: 'Editar tarjeta',
    viewAriaLabel: 'Ver tarjeta'
  },
  boardOptionsDialog: {
    sectionLabel: 'Tableros',
    heading: 'Opciones del tablero',
    switchBoardLabel: 'Cambiar tablero',
    invitesHeading: 'Invitaciones pendientes de espacios',
    inviteContext: 'Espacio: {workspace}. De {inviter}',
    inviteFrom: 'De {inviter}',
    inviteRole: 'Rol: {role}',
    acceptInvite: 'Aceptar',
    declineInvite: 'Rechazar',
    boardTitlePlaceholder: 'Título del tablero',
    activeStatePlaceholder: 'Activo',
    switchButton: 'Cambiar',
    acceptInviteButton: 'Aceptar invitación',
    declineInviteButton: 'Rechazar invitación',
    newBoard: 'Nuevo tablero',
    collaboratorsButton: 'Colaboradores',
    editBoard: 'Editar tablero',
    resetBoard: 'Reiniciar tablero',
    deleteBoard: 'Eliminar tablero',
    summaryActive: 'Tablero activo: {title}',
    currentRoleSummary: 'Tu acceso: {role}',
    pendingInvitesSummary: '{count} invitaciones pendientes',
    noVisibleBoards: 'No hay tableros visibles en este espacio de trabajo.',
    stateActive: 'Tablero activo',
    stateAvailable: 'Disponible',
    homeWorkspaceLabel: 'Espacio personal'
  },
  profileOptionsDialog: {
    sectionLabel: 'Perfil',
    heading: 'Opciones de perfil'
  },
  collaborators: {
    sectionLabel: 'Colaboración',
    heading: 'Colaboradores · {title}',
    currentRoleValue: 'Rol actual: {role}',
    inviteHeading: 'Invitar miembro',
    inviteHelp: 'Los administradores pueden invitar por correo y definir el rol inicial.',
    inviteEmailLabel: 'Correo de invitación',
    inviteRoleLabel: 'Rol de invitación',
    inviteSubmit: 'Enviar invitación',
    membersHeading: 'Miembros',
    pendingHeading: 'Invitaciones pendientes',
    pendingStatus: 'Pendiente',
    revokeInvite: 'Revocar invitación',
    removeMember: 'Quitar miembro',
    acceptInvite: 'Aceptar invitación',
    declineInvite: 'Rechazar invitación',
    roles: {
      admin: 'Administrador',
      editor: 'Editor',
      viewer: 'Lector',
      invited: 'Invitación pendiente',
      none: 'Sin rol en el tablero'
    }
  },
  cardEditor: {
    newHeading: 'Nueva tarjeta',
    editHeading: 'Editar tarjeta',
    viewHeading: 'Ver tarjeta',
    titleLabel: 'Título',
    titlePlaceholder: '¿Qué hay que hacer?',
    detailsLabel: 'Detalles',
    detailsPlaceholder: 'Contexto, notas o próximos pasos opcionales.',
    localeSectionLabel: 'Contenido localizado',
    localeLabel: 'Locale',
    selectedLocaleValue: 'Viendo: {locale}',
    viewingLocaleValue: 'Viendo el locale: {locale}',
    renderedLocaleValue: 'Renderizado desde: {locale}',
    selectedLocaleMissing: 'Falta en el locale seleccionado',
    noLocalizedContent: 'No hay contenido localizado disponible para esta tarjeta.',
    localizedContentSummary: '{presentCount} presentes · {requestedCount} solicitados · {missingCount} faltantes',
    localeFallbackNotice: 'Falta {selectedLocale}. Se muestra {renderedLocale}.',
    localeFallbackLegacyNotice: 'Falta {selectedLocale}. Se muestra el contenido heredado de {renderedLocale}.',
    editingLocaleValue: 'Editando locale: {locale}',
    missingLocaleValue: 'Locale faltante: {locale}',
    requestedLocaleValue: 'Locale solicitado: {locale}',
    generateLocaleButton: 'Generar localización',
    generatingLocaleButton: 'Generando localización...',
    generateLocaleHelp: 'Usa la configuración de IA de este tablero para localización.',
    manualLocaleHelp: 'Puedes escribir y guardar este locale manualmente, incluso sin IA configurada para localización.',
    discardLocaleButton: 'Descartar localización',
    generateLocaleBlockedReadOnly: 'Solo quienes pueden editar pueden generar localizaciones.',
    generateLocaleBlockedNoAiKey: 'Este tablero no tiene configuración de IA para localización.',
    generateLocaleBlockedSourceLocale: 'El locale de origen debe escribirse manualmente.',
    generateLocaleBlockedAlreadyPresent: 'Ya existe contenido localizado para este locale.',
    requestLocaleButton: 'Solicitar locale',
    clearLocaleRequestButton: 'Quitar solicitud de locale',
    verifyLocaleButton: 'Verificar',
    reviewState: {
      ai: 'IA',
      'needs-human-verification': 'Necesita verificación humana',
      verified: 'Verificado'
    },
    localeReadOnlyNotice: 'Esta vista localizada es de solo lectura.',
    viewerReadOnlyNotice:
      'Los lectores pueden inspeccionar el contenido localizado y solicitar verificación humana, pero no editarlo ni verificarlo.',
    priorityLabel: 'Prioridad',
    priorityGroupAriaLabel: 'Prioridad',
    statusLabel: 'Estado de la tarea',
    deleteButton: 'Eliminar',
    saveButton: 'Guardar tarjeta',
    moveStateCurrent: 'Actual',
    moveStateSelected: 'Seleccionada',
    markdownToolbar: {
      bold: {
        text: 'B',
        label: 'Negrita'
      },
      italic: {
        text: 'I',
        label: 'Cursiva'
      },
      heading: {
        text: 'H',
        label: 'Encabezado 2'
      },
      quote: 'Cita',
      bullets: {
        text: '•',
        label: 'Lista con viñetas'
      },
      numbers: 'Números',
      code: {
        text: 'Code',
        label: 'Código'
      },
      link: 'Enlace',
      preview: 'Vista previa'
    }
  },
  cardViewDialog: {
    titlePlaceholder: 'Título de la tarjeta',
    copyButton: 'Copiar detalles de la tarjeta',
    editButton: 'Editar',
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado',
    requestHumanVerificationButton: 'Solicitar verificación humana',
    copyFields: {
      title: 'Título',
      locale: 'Locale',
      stage: 'Etapa',
      priority: 'Prioridad',
      cardId: 'ID de tarjeta'
    },
    reviewState: {
      ai: 'IA',
      'needs-human-verification': 'Necesita verificación humana',
      verified: 'Verificado'
    }
  },
  boardEditor: {
    newHeading: 'Nuevo tablero',
    editHeading: 'Editar tablero',
    titleLabel: 'Título del tablero',
    titlePlaceholder: '¿Para qué es este tablero?',
    languagePolicyLabel: 'Política de idioma',
    languagePolicyHelp: 'Usa locales canónicos. El origen y el predeterminado deben estar dentro de los locales soportados.',
    sourceLocaleLabel: 'Locale de origen',
    defaultLocaleLabel: 'Locale predeterminado',
    supportedLocalesLabel: 'Locales soportados',
    requiredLocalesLabel: 'Locales requeridos',
    aiLocalizationLabel: 'Localización con IA',
    aiLocalizationHelp: 'OpenAI es el único proveedor en esta primera versión. Deja la clave vacía para conservar la actual, escribe una nueva para reemplazarla o marca la opción para eliminarla.',
    aiProviderLabel: 'Proveedor',
    openAiApiKeyLabel: 'Clave de API de OpenAI',
    openAiApiKeyHelp: 'La clave completa nunca vuelve a mostrarse en el navegador después de guardarla.',
    openAiApiKeySaved: 'Este tablero ya tiene una clave de OpenAI guardada.',
    openAiApiKeySavedWithLast4: 'Este tablero ya tiene una clave de OpenAI guardada. Últimos 4: {last4}.',
    localizationGlossaryLabel: 'Glosario de localización',
    localizationGlossaryHelp:
      'Una línea por término: Término origen | locale=valor | locale=valor. Ejemplo: Omen of Sorrow | es=Omen of Sorrow',
    clearOpenAiApiKeyLabel: 'Eliminar la clave de OpenAI guardada',
    stagesLabel: 'Etapas',
    stagesHelp:
      'Una línea por etapa: stage-id | Título visible | destino-a, destino-b | acción-a, acción-b. Ejemplo: backlog | Backlog | doing, done | card.create',
    stageSummaryLabel: 'Borrador actual',
    stageSummaryEmpty: 'No hay etapas configuradas.',
    stageSummaryValue: '{count} etapas · {stages}',
    configureStagesButton: 'Configurar etapas',
    saveButton: 'Guardar tablero',
    createButton: 'Crear tablero',
    deleteButton: 'Eliminar tablero'
  },
  boardStageConfigDialog: {
    sectionLabel: 'Etapas',
    heading: 'Configurar etapas',
    help:
      'Usa una línea por etapa: stage-id | Título | destino-a, destino-b | acción-a, acción-b. Puedes omitir el tercer o cuarto segmento y dejar vacías las transiciones antes de las acciones cuando haga falta.',
    definitionsLabel: 'Definiciones de etapas',
    promptActionSectionLabel: 'Acciones con prompt',
    promptActionEnableLabel: 'Activar prompt',
    promptActionPromptLabel: 'Prompt',
    promptActionPromptPlaceholder: 'Convierte esta tarjeta en una nueva tarea de implementación.',
    promptActionTargetStageLabel: 'Etapa de destino',
    promptActionHelp:
      'Usa el prompt de la etapa junto con el contenido de la tarjeta de origen para crear una nueva tarjeta en la etapa seleccionada.',
    promptActionRequiresActionHelp:
      'Agrega "card.prompt.run" a la lista de acciones de la etapa para configurar esta acción.',
    promptActionUncheckedHelp:
      'Esta acción con prompt se quitará de la etapa cuando apliques estos cambios.',
    applyButton: 'Aplicar etapas'
  },
  confirmDialog: {
    deleteCardTitle: '¿Eliminar tarjeta?',
    deleteCardMessage: 'Esta acción no se puede deshacer.'
  },
  errors: {
    genericUnexpected: 'Algo salió mal.',
    authOriginNotAllowed: 'El origen de la solicitud de acceso no está permitido.',
    googleCredentialRequired: 'Se requiere la credencial de Google.',
    googleCredentialVerifyFailed: 'No se pudo verificar la credencial de Google.',
    googleAccessDenied: 'Esta cuenta de Google no está habilitada para pruebas privadas.',
    signInUnavailable: 'No se pudo iniciar sesión con Google.',
    signOutUnavailable: 'No se pudo cerrar sesión.',
    authenticationRequired: 'Se requiere autenticación.',
    boardTitleRequired: 'El título del tablero es obligatorio.',
    boardLanguagePolicyInvalid: 'La política de idioma del tablero no es válida.',
    boardStagesRequired: 'Agrega al menos una etapa.',
    boardStageDefinitionFormatInvalid:
      'Cada etapa debe usar "stage-id | Título", "stage-id | Título | destino-a, destino-b" o "stage-id | Título | destino-a, destino-b | acción-a, acción-b".',
    boardStageIdInvalid: 'Los ids de etapa deben usar slugs en minúsculas.',
    boardStageIdsUnique: 'Los ids de etapa deben ser únicos.',
    boardStageTitleRequired: 'Cada etapa necesita un título.',
    boardTransitionsInvalid: 'Las transiciones deben usar ids de etapa.',
    boardTransitionsMissingTarget: 'Las transiciones deben apuntar a etapas existentes.',
    boardStageActionsInvalid: 'Las acciones de etapa deben usar ids conocidos.',
    boardStageActionIdsUnique: 'Los ids de acción por etapa deben ser únicos.',
    boardStagePromptActionRequired: 'Las etapas con prompt necesitan una configuración de prompt.',
    boardStagePromptActionRequiresActionId: 'Las acciones con prompt requieren el id card.prompt.run.',
    boardStagePromptActionInvalid: 'La configuración de la acción con prompt no es válida.',
    boardStagePromptActionEnabledRequired: 'Las acciones con prompt guardadas deben quedar activadas.',
    boardStagePromptActionPromptRequired: 'Las etapas con prompt necesitan un prompt.',
    boardStagePromptActionTargetRequired: 'Las etapas con prompt necesitan una etapa de destino.',
    boardStagePromptActionTargetMissing: 'Las acciones con prompt deben apuntar a una etapa existente.',
    boardStagePromptActionJsonInvalid: 'El borrador JSON de acciones con prompt no es válido.',
    boardStagePromptActionStageMissing: 'El borrador de acciones con prompt debe apuntar a etapas actuales.',
    boardTemplateIdRequired: 'Cada plantilla necesita un id.',
    boardTemplateIdsUnique: 'Los ids de plantilla deben ser únicos.',
    boardTemplateTitleRequired: 'Cada plantilla necesita un título.',
    boardTemplateInitialStageInvalid: 'La etapa inicial de cada plantilla debe existir.',
    boardStageHasCards: 'Mueve las tarjetas fuera de una etapa antes de eliminarla.',
    boardSourceLocaleMissingOnCards: 'Las tarjetas existentes ya deben incluir el nuevo locale de origen.',
    boardLocalizationGlossaryInvalid: 'Los términos deben usar "Término origen | locale=valor | locale=valor".',
    boardLocalizationGlossarySourceRequired: 'Cada término necesita un texto de origen.',
    boardLocalizationGlossarySourcesUnique: 'Los términos deben ser únicos.',
    boardLocalizationGlossaryTranslationsRequired: 'Cada término necesita al menos una traducción.',
    boardLocalizationGlossaryLocalesInvalid: 'Las traducciones deben usar locales soportados.',
    boardOpenAiKeyMissing: 'Este tablero no tiene configuración de IA para localización.',
    boardOpenAiKeyUnavailable: 'La configuración guardada de IA para localización no está disponible.',
    cardTitleRequired: 'El título de la tarjeta es obligatorio.',
    cardCreateStageUnavailable: 'Las tarjetas solo se pueden crear en etapas con creación habilitada.',
    cardDeleteStageUnavailable: 'Las tarjetas solo se pueden eliminar en etapas con eliminación habilitada.',
    cannotDeleteLastBoard: 'No se puede eliminar el último tablero restante.',
    boardNotFound: 'No se encontró el tablero.',
    cardNotFound: 'No se encontró la tarjeta.',
    cardNotInSourceColumn: 'La tarjeta no está en la columna de origen.',
    boardReadPermissionDenied: 'Puedes ver este tablero, pero los controles interactivos no estarán disponibles hasta que te unas.',
    boardEditPermissionDenied: 'No tienes permiso para editar este tablero.',
    boardAdminPermissionDenied: 'No tienes permiso para administrarlo.',
    inviteResponsePermissionDenied: 'No tienes permiso para responder esta invitación.',
    targetLocaleUnsupported: 'Este locale no está soportado en este tablero.',
    sourceLocaleMissing: 'El contenido del locale de origen es obligatorio antes de generar una localización.',
    localizationHumanAuthoredConflict: 'No se puede sobrescribir una localización editada por una persona con contenido generado por IA.',
    localizationAlreadyPresent: 'Ya existe contenido localizado para este locale.',
    localizationGenerateFailed: 'No se pudo generar la localización en este momento.',
    stagePromptActionDisabled: 'Esta etapa no permite ejecutar prompts.',
    stagePromptActionConfigMissing: 'Esta etapa necesita primero una configuración de prompt válida.',
    stagePromptRunFailed: 'No se pudo ejecutar el prompt de la etapa en este momento.',
    workspaceConflict: 'Este espacio cambió en otro lugar. Actualiza para continuar.',
    requestUnavailable: 'No se pudo completar la solicitud.'
  }
});

const JA_MESSAGES = freezeCatalog({
  common: {
    appTitle: '過程 (katei)',
    close: '閉じる',
    save: '保存',
    cancel: 'キャンセル',
    delete: '削除',
    logout: 'ログアウト',
    switch: '切り替え',
    welcomeUser: '{name}さん、ようこそ。'
  },
  pageTitles: {
    landing: '{appTitle} ・サインイン',
    workspace: '{appTitle} ・ボード',
    portfolio: '{appTitle} ・ポートフォリオ'
  },
  landing: {
    eyebrow: '限定テスタープレビュー',
    description:
      'Katei はボードを集中しやすく、手触りのある形で保ちます。Google でサインインして、限定テスト用ワークスペースを開いてください。',
    authTitle: 'ボードに入る',
    authDescription:
      'Google が本人確認を行い、Katei がその結果を検証したうえで、専用のプライベートセッションでボードワークスペースを開きます。',
    loading: 'Google サインインを確認しています...',
    status: {
      googleUnavailable: '現在、Google サインインは利用できません。',
      missingClientId: 'Google クライアント ID がありません。',
      gisDidNotLoad: 'Google Identity Services を読み込めませんでした。',
      initOriginUnavailable: 'このオリジンでは Google サインインを初期化できませんでした。',
      buttonNotRenderedDetailed:
        'Google サインインボタンが表示されませんでした。このクライアント ID に許可された JavaScript オリジンを確認してください。',
      buttonNotRendered: 'Google サインインボタンを表示できませんでした。',
      missingCredential: 'Google サインインから認証情報が返されませんでした。'
    }
  },
  session: {
    logoutConfirmTitle: 'ログアウトしますか？',
    logoutConfirmMessage: 'この端末で Katei からログアウトします。',
    signingOut: 'ログアウトしています...',
    signOutUnavailable: '現在はログアウトできません。'
  },
  uiLocale: {
    label: 'UI言語'
  },
  portfolio: {
    eyebrow: 'スーパー管理者ポートフォリオ',
    title: 'ポートフォリオ',
    description:
      'スーパー管理者向けの専用画面です。ワークスペース横断のポートフォリオ要約とワークスペース名の管理を行えます。',
    openBoards: 'ボードに戻る',
    superAdminBadge: 'スーパー管理者',
    readOnlyBadge: 'ボードデータは読み取り専用',
    coverage: {
      complete: '完了',
      incomplete: 'locale不足あり'
    },
    filters: {
      searchLabel: 'ポートフォリオを検索',
      searchPlaceholder: 'ワークスペース、ボード、localeで検索',
      applyAction: '適用',
      clearAction: 'クリア',
      resultsLabel: '{count} 件の一致するボード'
    },
    summary: {
      heading: '概要',
      description: 'ポートフォリオの合計値は、専用のサーバー側要約 read model から描画されます。',
      workspacesLabel: 'ワークスペース',
      boardsLabel: 'ボード',
      cardsLabel: 'カード',
      cardsMissingRequiredLocalesLabel: '必須 locale が不足しているカード',
      openLocaleRequestCountLabel: '未対応の locale リクエスト',
      awaitingHumanVerificationCountLabel: '人の確認待ち',
      agentProposalCountLabel: 'エージェント提案'
    },
    directory: {
      heading: 'ボード一覧',
      description: '編集可能な完全なボード payload を公開せずに、ワークスペース横断のボード要約を表示します。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      localeCoverageColumnLabel: 'locale カバレッジ',
      keyCountsColumnLabel: '主要件数',
      actionsColumnLabel: '操作',
      workspaceLabel: 'ワークスペース',
      workspaceIdLabel: 'ワークスペース ID',
      boardIdLabel: 'ボード ID',
      sourceLocaleLabel: 'ソース locale',
      defaultLocaleLabel: 'デフォルト locale',
      supportedLocalesLabel: '対応 locale',
      requiredLocalesLabel: '必須 locale',
      cardCountLabel: 'カード',
      cardsMissingRequiredLocalesLabel: '必須 locale が不足しているカード',
      openLocaleRequestCountLabel: '未対応の locale リクエスト',
      awaitingHumanVerificationCountLabel: '人の確認待ち',
      agentProposalCountLabel: 'エージェント提案',
      openBoardAction: 'ボードを開く',
      boardCreatedAtLabel: 'ボード作成日時',
      boardUpdatedAtLabel: 'ボード更新日時',
      workspaceUpdatedAtLabel: 'ワークスペース更新日時',
      oldestMissingRequiredLocaleUpdatedAtLabel: '最も古い必須 locale 未対応',
      oldestOpenLocaleRequestAtLabel: '最も古い locale リクエスト',
      oldestAwaitingHumanVerificationAtLabel: '最も古い人の確認待ち',
      oldestAgentProposalAtLabel: '最も古いエージェント提案',
      emptyFiltered: {
        heading: '検索条件に一致するボードはありません',
        description: '別のワークスペース名、ボード名、または locale で試してください。'
      }
    },
    workspaceTitleEditor: {
      createAction: 'ワークスペースを作成',
      createHeading: 'ワークスペースを作成',
      assignAction: 'タイトルを付ける',
      editAction: 'タイトルを編集',
      assignHeading: 'ワークスペース名を設定',
      editHeading: 'ワークスペース名を編集',
      fieldLabel: 'ワークスペース名',
      createPlaceholder: '空欄にすると既定のワークスペース名を使います',
      createHelp: '空欄のタイトルには表示名と次の連番を使います。',
      placeholder: '空欄にするとワークスペース ID を表示します',
      help: 'タイトルを消すとワークスペース ID 表示に戻ります。',
      creatingAction: '作成しています...',
      savingAction: '保存しています...',
      savedStatus: 'ワークスペース名を保存しました。'
    },
    boardSelfRole: {
      fieldLabel: 'このボードでの自分の権限',
      selectPlaceholder: '権限を選択',
      saveAction: '権限を保存',
      savingAction: '保存しています...',
      savedStatus: '{board}: 権限を{role}に保存しました。',
      openBoardHelp: 'このボードを開くには自分に権限を割り当ててください。',
      requiredError: '保存する前に権限を選択してください。'
    },
    awaitingApproval: {
      heading: '承認待ち',
      description: 'すでに人の確認が必要になっている AI 由来のローカライズ項目を、ボード横断で一覧表示します。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      cardColumnLabel: 'カード',
      localeColumnLabel: 'locale',
      stateColumnLabel: '状態',
      verificationRequestedAtColumnLabel: '確認依頼日時',
      actionsColumnLabel: '操作',
      openBoardAction: 'ボードを開く',
      empty: {
        heading: '承認待ちの項目はありません',
        description: '現在、人の確認が必要な項目はありません。'
      },
      emptyFiltered: {
        heading: '検索条件に一致する承認待ち項目はありません',
        description: '別のワークスペース名、ボード名、カード名、または locale で試してください。'
      }
    },
    agentProposals: {
      heading: 'エージェント提案',
      description: 'まだ人の確認依頼が出ていない AI 由来のローカライズ項目を一覧表示します。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      cardColumnLabel: 'カード',
      localeColumnLabel: 'locale',
      stateColumnLabel: '状態',
      proposedAtColumnLabel: '提案日時',
      actionsColumnLabel: '操作',
      openBoardAction: 'ボードを開く',
      empty: {
        heading: 'エージェント提案はありません',
        description: '現在、AI 由来の提案状態で止まっている項目はありません。'
      },
      emptyFiltered: {
        heading: '検索条件に一致する提案はありません',
        description: '別のワークスペース名、ボード名、カード名、または locale で試してください。'
      }
    },
    missingRequiredLocalizations: {
      heading: '必須ローカライズ不足',
      description: 'まだ 1 つ以上の必須 locale が不足しているカードを、ボード横断で一覧表示します。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      cardColumnLabel: 'カード',
      missingLocalesColumnLabel: '不足 locale',
      updatedAtColumnLabel: 'カード更新日時',
      actionsColumnLabel: '操作',
      openBoardAction: 'ボードを開く',
      empty: {
        heading: '不足している必須ローカライズはありません',
        description: 'すべての必須 locale にカード内容があります。'
      },
      emptyFiltered: {
        heading: '検索条件に一致する不足項目はありません',
        description: '別のワークスペース名、ボード名、カード名、または locale で試してください。'
      }
    },
    incompleteCoverage: {
      heading: 'locale カバレッジ未完了',
      description: 'まだ必須 locale が不足しているカードを含むボードを一覧表示します。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      statusColumnLabel: 'カバレッジ状態',
      cardsMissingRequiredLocalesColumnLabel: '必須 locale が不足しているカード',
      oldestMissingRequiredLocaleUpdatedAtColumnLabel: '最も古い必須 locale 未対応',
      actionsColumnLabel: '操作',
      openBoardAction: 'ボードを開く',
      empty: {
        heading: 'カバレッジ未完了のボードはありません',
        description: '現在、すべてのボードが必須 locale ポリシーを満たしています。'
      },
      emptyFiltered: {
        heading: '検索条件に一致する未完了ボードはありません',
        description: '別のワークスペース名、ボード名、または locale で試してください。'
      }
    },
    aging: {
      heading: '滞留とボトルネック',
      description: '現在のデータモデルで既に追跡している最も古い保留シグナルごとに、ボードを並べます。',
      workspaceColumnLabel: 'ワークスペース',
      boardColumnLabel: 'ボード',
      actionsColumnLabel: '操作',
      openBoardAction: 'ボードを開く',
      awaitingApproval: {
        heading: '最も古い承認待ち',
        description: '最も古い人の確認依頼でボードを並べます。',
        countColumnLabel: '承認待ち件数',
        timestampColumnLabel: '最も古い承認待ち',
        empty: {
          heading: '承認待ちの滞留はありません',
          description: '現在、人の確認待ちの項目を持つボードはありません。'
        }
      },
      openLocaleRequests: {
        heading: '最も古い open locale request',
        description: '最も古い open locale request でボードを並べます。',
        countColumnLabel: 'open locale requests',
        timestampColumnLabel: '最も古い open locale request',
        empty: {
          heading: 'open locale request の滞留はありません',
          description: '現在、open locale request を持つボードはありません。'
        }
      },
      missingRequiredLocales: {
        heading: '最も古い必須 locale 不足',
        description: 'まだ 1 つ以上の必須 locale が不足している最も古いカードで、ボードを並べます。',
        countColumnLabel: '必須 locale が不足しているカード',
        timestampColumnLabel: '最も古い必須 locale 未対応',
        empty: {
          heading: '必須 locale 不足の滞留はありません',
          description: '現在、必須 locale が不足しているカードを持つボードはありません。'
        }
      }
    },
    empty: {
      heading: 'ポートフォリオデータはまだありません',
      description: '利用できるワークスペース要約はまだありません。'
    }
  },
  workspace: {
    viewerSignedIn: 'サインイン済み',
    boardOptions: 'ボード',
    openPortfolio: 'ポートフォリオ',
    profileOptions: 'プロフィール',
    addCard: 'カードを追加',
    detailsLabel: '詳細',
    updatedLabel: '更新日時',
    cardCount: '{count} 件のカード',
    fallbackBoardTitle: 'ボード',
    noVisibleBoardsTitle: '表示できるボードはありません',
    noVisibleBoardsDescription: 'このワークスペースには、現在開けるボードがありません。',
    boardInvitePendingNotice: 'このボードはあなたに共有されています。共同編集を開いて、招待を承認または辞退してください。',
    status: {
      loadUnavailable: 'このワークスペースを読み込めません。',
      moveUnavailable: 'カードを移動できません。',
      copyCardDetailsUnavailable: 'カード詳細をコピーできませんでした。'
    },
    view: {
      noDetails: '詳細はありません。'
    },
    announcements: {
      columnCollapsed: '{column} を折りたたみました。',
      columnExpanded: '{column} を展開しました。',
      switchedBoard: '{title} に切り替えました。',
      boardRenamed: 'ボード名を変更しました。',
      boardUpdated: 'ボードを保存しました。',
      boardCreated: 'ボードを作成しました。',
      inviteSent: '招待を送りました。',
      inviteRevoked: '招待を取り消しました。',
      inviteAccepted: '招待を承認しました。',
      inviteDeclined: '招待を辞退しました。',
      memberRoleUpdated: 'メンバー権限を更新しました。',
      memberRemoved: 'メンバーを削除しました。',
      returnedHomeWorkspace: 'ホームワークスペースに戻りました。',
      cardUpdated: 'カードを更新しました。',
      cardCreated: 'カードを作成しました。',
      localizedContentUpdated: 'ローカライズ済みコンテンツを更新しました。',
      localizationGenerated: 'ローカライズを生成しました。',
      localeDiscarded: 'ローカライズ済みコンテンツを破棄しました。',
      localeRequested: 'ロケールをリクエストしました。',
      localeRequestCleared: 'ロケールリクエストを解除しました。',
      humanVerificationRequested: '人による確認を依頼しました。',
      localeVerified: 'ローカライズを確認済みにしました。',
      cardDetailsCopied: 'カード詳細をコピーしました。',
      stagePromptRunSucceeded: 'プロンプト実行が完了しました。',
      movedCard: 'カードを {column} に移動しました。',
      cardDeleted: 'カードを削除しました。',
      boardDeleted: 'ボードを削除しました。',
      boardReset: 'ボードをリセットしました。'
    },
    cardPromptRunButton: 'プロンプト実行',
    confirmations: {
      deleteBoardTitle: 'ボードを削除しますか？',
      deleteBoardMessage: 'この操作は元に戻せません。"{title}" は完全に削除されます。',
      deleteBoardConfirm: 'ボードを削除',
      resetBoardTitle: 'ボードをリセットしますか？',
      resetBoardMessage: '"{title}" のカードをすべて消去し、ボード自体は残します。',
      resetBoardConfirm: 'ボードをリセット',
      deleteCardTitle: 'カードを削除しますか？',
      deleteCardMessage: 'この操作は元に戻せません。"{title}" は完全に削除されます。',
      deleteCardConfirm: '削除',
      discardLocaleTitle: 'ローカライズ済みコンテンツを破棄しますか？',
      discardLocaleMessage: 'この操作は元に戻せません。"{title}" の {locale} ロケール内容を削除します。',
      discardLocaleConfirm: 'ローカライズを破棄'
    },
    columns: {
      backlog: 'バックログ',
      doing: '進行中',
      done: '完了',
      archived: 'アーカイブ'
    },
    priorities: {
      urgent: '緊急',
      important: '重要',
      normal: '通常'
    }
  },
  cardItem: {
    editAriaLabel: 'カードを編集',
    viewAriaLabel: 'カードを表示'
  },
  boardOptionsDialog: {
    sectionLabel: 'ボード',
    heading: 'ボードオプション',
    switchBoardLabel: 'ボードを切り替える',
    invitesHeading: '保留中のワークスペース招待',
    inviteContext: 'ワークスペース: {workspace}. {inviter} から',
    inviteFrom: '{inviter} から',
    inviteRole: '権限: {role}',
    acceptInvite: '承認',
    declineInvite: '辞退',
    boardTitlePlaceholder: 'ボード名',
    activeStatePlaceholder: 'アクティブ',
    switchButton: '切り替え',
    acceptInviteButton: '招待を承認',
    declineInviteButton: '招待を辞退',
    newBoard: '新しいボード',
    collaboratorsButton: '共同編集',
    editBoard: 'ボードを編集',
    resetBoard: 'ボードをリセット',
    deleteBoard: 'ボードを削除',
    summaryActive: '現在のボード: {title}',
    currentRoleSummary: '現在の権限: {role}',
    pendingInvitesSummary: '保留中の招待 {count} 件',
    noVisibleBoards: 'このワークスペースで表示できるボードはありません。',
    stateActive: '現在のボード',
    stateAvailable: '利用可能',
    homeWorkspaceLabel: 'ホームワークスペース'
  },
  profileOptionsDialog: {
    sectionLabel: 'プロフィール',
    heading: 'プロフィール設定'
  },
  collaborators: {
    sectionLabel: '共同編集',
    heading: '共同編集 · {title}',
    currentRoleValue: '現在の権限: {role}',
    inviteHeading: 'メンバーを招待',
    inviteHelp: '管理者はメールアドレスで招待し、初期権限を設定できます。',
    inviteEmailLabel: '招待メール',
    inviteRoleLabel: '招待する権限',
    inviteSubmit: '招待を送る',
    membersHeading: 'メンバー',
    pendingHeading: '保留中の招待',
    pendingStatus: '保留中',
    revokeInvite: '招待を取り消す',
    removeMember: 'メンバーを外す',
    acceptInvite: '参加する',
    declineInvite: '辞退する',
    roles: {
      admin: '管理者',
      editor: '編集者',
      viewer: '閲覧者',
      invited: '招待保留中',
      none: 'このボードの権限なし'
    }
  },
  cardEditor: {
    newHeading: '新しいカード',
    editHeading: 'カードを編集',
    viewHeading: 'カードを表示',
    titleLabel: 'タイトル',
    titlePlaceholder: '何を進めますか？',
    detailsLabel: '詳細',
    detailsPlaceholder: '任意の背景、メモ、次のステップ。',
    localeSectionLabel: 'ローカライズ済みコンテンツ',
    localeLabel: 'ロケール',
    selectedLocaleValue: '表示中: {locale}',
    viewingLocaleValue: '閲覧中のロケール: {locale}',
    renderedLocaleValue: '描画元: {locale}',
    selectedLocaleMissing: '選択したロケールには内容がありません',
    noLocalizedContent: 'このカードで利用できるローカライズ済みコンテンツはまだありません。',
    localizedContentSummary: 'あり {presentCount} 件 · リクエスト済み {requestedCount} 件 · 未対応 {missingCount} 件',
    localeFallbackNotice: '{selectedLocale} がないため、{renderedLocale} を表示しています。',
    localeFallbackLegacyNotice: '{selectedLocale} がないため、{renderedLocale} の従来コンテンツを表示しています。',
    editingLocaleValue: '編集中のロケール: {locale}',
    missingLocaleValue: '未対応のロケール: {locale}',
    requestedLocaleValue: 'リクエスト済みのロケール: {locale}',
    generateLocaleButton: 'ローカライズを生成',
    generatingLocaleButton: 'ローカライズを生成中...',
    generateLocaleHelp: 'このボードの AI ローカライズ設定を使います。',
    manualLocaleHelp: 'AI ローカライズ設定がなくても、このロケールを手動で入力して保存できます。',
    discardLocaleButton: 'ローカライズを破棄',
    generateLocaleBlockedReadOnly: 'ローカライズを生成できるのは編集者のみです。',
    generateLocaleBlockedNoAiKey: 'このボードには AI ローカライズ設定がありません。',
    generateLocaleBlockedSourceLocale: 'source ロケールは手動で入力してください。',
    generateLocaleBlockedAlreadyPresent: 'このロケールには既にローカライズ済みコンテンツがあります。',
    requestLocaleButton: 'ロケールをリクエスト',
    clearLocaleRequestButton: 'ロケールリクエストを解除',
    verifyLocaleButton: '確認済みにする',
    reviewState: {
      ai: 'AI',
      'needs-human-verification': '人による確認が必要',
      verified: '確認済み'
    },
    localeReadOnlyNotice: 'このローカライズ済みカードビューは読み取り専用です。',
    viewerReadOnlyNotice:
      '閲覧者はローカライズ済みコンテンツを確認し、人による確認を依頼できますが、編集や確認済みへの変更はできません。',
    priorityLabel: '優先度',
    priorityGroupAriaLabel: '優先度',
    statusLabel: 'タスクの状態',
    deleteButton: '削除',
    saveButton: 'カードを保存',
    moveStateCurrent: '現在',
    moveStateSelected: '選択中',
    markdownToolbar: {
      bold: {
        text: 'B',
        label: '太字'
      },
      italic: {
        text: 'I',
        label: '斜体'
      },
      heading: {
        text: 'H',
        label: '見出し 2'
      },
      quote: '引用',
      bullets: {
        text: '•',
        label: '箇条書きリスト'
      },
      numbers: '番号付き',
      code: {
        text: 'Code',
        label: 'コード'
      },
      link: 'リンク',
      preview: 'プレビュー'
    }
  },
  cardViewDialog: {
    titlePlaceholder: 'カード名',
    copyButton: 'カード詳細をコピー',
    editButton: '編集',
    detailsLabel: '詳細',
    updatedLabel: '更新日時',
    requestHumanVerificationButton: '人による確認を依頼',
    copyFields: {
      title: 'タイトル',
      locale: 'ロケール',
      stage: 'ステージ',
      priority: '優先度',
      cardId: 'カード ID'
    },
    reviewState: {
      ai: 'AI',
      'needs-human-verification': '人による確認が必要',
      verified: '確認済み'
    }
  },
  boardEditor: {
    newHeading: '新しいボード',
    editHeading: 'ボードを編集',
    titleLabel: 'ボード名',
    titlePlaceholder: 'どのためのボードですか？',
    languagePolicyLabel: '言語ポリシー',
    languagePolicyHelp: 'ロケールは BCP 47 形式で入力します。source と default は supported に含めてください。',
    sourceLocaleLabel: 'source ロケール',
    defaultLocaleLabel: 'default ロケール',
    supportedLocalesLabel: 'supported ロケール',
    requiredLocalesLabel: 'required ロケール',
    aiLocalizationLabel: 'AI ローカライズ',
    aiLocalizationHelp: 'v1 では OpenAI のみ対応します。API キーを空欄のまま保存すると既存のキーを保持し、新しい値を入れると置き換え、クリアを選ぶと削除します。',
    aiProviderLabel: 'プロバイダー',
    openAiApiKeyLabel: 'OpenAI API キー',
    openAiApiKeyHelp: '保存後に完全なキーがブラウザへ再表示されることはありません。',
    openAiApiKeySaved: 'このボードには保存済みの OpenAI API キーがあります。',
    openAiApiKeySavedWithLast4: 'このボードには保存済みの OpenAI API キーがあります。末尾 4 文字: {last4}。',
    localizationGlossaryLabel: '用語集',
    localizationGlossaryHelp:
      '1 行ごとに入力: source term | locale=value | locale=value。例: Omen of Sorrow | es=Omen of Sorrow',
    clearOpenAiApiKeyLabel: '保存済みの OpenAI API キーを削除する',
    stagesLabel: 'ステージ',
    stagesHelp:
      '1 行ごとに入力: stage-id | 表示名 | 遷移先-a, 遷移先-b | action-a, action-b。例: backlog | Backlog | doing, done | card.create',
    stageSummaryLabel: '現在の下書き',
    stageSummaryEmpty: '設定されたステージはありません。',
    stageSummaryValue: '{count} ステージ · {stages}',
    configureStagesButton: 'ステージを設定',
    saveButton: 'ボードを保存',
    createButton: 'ボードを作成',
    deleteButton: 'ボードを削除'
  },
  boardStageConfigDialog: {
    sectionLabel: 'ステージ',
    heading: 'ステージを設定',
    help:
      '1 行ごとに入力: stage-id | Title | target-a, target-b | action-a, action-b。必要に応じて 3 つ目や 4 つ目の区切りは省略でき、action の前で遷移先を空にすることもできます。',
    definitionsLabel: 'ステージ定義',
    promptActionSectionLabel: 'プロンプト操作',
    promptActionEnableLabel: 'プロンプト実行を有効化',
    promptActionPromptLabel: 'プロンプト',
    promptActionPromptPlaceholder: 'このカードを新しい実装タスクに変換してください。',
    promptActionTargetStageLabel: '移動先ステージ',
    promptActionHelp:
      'ステージのプロンプトと元カードの内容を使って、選択した移動先ステージに新しいカードを作成します。',
    promptActionRequiresActionHelp:
      'この操作を設定するには、上のステージ action 一覧へ "card.prompt.run" を追加してください。',
    promptActionUncheckedHelp:
      'このプロンプト操作は、適用時にステージから削除されます。',
    applyButton: 'ステージを適用'
  },
  confirmDialog: {
    deleteCardTitle: 'カードを削除しますか？',
    deleteCardMessage: 'この操作は元に戻せません。'
  },
  errors: {
    genericUnexpected: '問題が発生しました。',
    authOriginNotAllowed: 'サインイン要求のオリジンは許可されていません。',
    googleCredentialRequired: 'Google 認証情報が必要です。',
    googleCredentialVerifyFailed: 'Google 認証情報を確認できませんでした。',
    googleAccessDenied: 'この Google アカウントは限定テストに利用できません。',
    signInUnavailable: 'Google でサインインできませんでした。',
    signOutUnavailable: 'ログアウトできませんでした。',
    authenticationRequired: '認証が必要です。',
    boardTitleRequired: 'ボード名は必須です。',
    boardLanguagePolicyInvalid: 'ボードの言語ポリシーが無効です。',
    boardStagesRequired: '少なくとも 1 つのステージを追加してください。',
    boardStageDefinitionFormatInvalid:
      '各ステージは "stage-id | Title"、"stage-id | Title | target-a, target-b"、または "stage-id | Title | target-a, target-b | action-a, action-b" 形式で入力してください。',
    boardStageIdInvalid: 'ステージ id は小文字のスラッグで入力してください。',
    boardStageIdsUnique: 'ステージ id は重複できません。',
    boardStageTitleRequired: '各ステージに表示名が必要です。',
    boardTransitionsInvalid: '遷移先はステージ id で入力してください。',
    boardTransitionsMissingTarget: '遷移先は存在するステージを参照してください。',
    boardStageActionsInvalid: 'ステージの操作は既知の action id を使ってください。',
    boardStageActionIdsUnique: 'ステージ action id は重複できません。',
    boardStagePromptActionRequired: 'プロンプト実行を使うステージには設定が必要です。',
    boardStagePromptActionRequiresActionId: 'プロンプト操作には card.prompt.run の action id が必要です。',
    boardStagePromptActionInvalid: 'ステージのプロンプト設定が無効です。',
    boardStagePromptActionEnabledRequired: '保存されるプロンプト操作は有効化されている必要があります。',
    boardStagePromptActionPromptRequired: 'プロンプト実行を使うステージにはプロンプトが必要です。',
    boardStagePromptActionTargetRequired: 'プロンプト実行を使うステージには移動先ステージが必要です。',
    boardStagePromptActionTargetMissing: 'プロンプト操作は存在するステージを参照してください。',
    boardStagePromptActionJsonInvalid: 'プロンプト操作の下書き JSON が無効です。',
    boardStagePromptActionStageMissing: 'プロンプト操作の下書きは現在のステージを参照してください。',
    boardTemplateIdRequired: '各テンプレートに id が必要です。',
    boardTemplateIdsUnique: 'テンプレート id は重複できません。',
    boardTemplateTitleRequired: '各テンプレートにタイトルが必要です。',
    boardTemplateInitialStageInvalid: 'テンプレートの開始ステージが存在しません。',
    boardStageHasCards: 'ステージを削除する前に、その中のカードを移動してください。',
    boardSourceLocaleMissingOnCards: '既存カードに新しい source ロケールの内容が必要です。',
    boardLocalizationGlossaryInvalid: '用語集は "source term | locale=value | locale=value" 形式で入力してください。',
    boardLocalizationGlossarySourceRequired: '各用語に source term が必要です。',
    boardLocalizationGlossarySourcesUnique: '用語は重複できません。',
    boardLocalizationGlossaryTranslationsRequired: '各用語に少なくとも 1 つの翻訳が必要です。',
    boardLocalizationGlossaryLocalesInvalid: '翻訳はサポート済みロケールを使ってください。',
    boardOpenAiKeyMissing: 'このボードには AI ローカライズ設定がありません。',
    boardOpenAiKeyUnavailable: '保存済みの AI ローカライズ設定を利用できません。',
    cardTitleRequired: 'カード名は必須です。',
    cardCreateStageUnavailable: 'カードは作成が有効なステージでのみ作成できます。',
    cardDeleteStageUnavailable: 'カードは削除が有効なステージでのみ削除できます。',
    cannotDeleteLastBoard: '最後のボードは削除できません。',
    boardNotFound: 'ボードが見つかりません。',
    cardNotFound: 'カードが見つかりません。',
    cardNotInSourceColumn: 'カードが移動元の列にありません。',
    boardReadPermissionDenied: 'このボードは表示できますが、参加するまでは操作できません。',
    boardEditPermissionDenied: 'このボードを編集する権限がありません。',
    boardAdminPermissionDenied: 'このボードを管理する権限がありません。',
    inviteResponsePermissionDenied: 'この招待に応答する権限がありません。',
    targetLocaleUnsupported: 'このロケールはこのボードでサポートされていません。',
    sourceLocaleMissing: 'ローカライズを生成する前に source ロケールの内容が必要です。',
    localizationHumanAuthoredConflict: '人が編集したローカライズを AI 生成コンテンツで上書きすることはできません。',
    localizationAlreadyPresent: 'このロケールには既にローカライズ済みコンテンツがあります。',
    localizationGenerateFailed: '現在ローカライズを生成できません。',
    stagePromptActionDisabled: 'このステージではプロンプト実行を使えません。',
    stagePromptActionConfigMissing: 'このステージには有効なプロンプト設定が必要です。',
    stagePromptRunFailed: '現在ステージのプロンプトを実行できません。',
    workspaceConflict: 'このワークスペースは別の場所で変更されました。更新して続行してください。',
    requestUnavailable: 'リクエストを完了できませんでした。'
  }
});

export const UI_MESSAGE_CATALOGS = Object.freeze({
  en: EN_MESSAGES,
  'es-CL': ES_CL_MESSAGES,
  ja: JA_MESSAGES
});

function freezeCatalog(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    freezeCatalog(nestedValue);
  }

  return Object.freeze(value);
}
