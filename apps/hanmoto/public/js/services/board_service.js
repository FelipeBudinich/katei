import {
  createCard,
  deleteCard,
  moveCard,
  setActiveColumn,
  updateCard
} from '../domain/board.js';

export class BoardService {
  constructor(repository) {
    this.repository = repository;
  }

  async load() {
    return this.repository.loadBoard();
  }

  async createCard(input) {
    return this.#applyMutation((board) => createCard(board, input));
  }

  async updateCard(cardId, updates) {
    return this.#applyMutation((board) => updateCard(board, cardId, updates));
  }

  async deleteCard(cardId) {
    return this.#applyMutation((board) => deleteCard(board, cardId));
  }

  async moveCard(cardId, sourceColumnId, targetColumnId) {
    return this.#applyMutation((board) => moveCard(board, cardId, sourceColumnId, targetColumnId));
  }

  async setActiveColumn(columnId) {
    return this.#applyMutation((board) => setActiveColumn(board, columnId));
  }

  async reset() {
    return this.repository.resetBoard();
  }

  async #applyMutation(mutator) {
    const board = await this.repository.loadBoard();
    const nextBoard = mutator(board);
    return this.repository.saveBoard(nextBoard);
  }
}
