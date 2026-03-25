export function createCardId() {
  return `card_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
}
