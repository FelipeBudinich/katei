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
    loading: 'Verifying your Google sign-in...'
  },
  workspace: {
    viewerSignedIn: 'Signed in',
    boardOptions: 'Options',
    addCard: 'Add Card',
    detailsLabel: 'Details',
    updatedLabel: 'Updated',
    cardCount: '{count} cards',
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
    deleteBoard: 'Delete Board'
  },
  cardEditor: {
    newHeading: 'New card',
    titleLabel: 'Title',
    titlePlaceholder: 'What needs doing?',
    detailsLabel: 'Details',
    detailsPlaceholder: 'Optional context, notes, or next steps.',
    priorityLabel: 'Priority',
    priorityGroupAriaLabel: 'Priority',
    statusLabel: 'Task Status',
    deleteButton: 'Delete',
    saveButton: 'Save Card'
  },
  cardViewDialog: {
    titlePlaceholder: 'Card title',
    detailsLabel: 'Details',
    updatedLabel: 'Updated'
  },
  boardEditor: {
    newHeading: 'New board',
    titleLabel: 'Board title',
    titlePlaceholder: 'What board is this for?',
    saveButton: 'Save Board'
  },
  confirmDialog: {
    deleteCardTitle: 'Delete card?',
    deleteCardMessage: 'This action cannot be undone.'
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
    loading: 'Verificando tu acceso con Google...'
  },
  workspace: {
    viewerSignedIn: 'Sesión iniciada',
    boardOptions: 'Opciones',
    addCard: 'Agregar tarjeta',
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado',
    cardCount: '{count} tarjetas',
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
    deleteBoard: 'Eliminar tablero'
  },
  cardEditor: {
    newHeading: 'Nueva tarjeta',
    titleLabel: 'Título',
    titlePlaceholder: '¿Qué hay que hacer?',
    detailsLabel: 'Detalles',
    detailsPlaceholder: 'Contexto, notas o próximos pasos opcionales.',
    priorityLabel: 'Prioridad',
    priorityGroupAriaLabel: 'Prioridad',
    statusLabel: 'Estado de la tarea',
    deleteButton: 'Eliminar',
    saveButton: 'Guardar tarjeta'
  },
  cardViewDialog: {
    titlePlaceholder: 'Título de la tarjeta',
    detailsLabel: 'Detalles',
    updatedLabel: 'Actualizado'
  },
  boardEditor: {
    newHeading: 'Nuevo tablero',
    titleLabel: 'Título del tablero',
    titlePlaceholder: '¿Para qué es este tablero?',
    saveButton: 'Guardar tablero'
  },
  confirmDialog: {
    deleteCardTitle: '¿Eliminar tarjeta?',
    deleteCardMessage: 'Esta acción no se puede deshacer.'
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
    loading: 'Google サインインを確認しています...'
  },
  workspace: {
    viewerSignedIn: 'サインイン済み',
    boardOptions: 'オプション',
    addCard: 'カードを追加',
    detailsLabel: '詳細',
    updatedLabel: '更新日時',
    cardCount: '{count} 件のカード',
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
    deleteBoard: 'ボードを削除'
  },
  cardEditor: {
    newHeading: '新しいカード',
    titleLabel: 'タイトル',
    titlePlaceholder: '何を進めますか？',
    detailsLabel: '詳細',
    detailsPlaceholder: '任意の背景、メモ、次のステップ。',
    priorityLabel: '優先度',
    priorityGroupAriaLabel: '優先度',
    statusLabel: 'タスクの状態',
    deleteButton: '削除',
    saveButton: 'カードを保存'
  },
  cardViewDialog: {
    titlePlaceholder: 'カード名',
    detailsLabel: '詳細',
    updatedLabel: '更新日時'
  },
  boardEditor: {
    newHeading: '新しいボード',
    titleLabel: 'ボード名',
    titlePlaceholder: 'どのためのボードですか？',
    saveButton: 'ボードを保存'
  },
  confirmDialog: {
    deleteCardTitle: 'カードを削除しますか？',
    deleteCardMessage: 'この操作は元に戻せません。'
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
