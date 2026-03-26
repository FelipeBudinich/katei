export function createBoardId() {
  return `board_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

export function createCardId() {
  return `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
