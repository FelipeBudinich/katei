export class WorkspaceService {
  constructor(repository) {
    this.repository = repository;
  }

  async load() {
    return this.repository.loadWorkspace();
  }

  async createBoard(input) {
    return this.#applyCommand('board.create', {
      title: input?.title
    });
  }

  async renameBoard(boardId, title) {
    return this.#applyCommand('board.rename', {
      boardId,
      title
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
