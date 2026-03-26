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

  async createCard(input, targetColumnId = 'backlog') {
    return this.#applyMutation((board) => createCard(board, input, targetColumnId));
  }

  async updateCard(cardId, updates) {
    return this.#applyMutation((board) => updateCard(board, cardId, updates));
  }

  async saveCard(cardId, updates, sourceColumnId, targetColumnId) {
    return this.#applyMutation((board) => {
      let nextBoard = updateCard(board, cardId, updates);

      if (sourceColumnId && targetColumnId && sourceColumnId !== targetColumnId) {
        nextBoard = moveCard(nextBoard, cardId, sourceColumnId, targetColumnId);
      }

      return nextBoard;
    });
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
