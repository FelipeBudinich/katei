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
    workspace: '{appTitle} · Boards'
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
    signingOut: 'Signing out...',
    signOutUnavailable: 'Unable to sign out right now.'
  },
  uiLocale: {
    label: 'UI language'
  },
  workspace: {
    viewerSignedIn: 'Signed in',
    boardOptions: 'Options',
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
      moveUnavailable: 'Unable to move card.'
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
      localeRequested: 'Locale requested.',
      localeRequestCleared: 'Locale request cleared.',
      movedCard: 'Moved card to {column}.',
      cardDeleted: 'Card deleted.',
      boardDeleted: 'Board deleted.',
      boardReset: 'Board reset.'
    },
    confirmations: {
      deleteBoardTitle: 'Delete board?',
      deleteBoardMessage: 'This action cannot be undone. "{title}" will be removed permanently.',
      deleteBoardConfirm: 'Delete board',
      resetBoardTitle: 'Reset board?',
      resetBoardMessage: 'This will clear all cards from "{title}" and keep the board itself.',
      resetBoardConfirm: 'Reset board',
      deleteCardTitle: 'Delete card?',
      deleteCardMessage: 'This action cannot be undone. "{title}" will be removed permanently.',
      deleteCardConfirm: 'Delete'
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
    requestLocaleButton: 'Request locale',
    clearLocaleRequestButton: 'Clear locale request',
    localeReadOnlyNotice: 'This localized card view is read-only.',
    viewerReadOnlyNotice: 'Viewers can inspect localized content, but cannot edit or request locales.',
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
    detailsLabel: 'Details',
    updatedLabel: 'Updated'
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
    stagesLabel: 'Stages',
    stagesHelp:
      'One line per stage: stage-id | Display title | target-a, target-b | action-a, action-b. Example: archived | Archived | backlog, doing, done | card.delete',
    saveButton: 'Save Board',
    createButton: 'Create Board',
    deleteButton: 'Delete Board'
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
    boardStageIdInvalid: 'Stage ids must use lowercase slugs.',
    boardStageIdsUnique: 'Stage ids must be unique.',
    boardStageTitleRequired: 'Each stage needs a title.',
    boardTransitionsInvalid: 'Stage transitions must use stage ids.',
    boardTransitionsMissingTarget: 'Stage transitions must point to existing stages.',
    boardStageActionsInvalid: 'Stage actions must use known action ids.',
    boardStageActionIdsUnique: 'Stage action ids must be unique.',
    boardTemplateIdRequired: 'Each template needs an id.',
    boardTemplateIdsUnique: 'Template ids must be unique.',
    boardTemplateTitleRequired: 'Each template needs a title.',
    boardTemplateInitialStageInvalid: 'Template initial stages must point to existing stages.',
    boardStageHasCards: 'Move cards out of a stage before removing it.',
    boardSourceLocaleMissingOnCards: 'Existing cards must already include the new source locale.',
    cardTitleRequired: 'Card title is required.',
    cannotDeleteLastBoard: 'Cannot delete the last remaining board.',
    boardNotFound: 'Board not found.',
    cardNotFound: 'Card not found.',
    cardNotInSourceColumn: 'Card is not in the source column.',
    boardReadPermissionDenied: 'You can view this board, but interactive board controls are unavailable until you join it.',
    boardEditPermissionDenied: 'You do not have permission to edit this board.',
    boardAdminPermissionDenied: 'You do not have permission to manage this board.',
    inviteResponsePermissionDenied: 'You do not have permission to respond to this invite.',
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
    workspace: '{appTitle} · Tableros'
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
    signingOut: 'Cerrando sesión...',
    signOutUnavailable: 'No se pudo cerrar sesión en este momento.'
  },
  uiLocale: {
    label: 'Idioma de la interfaz'
  },
  workspace: {
    viewerSignedIn: 'Sesión iniciada',
    boardOptions: 'Opciones',
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
      moveUnavailable: 'No se pudo mover la tarjeta.'
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
      localeRequested: 'Locale solicitado.',
      localeRequestCleared: 'Solicitud de locale eliminada.',
      movedCard: 'Tarjeta movida a {column}.',
      cardDeleted: 'Tarjeta eliminada.',
      boardDeleted: 'Tablero eliminado.',
      boardReset: 'Tablero reiniciado.'
    },
    confirmations: {
      deleteBoardTitle: '¿Eliminar tablero?',
      deleteBoardMessage: 'Esta acción no se puede deshacer. "{title}" se eliminará permanentemente.',
      deleteBoardConfirm: 'Eliminar tablero',
      resetBoardTitle: '¿Reiniciar tablero?',
      resetBoardMessage: 'Esto eliminará todas las tarjetas de "{title}" y mantendrá el tablero.',
      resetBoardConfirm: 'Reiniciar tablero',
      deleteCardTitle: '¿Eliminar tarjeta?',
      deleteCardMessage: 'Esta acción no se puede deshacer. "{title}" se eliminará permanentemente.',
      deleteCardConfirm: 'Eliminar'
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
    requestLocaleButton: 'Solicitar locale',
    clearLocaleRequestButton: 'Quitar solicitud de locale',
    localeReadOnlyNotice: 'Esta vista localizada es de solo lectura.',
    viewerReadOnlyNotice: 'Los lectores pueden inspeccionar el contenido localizado, pero no editarlo ni solicitar locales.',
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
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado'
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
    stagesLabel: 'Etapas',
    stagesHelp:
      'Una línea por etapa: stage-id | Título visible | destino-a, destino-b | acción-a, acción-b. Ejemplo: archived | Archived | backlog, doing, done | card.delete',
    saveButton: 'Guardar tablero',
    createButton: 'Crear tablero',
    deleteButton: 'Eliminar tablero'
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
    boardStageIdInvalid: 'Los ids de etapa deben usar slugs en minúsculas.',
    boardStageIdsUnique: 'Los ids de etapa deben ser únicos.',
    boardStageTitleRequired: 'Cada etapa necesita un título.',
    boardTransitionsInvalid: 'Las transiciones deben usar ids de etapa.',
    boardTransitionsMissingTarget: 'Las transiciones deben apuntar a etapas existentes.',
    boardStageActionsInvalid: 'Las acciones de etapa deben usar ids conocidos.',
    boardStageActionIdsUnique: 'Los ids de acción por etapa deben ser únicos.',
    boardTemplateIdRequired: 'Cada plantilla necesita un id.',
    boardTemplateIdsUnique: 'Los ids de plantilla deben ser únicos.',
    boardTemplateTitleRequired: 'Cada plantilla necesita un título.',
    boardTemplateInitialStageInvalid: 'La etapa inicial de cada plantilla debe existir.',
    boardStageHasCards: 'Mueve las tarjetas fuera de una etapa antes de eliminarla.',
    boardSourceLocaleMissingOnCards: 'Las tarjetas existentes ya deben incluir el nuevo locale de origen.',
    cardTitleRequired: 'El título de la tarjeta es obligatorio.',
    cannotDeleteLastBoard: 'No se puede eliminar el último tablero restante.',
    boardNotFound: 'No se encontró el tablero.',
    cardNotFound: 'No se encontró la tarjeta.',
    cardNotInSourceColumn: 'La tarjeta no está en la columna de origen.',
    boardReadPermissionDenied: 'Puedes ver este tablero, pero los controles interactivos no estarán disponibles hasta que te unas.',
    boardEditPermissionDenied: 'No tienes permiso para editar este tablero.',
    boardAdminPermissionDenied: 'No tienes permiso para administrarlo.',
    inviteResponsePermissionDenied: 'No tienes permiso para responder esta invitación.',
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
    workspace: '{appTitle} ・ボード'
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
    signingOut: 'ログアウトしています...',
    signOutUnavailable: '現在はログアウトできません。'
  },
  uiLocale: {
    label: 'UI言語'
  },
  workspace: {
    viewerSignedIn: 'サインイン済み',
    boardOptions: 'オプション',
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
      moveUnavailable: 'カードを移動できません。'
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
      localeRequested: 'ロケールをリクエストしました。',
      localeRequestCleared: 'ロケールリクエストを解除しました。',
      movedCard: 'カードを {column} に移動しました。',
      cardDeleted: 'カードを削除しました。',
      boardDeleted: 'ボードを削除しました。',
      boardReset: 'ボードをリセットしました。'
    },
    confirmations: {
      deleteBoardTitle: 'ボードを削除しますか？',
      deleteBoardMessage: 'この操作は元に戻せません。"{title}" は完全に削除されます。',
      deleteBoardConfirm: 'ボードを削除',
      resetBoardTitle: 'ボードをリセットしますか？',
      resetBoardMessage: '"{title}" のカードをすべて消去し、ボード自体は残します。',
      resetBoardConfirm: 'ボードをリセット',
      deleteCardTitle: 'カードを削除しますか？',
      deleteCardMessage: 'この操作は元に戻せません。"{title}" は完全に削除されます。',
      deleteCardConfirm: '削除'
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
    requestLocaleButton: 'ロケールをリクエスト',
    clearLocaleRequestButton: 'ロケールリクエストを解除',
    localeReadOnlyNotice: 'このローカライズ済みカードビューは読み取り専用です。',
    viewerReadOnlyNotice: '閲覧者はローカライズ済みコンテンツを確認できますが、編集やリクエストはできません。',
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
    detailsLabel: '詳細',
    updatedLabel: '更新日時'
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
    stagesLabel: 'ステージ',
    stagesHelp:
      '1 行ごとに入力: stage-id | 表示名 | 遷移先-a, 遷移先-b | action-a, action-b。例: archived | Archived | backlog, doing, done | card.delete',
    saveButton: 'ボードを保存',
    createButton: 'ボードを作成',
    deleteButton: 'ボードを削除'
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
    boardStageIdInvalid: 'ステージ id は小文字のスラッグで入力してください。',
    boardStageIdsUnique: 'ステージ id は重複できません。',
    boardStageTitleRequired: '各ステージに表示名が必要です。',
    boardTransitionsInvalid: '遷移先はステージ id で入力してください。',
    boardTransitionsMissingTarget: '遷移先は存在するステージを参照してください。',
    boardStageActionsInvalid: 'ステージの操作は既知の action id を使ってください。',
    boardStageActionIdsUnique: 'ステージ action id は重複できません。',
    boardTemplateIdRequired: '各テンプレートに id が必要です。',
    boardTemplateIdsUnique: 'テンプレート id は重複できません。',
    boardTemplateTitleRequired: '各テンプレートにタイトルが必要です。',
    boardTemplateInitialStageInvalid: 'テンプレートの開始ステージが存在しません。',
    boardStageHasCards: 'ステージを削除する前に、その中のカードを移動してください。',
    boardSourceLocaleMissingOnCards: '既存カードに新しい source ロケールの内容が必要です。',
    cardTitleRequired: 'カード名は必須です。',
    cannotDeleteLastBoard: '最後のボードは削除できません。',
    boardNotFound: 'ボードが見つかりません。',
    cardNotFound: 'カードが見つかりません。',
    cardNotInSourceColumn: 'カードが移動元の列にありません。',
    boardReadPermissionDenied: 'このボードは表示できますが、参加するまでは操作できません。',
    boardEditPermissionDenied: 'このボードを編集する権限がありません。',
    boardAdminPermissionDenied: 'このボードを管理する権限がありません。',
    inviteResponsePermissionDenied: 'この招待に応答する権限がありません。',
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
