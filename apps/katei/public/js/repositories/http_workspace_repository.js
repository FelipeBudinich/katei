import { validateWorkspaceShape } from '../domain/workspace.js';
import { postWorkspaceImport, readLocalV4Workspace } from '../lib/workspace_import.js';
import { WorkspaceRepository } from './workspace_repository.js';

export class HttpWorkspaceRepository extends WorkspaceRepository {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    viewerSub,
    storage = globalThis.localStorage,
    document = globalThis.document
  } = {}) {
    super();
    this.fetchImpl = resolveFetch(fetchImpl);
    this.viewerSub = normalizeViewerSub(viewerSub);
    this.storage = storage ?? null;
    this.document = document ?? null;
    this.meta = null;
    this.hasConsumedBootstrap = false;
  }

  async loadWorkspace() {
    let payload = this.#consumeBootstrapPayload();

    if (!payload) {
      payload = await this.#requestWorkspace('/api/workspace', {
        method: 'GET'
      }, 'Unable to load workspace.');
    }

    if (payload.meta?.isPristine) {
      const localWorkspace = readLocalV4Workspace(this.storage, this.viewerSub);

      if (localWorkspace) {
        try {
          await postWorkspaceImport({
            fetchImpl: this.fetchImpl,
            workspace: localWorkspace
          });
        } catch (error) {
          if (error?.status !== 409) {
            throw error;
          }
        }

        payload = await this.#requestWorkspace('/api/workspace', {
          method: 'GET'
        }, 'Unable to load workspace.');
      }
    }

    return payload.workspace;
  }

  async saveWorkspace(workspace) {
    if (!validateWorkspaceShape(workspace)) {
      throw new Error('Cannot save an invalid workspace.');
    }

    const payload = await this.#requestWorkspace(
      '/api/workspace',
      {
        method: 'PUT',
        body: JSON.stringify({ workspace })
      },
      'Unable to save workspace.'
    );

    return payload.workspace;
  }

  async #requestWorkspace(url, options, fallbackMessage) {
    const response = await this.fetchImpl(url, {
      credentials: 'same-origin',
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers ?? {})
      }
    });
    const data = await parseJsonResponse(response);

    if (!response.ok) {
      throw createWorkspaceApiError(response, data, fallbackMessage);
    }

    if (!validateWorkspaceShape(data?.workspace)) {
      throw new Error('Workspace API returned an invalid workspace.');
    }

    this.meta = data.meta ?? null;
    return data;
  }

  #consumeBootstrapPayload() {
    if (this.hasConsumedBootstrap) {
      return null;
    }

    this.hasConsumedBootstrap = true;

    if (!this.document || typeof this.document.getElementById !== 'function') {
      return null;
    }

    const bootstrapElement = this.document.getElementById('workspace-bootstrap');

    if (!bootstrapElement?.textContent) {
      return null;
    }

    try {
      const payload = JSON.parse(bootstrapElement.textContent);

      if (!validateWorkspaceShape(payload?.workspace)) {
        return null;
      }

      this.meta = payload.meta ?? null;
      return payload;
    } catch (error) {
      return null;
    }
  }
}

function normalizeViewerSub(viewerSub) {
  if (typeof viewerSub !== 'string' || !viewerSub.trim()) {
    throw new Error('A verified viewer sub is required for workspace persistence.');
  }

  return viewerSub.trim();
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
