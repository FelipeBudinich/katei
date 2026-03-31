export function isHumanAuthoredVariant(variant) {
  if (!hasVariantContent(variant)) {
    return false;
  }

  const provenance = isPlainObject(variant?.provenance) ? variant.provenance : null;

  if (!provenance) {
    return true;
  }

  if (provenance.includesHumanInput === true) {
    return true;
  }

  return normalizeOptionalString(provenance.actor?.type).toLowerCase() === 'human';
}

export function shouldBlockAutomatedLocaleOverwrite({ existingVariant, incomingProvenance }) {
  return isHumanAuthoredVariant(existingVariant) && isAutomatedIncomingProvenance(incomingProvenance);
}

function isAutomatedIncomingProvenance(provenance) {
  if (!isPlainObject(provenance)) {
    return false;
  }

  if (provenance.includesHumanInput === true) {
    return false;
  }

  if (provenance.includesHumanInput === false) {
    return true;
  }

  const actorType = normalizeOptionalString(provenance.actor?.type).toLowerCase();
  return actorType === 'agent' || actorType === 'system';
}

function hasVariantContent(variant) {
  if (!isPlainObject(variant)) {
    return false;
  }

  const title = normalizeOptionalString(variant.title);
  const detailsMarkdown = normalizeOptionalString(variant.detailsMarkdown);

  return title.length > 0 || detailsMarkdown.length > 0;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
