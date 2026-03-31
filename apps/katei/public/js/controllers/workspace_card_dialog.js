import { getCardContentVariant, getBoardCardContentVariant } from '../domain/workspace.js';

export function createRuntimeCardDialogState(card, board, { requestedLocale = null } = {}) {
  const content = getCardContentVariant(card, requestedLocale, board)
    ?? getBoardCardContentVariant(card, board);

  return {
    card,
    requestedLocale,
    displayVariant: content
  };
}
