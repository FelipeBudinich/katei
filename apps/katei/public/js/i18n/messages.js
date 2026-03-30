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
  workspace: {
    viewerSignedIn: 'Signed in',
    boardOptions: 'Options',
    addCard: 'Add Card',
    detailsLabel: 'Details',
    updatedLabel: 'Updated',
    cardCount: '{count} cards',
    fallbackBoardTitle: 'board',
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
      boardCreated: 'Board created.',
      cardUpdated: 'Card updated.',
      cardCreated: 'Card created.',
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
    boardTitlePlaceholder: 'Board title',
    activeStatePlaceholder: 'Active',
    switchButton: 'Switch',
    newBoard: 'New Board',
    renameBoard: 'Rename Board',
    resetBoard: 'Reset Board',
    deleteBoard: 'Delete Board',
    summaryActive: 'Active board: {title}',
    stateActive: 'Active board',
    stateAvailable: 'Available'
  },
  cardEditor: {
    newHeading: 'New card',
    editHeading: 'Edit card',
    titleLabel: 'Title',
    titlePlaceholder: 'What needs doing?',
    detailsLabel: 'Details',
    detailsPlaceholder: 'Optional context, notes, or next steps.',
    priorityLabel: 'Priority',
    priorityGroupAriaLabel: 'Priority',
    statusLabel: 'Task Status',
    deleteButton: 'Delete',
    saveButton: 'Save Card',
    moveStateCurrent: 'Current',
    moveStateSelected: 'Selected',
    markdownToolbar: {
      bold: 'Bold',
      italic: 'Italic',
      heading: 'H2',
      quote: 'Quote',
      bullets: 'Bullets',
      numbers: 'Numbers',
      code: 'Code',
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
    renameHeading: 'Rename board',
    titleLabel: 'Board title',
    titlePlaceholder: 'What board is this for?',
    saveButton: 'Save Board',
    createButton: 'Create Board'
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
    cardTitleRequired: 'Card title is required.',
    cannotDeleteLastBoard: 'Cannot delete the last remaining board.',
    boardNotFound: 'Board not found.',
    cardNotFound: 'Card not found.',
    cardNotInSourceColumn: 'Card is not in the source column.',
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
  workspace: {
    viewerSignedIn: 'Sesión iniciada',
    boardOptions: 'Opciones',
    addCard: 'Agregar tarjeta',
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado',
    cardCount: '{count} tarjetas',
    fallbackBoardTitle: 'tablero',
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
      boardCreated: 'Tablero creado.',
      cardUpdated: 'Tarjeta actualizada.',
      cardCreated: 'Tarjeta creada.',
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
    boardTitlePlaceholder: 'Título del tablero',
    activeStatePlaceholder: 'Activo',
    switchButton: 'Cambiar',
    newBoard: 'Nuevo tablero',
    renameBoard: 'Renombrar tablero',
    resetBoard: 'Reiniciar tablero',
    deleteBoard: 'Eliminar tablero',
    summaryActive: 'Tablero activo: {title}',
    stateActive: 'Tablero activo',
    stateAvailable: 'Disponible'
  },
  cardEditor: {
    newHeading: 'Nueva tarjeta',
    editHeading: 'Editar tarjeta',
    titleLabel: 'Título',
    titlePlaceholder: '¿Qué hay que hacer?',
    detailsLabel: 'Detalles',
    detailsPlaceholder: 'Contexto, notas o próximos pasos opcionales.',
    priorityLabel: 'Prioridad',
    priorityGroupAriaLabel: 'Prioridad',
    statusLabel: 'Estado de la tarea',
    deleteButton: 'Eliminar',
    saveButton: 'Guardar tarjeta',
    moveStateCurrent: 'Actual',
    moveStateSelected: 'Seleccionada',
    markdownToolbar: {
      bold: 'Negrita',
      italic: 'Cursiva',
      heading: 'H2',
      quote: 'Cita',
      bullets: 'Viñetas',
      numbers: 'Números',
      code: 'Código',
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
    renameHeading: 'Renombrar tablero',
    titleLabel: 'Título del tablero',
    titlePlaceholder: '¿Para qué es este tablero?',
    saveButton: 'Guardar tablero',
    createButton: 'Crear tablero'
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
    cardTitleRequired: 'El título de la tarjeta es obligatorio.',
    cannotDeleteLastBoard: 'No se puede eliminar el último tablero restante.',
    boardNotFound: 'No se encontró el tablero.',
    cardNotFound: 'No se encontró la tarjeta.',
    cardNotInSourceColumn: 'La tarjeta no está en la columna de origen.',
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
  workspace: {
    viewerSignedIn: 'サインイン済み',
    boardOptions: 'オプション',
    addCard: 'カードを追加',
    detailsLabel: '詳細',
    updatedLabel: '更新日時',
    cardCount: '{count} 件のカード',
    fallbackBoardTitle: 'ボード',
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
      boardCreated: 'ボードを作成しました。',
      cardUpdated: 'カードを更新しました。',
      cardCreated: 'カードを作成しました。',
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
    boardTitlePlaceholder: 'ボード名',
    activeStatePlaceholder: 'アクティブ',
    switchButton: '切り替え',
    newBoard: '新しいボード',
    renameBoard: 'ボード名を変更',
    resetBoard: 'ボードをリセット',
    deleteBoard: 'ボードを削除',
    summaryActive: '現在のボード: {title}',
    stateActive: '現在のボード',
    stateAvailable: '利用可能'
  },
  cardEditor: {
    newHeading: '新しいカード',
    editHeading: 'カードを編集',
    titleLabel: 'タイトル',
    titlePlaceholder: '何を進めますか？',
    detailsLabel: '詳細',
    detailsPlaceholder: '任意の背景、メモ、次のステップ。',
    priorityLabel: '優先度',
    priorityGroupAriaLabel: '優先度',
    statusLabel: 'タスクの状態',
    deleteButton: '削除',
    saveButton: 'カードを保存',
    moveStateCurrent: '現在',
    moveStateSelected: '選択中',
    markdownToolbar: {
      bold: '太字',
      italic: '斜体',
      heading: 'H2',
      quote: '引用',
      bullets: '箇条書き',
      numbers: '番号付き',
      code: 'コード',
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
    renameHeading: 'ボード名を変更',
    titleLabel: 'ボード名',
    titlePlaceholder: 'どのためのボードですか？',
    saveButton: 'ボードを保存',
    createButton: 'ボードを作成'
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
    cardTitleRequired: 'カード名は必須です。',
    cannotDeleteLastBoard: '最後のボードは削除できません。',
    boardNotFound: 'ボードが見つかりません。',
    cardNotFound: 'カードが見つかりません。',
    cardNotInSourceColumn: 'カードが移動元の列にありません。',
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
