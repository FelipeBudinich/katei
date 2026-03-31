export class WorkspaceService {
  constructor(repository) {
    this.repository = repository;
  }

  async load() {
    return this.repository.loadWorkspace();
  }

  getActiveWorkspaceId() {
    if (typeof this.repository.getActiveWorkspaceId === 'function') {
      return this.repository.getActiveWorkspaceId();
    }

    return this.repository.activeWorkspaceId ?? null;
  }

  setActiveWorkspace(workspaceId) {
    if (typeof this.repository.setActiveWorkspace === 'function') {
      this.repository.setActiveWorkspace(workspaceId);
    } else {
      this.repository.activeWorkspaceId = workspaceId ?? null;
    }
  }

  async switchWorkspace(workspaceId) {
    this.setActiveWorkspace(workspaceId);
    return this.load();
  }

  async createBoard(input) {
    return this.#applyCommand('board.create', {
      title: input?.title,
      ...buildBoardSchemaPayload(input)
    });
  }

  async renameBoard(boardId, title) {
    return this.#applyCommand('board.rename', {
      boardId,
      title
    });
  }

  async updateBoard(boardId, input) {
    return this.#applyCommand('board.update', {
      boardId,
      title: input?.title,
      ...buildBoardSchemaPayload(input)
    });
  }

  async deleteBoard(boardId) {
    return this.#applyCommand('board.delete', {
      boardId
    });
  }

  async setActiveBoard(boardId) {
    return this.#applyCommand('ui.activeBoard.set', {
      boardId
    });
  }

  async setColumnCollapsed(boardId, columnId, isCollapsed) {
    return this.#applyCommand('ui.columnCollapsed.set', {
      boardId,
      columnId,
      isCollapsed
    });
  }

  async resetBoard(boardId) {
    return this.#applyCommand('board.reset', {
      boardId
    });
  }

  async inviteBoardMember(boardId, email, role) {
    return this.#applyCommand('board.invite.create', {
      boardId,
      email,
      role
    });
  }

  async revokeBoardInvite(boardId, inviteId) {
    return this.#applyCommand('board.invite.revoke', {
      boardId,
      inviteId
    });
  }

  async acceptBoardInvite(boardId, inviteId) {
    return this.#applyCommand('board.invite.accept', {
      boardId,
      inviteId
    });
  }

  async declineBoardInvite(boardId, inviteId) {
    return this.#applyCommand('board.invite.decline', {
      boardId,
      inviteId
    });
  }

  async setBoardMemberRole(boardId, actor, role) {
    return this.#applyCommand('board.member.role.set', {
      boardId,
      targetActor: actor,
      role
    });
  }

  async removeBoardMember(boardId, actor) {
    return this.#applyCommand('board.member.remove', {
      boardId,
      targetActor: actor
    });
  }

  async createCard(boardId, input) {
    return this.#applyCommand('card.create', {
      boardId,
      title: input?.title,
      detailsMarkdown: input?.detailsMarkdown,
      priority: input?.priority
    });
  }

  async updateCard(boardId, cardId, updates) {
    return this.#applyCommand('card.update', {
      boardId,
      cardId,
      ...updates
    });
  }

  async upsertCardLocale(boardId, cardId, locale, input) {
    return this.#applyCommand('card.locale.upsert', {
      boardId,
      cardId,
      locale,
      title: input?.title,
      detailsMarkdown: input?.detailsMarkdown
    });
  }

  async requestCardLocale(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.request', {
      boardId,
      cardId,
      locale
    });
  }

  async clearCardLocaleRequest(boardId, cardId, locale) {
    return this.#applyCommand('card.locale.request.clear', {
      boardId,
      cardId,
      locale
    });
  }

  async deleteCard(boardId, cardId) {
    return this.#applyCommand('card.delete', {
      boardId,
      cardId
    });
  }

  async moveCard(boardId, cardId, sourceColumnId, targetColumnId) {
    return this.#applyCommand('card.move', {
      boardId,
      cardId,
      sourceColumnId,
      targetColumnId
    });
  }

  async #applyCommand(type, payload) {
    const response = await this.repository.applyCommand({
      clientMutationId: createClientMutationId(),
      type,
      payload
    });

    return response?.workspace ?? response;
  }
}

function createClientMutationId() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().replaceAll('-', '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return `cmd_${randomId}`;
}

function buildBoardSchemaPayload(input) {
  const payload = {};

  if (input?.languagePolicy !== undefined) {
    payload.languagePolicy = input.languagePolicy;
  }

  if (input?.stageDefinitions !== undefined) {
    payload.stageDefinitions = input.stageDefinitions;
  }

  if (input?.templates !== undefined) {
    payload.templates = input.templates;
  }

  return payload;
}
