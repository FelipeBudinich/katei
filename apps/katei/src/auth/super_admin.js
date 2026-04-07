export function isSuperAdminViewer(viewer, superAdmins) {
  if (!(superAdmins instanceof Set) || superAdmins.size === 0) {
    return false;
  }

  const normalizedViewerEmail = normalizeOptionalComparableEmail(viewer?.email);

  if (!normalizedViewerEmail) {
    return false;
  }

  return superAdmins.has(normalizedViewerEmail);
}

function normalizeOptionalComparableEmail(value) {
  const normalizedValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalizedValue.includes('@') ? normalizedValue : '';
}
