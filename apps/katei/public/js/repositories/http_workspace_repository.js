import { migrateWorkspaceSnapshot } from '../domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../domain/workspace_validation.js';
import { postWorkspaceImport, readLocalV4Workspace } from '../lib/workspace_import.js';
import { WorkspaceRepository } from './workspace_repository.js';

export const WORKSPACE_CONFLICT_ERROR_MESSAGE = 'This workspace changed elsewhere. Refresh to continue.';

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
    this.revision = null;
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
          const importedPayload = await postWorkspaceImport({
            fetchImpl: this.fetchImpl,
            workspace: localWorkspace
          });
          this.#setMeta(importedPayload.meta ?? null);
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
        body: JSON.stringify({
          workspace,
          expectedRevision: this.revision ?? 0
        })
      },
      'Unable to save workspace.'
    );

    return payload.workspace;
  }

  async applyCommand(command) {
    return this.#requestWorkspace(
      '/api/workspace/commands',
      {
        method: 'POST',
        body: JSON.stringify({
          command,
          expectedRevision: this.revision ?? 0
        })
      },
      'Unable to apply workspace command.'
    );
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

    const workspace = migrateWorkspaceSnapshot(data?.workspace);

    if (!validateWorkspaceShape(workspace)) {
      throw new Error('Workspace API returned an invalid workspace.');
    }

    const payload = isPlainObject(data)
      ? {
          ...data,
          workspace
        }
      : { workspace };

    this.#setMeta(payload.meta ?? null);
    return payload;
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
      const workspace = migrateWorkspaceSnapshot(payload?.workspace);

      if (!validateWorkspaceShape(workspace)) {
        return null;
      }

      const nextPayload = isPlainObject(payload)
        ? {
            ...payload,
            workspace
          }
        : { workspace };

      this.#setMeta(nextPayload.meta ?? null);
      return nextPayload;
    } catch (error) {
      return null;
    }
  }

  #setMeta(meta) {
    this.meta = meta ?? null;
    this.revision = Number.isInteger(meta?.revision) ? meta.revision : null;
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
  const message = response.status === 409 ? WORKSPACE_CONFLICT_ERROR_MESSAGE : (data?.error || fallbackMessage);
  const error = new Error(message);
  error.status = response.status;
  error.data = data;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
