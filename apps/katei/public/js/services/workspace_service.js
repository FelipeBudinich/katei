import {
  createBoard,
  createCard,
  deleteBoard,
  deleteCard,
  moveCard,
  renameBoard,
  resetBoard,
  setActiveBoard,
  updateCard
} from '../domain/workspace.js';

export class WorkspaceService {
  constructor(repository) {
    this.repository = repository;
  }

  async load() {
    return this.repository.loadWorkspace();
  }

  async createBoard(input) {
    return this.#applyMutation((workspace) => createBoard(workspace, input));
  }

  async renameBoard(boardId, title) {
    return this.#applyMutation((workspace) => renameBoard(workspace, boardId, title));
  }

  async deleteBoard(boardId) {
    return this.#applyMutation((workspace) => deleteBoard(workspace, boardId));
  }

  async setActiveBoard(boardId) {
    return this.#applyMutation((workspace) => setActiveBoard(workspace, boardId));
  }

  async resetBoard(boardId) {
    return this.#applyMutation((workspace) => resetBoard(workspace, boardId));
  }

  async createCard(boardId, input) {
    return this.#applyMutation((workspace) => createCard(workspace, boardId, input));
  }

  async updateCard(boardId, cardId, updates) {
    return this.#applyMutation((workspace) => updateCard(workspace, boardId, cardId, updates));
  }

  async deleteCard(boardId, cardId) {
    return this.#applyMutation((workspace) => deleteCard(workspace, boardId, cardId));
  }

  async moveCard(boardId, cardId, sourceColumnId, targetColumnId) {
    return this.#applyMutation((workspace) =>
      moveCard(workspace, boardId, cardId, sourceColumnId, targetColumnId)
    );
  }

  async #applyMutation(mutator) {
    const workspace = await this.repository.loadWorkspace();
    const nextWorkspace = mutator(workspace);
    return this.repository.saveWorkspace(nextWorkspace);
  }
}
