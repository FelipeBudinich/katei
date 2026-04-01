export function normalizeAccordionOpenIndex(openIndex, itemCount) {
  const normalizedItemCount = normalizeItemCount(itemCount);

  if (normalizedItemCount === 0) {
    return 0;
  }

  const normalizedIndex = Number(openIndex);

  if (!Number.isInteger(normalizedIndex)) {
    return 0;
  }

  if (normalizedIndex < 0 || normalizedIndex >= normalizedItemCount) {
    return 0;
  }

  return normalizedIndex;
}

export function getAccordionNextOpenIndex({
  currentOpenIndex = 0,
  requestedIndex = 0,
  itemCount = 0
} = {}) {
  const normalizedCurrentIndex = normalizeAccordionOpenIndex(currentOpenIndex, itemCount);
  const normalizedRequestedIndex = normalizeAccordionOpenIndex(requestedIndex, itemCount);

  if (normalizedRequestedIndex === normalizedCurrentIndex) {
    return normalizedCurrentIndex;
  }

  return normalizedRequestedIndex;
}

export function createAccordionItemStates({ itemCount = 0, openIndex = 0 } = {}) {
  const normalizedItemCount = normalizeItemCount(itemCount);
  const normalizedOpenIndex = normalizeAccordionOpenIndex(openIndex, normalizedItemCount);

  return Array.from({ length: normalizedItemCount }, (_, index) => {
    const isOpen = index === normalizedOpenIndex;

    return {
      index,
      isOpen,
      ariaExpanded: String(isOpen),
      hidden: !isOpen
    };
  });
}

function normalizeItemCount(itemCount) {
  const normalizedItemCount = Number(itemCount);

  if (!Number.isInteger(normalizedItemCount) || normalizedItemCount < 0) {
    return 0;
  }

  return normalizedItemCount;
}
