import { migrateWorkspaceSnapshot } from '../domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../domain/workspace_validation.js';
import { createWorkspaceStorageKey } from '../repositories/local_workspace_repository.js';

export function readLocalV4Workspace(storage = globalThis.localStorage, viewerSub) {
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(createWorkspaceStorageKey(viewerSub));

    if (!rawValue) {
      return null;
    }

    const workspace = migrateWorkspaceSnapshot(JSON.parse(rawValue));

    return validateWorkspaceShape(workspace) ? workspace : null;
  } catch (error) {
    return null;
  }
}

export async function postWorkspaceImport({ fetchImpl = globalThis.fetch?.bind(globalThis), workspace } = {}) {
  if (!validateWorkspaceShape(workspace)) {
    throw new Error('Cannot import an invalid workspace.');
  }

  const response = await resolveFetch(fetchImpl)('/api/workspace/import', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    credentials: 'same-origin',
    body: JSON.stringify({ workspace })
  });
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    throw createWorkspaceApiError(response, data, 'Unable to import workspace.');
  }

  return data;
}

function resolveFetch(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required for workspace persistence.');
  }

  return fetchImpl;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function createWorkspaceApiError(response, data, fallbackMessage) {
  const error = new Error(data?.error || fallbackMessage);
  error.status = response.status;
  error.data = data;
  return error;
}
