import { BoardRepository } from './board_repository.js';
import { STORAGE_KEY, createEmptyBoard, validateBoardShape } from '../domain/board.js';

export class LocalBoardRepository extends BoardRepository {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
  }

  async loadBoard() {
    if (!this.storage) {
      return createEmptyBoard();
    }

    try {
      const rawValue = this.storage.getItem(STORAGE_KEY);

      if (!rawValue) {
        return createEmptyBoard();
      }

      const parsedValue = JSON.parse(rawValue);

      return validateBoardShape(parsedValue) ? parsedValue : createEmptyBoard();
    } catch (error) {
      return createEmptyBoard();
    }
  }

  async saveBoard(board) {
    if (!validateBoardShape(board)) {
      throw new Error('Cannot save an invalid board.');
    }

    if (this.storage) {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(board));
    }

    return board;
  }

  async resetBoard() {
    if (this.storage) {
      this.storage.removeItem(STORAGE_KEY);
    }

    return createEmptyBoard();
  }
}
