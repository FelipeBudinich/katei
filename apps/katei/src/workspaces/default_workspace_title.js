export function resolveWorkspaceCreationTitle({
  requestedTitle = null,
  displayName = null,
  email = null,
  existingWorkspaceTitles = []
} = {}) {
  const normalizedRequestedTitle = normalizeOptionalString(requestedTitle);

  if (normalizedRequestedTitle) {
    return normalizedRequestedTitle;
  }

  return getNextDefaultWorkspaceTitle({
    displayName,
    email,
    existingWorkspaceTitles
  });
}

export function getNextDefaultWorkspaceTitle({
  displayName = null,
  email = null,
  existingWorkspaceTitles = []
} = {}) {
  const baseTitle = resolveDefaultWorkspaceTitleBase({ displayName, email });
  const titlePattern = new RegExp(`^${escapeRegExp(baseTitle)} ([1-9]\\d*)$`);
  let maxSequence = 0;

  for (const title of Array.isArray(existingWorkspaceTitles) ? existingWorkspaceTitles : []) {
    const normalizedTitle = normalizeOptionalString(title);
    const match = normalizedTitle.match(titlePattern);

    if (!match) {
      continue;
    }

    const sequence = Number.parseInt(match[1], 10);

    if (Number.isInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence;
    }
  }

  return `${baseTitle} ${maxSequence + 1}`;
}

export function resolveDefaultWorkspaceTitleBase({ displayName = null, email = null } = {}) {
  return normalizeOptionalString(displayName) || normalizeOptionalString(email) || 'Workspace';
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
