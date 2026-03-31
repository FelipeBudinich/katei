export const WORKSPACE_MIGRATIONS = Object.freeze([]);

export function migrateWorkspaceSnapshot(workspace) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  let nextWorkspace = workspace;

  for (const migration of WORKSPACE_MIGRATIONS) {
    if (typeof migration?.up !== 'function') {
      continue;
    }

    const migratedWorkspace = migration.up(nextWorkspace);
    nextWorkspace = migratedWorkspace === undefined ? nextWorkspace : migratedWorkspace;
  }

  return nextWorkspace;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
