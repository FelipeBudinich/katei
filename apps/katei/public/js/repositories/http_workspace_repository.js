import { migrateWorkspaceSnapshot } from '../domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../domain/workspace_validation.js';
import { postWorkspaceImport, readLocalV4Workspace } from '../lib/workspace_import.js';
import { WorkspaceRepository } from './workspace_repository.js';

export const WORKSPACE_CONFLICT_ERROR_MESSAGE = 'This workspace changed elsewhere. Refresh to continue.';

export class HttpWorkspaceRepository extends WorkspaceRepository {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    viewerSub,
    workspaceId = null,
    storage = globalThis.localStorage,
    document = globalThis.document
  } = {}) {
    super();
    this.fetchImpl = resolveFetch(fetchImpl);
    this.viewerSub = normalizeViewerSub(viewerSub);
    this.activeWorkspaceId = normalizeOptionalWorkspaceId(workspaceId);
    this.isHomeWorkspace = null;
    this.storage = storage ?? null;
    this.document = document ?? null;
    this.meta = null;
    this.revision = null;
    this.hasConsumedBootstrap = false;
  }

  async loadWorkspace() {
    let payload = this.#consumeBootstrapPayload();

    if (!payload) {
      payload = await this.#requestWorkspace(this.#buildWorkspaceUrl('/api/workspace'), {
        method: 'GET'
      }, 'Unable to load workspace.');
    }

    if (payload.meta?.isPristine && this.isHomeWorkspace) {
      const localWorkspace = readLocalV4Workspace(this.storage, this.viewerSub);

      if (localWorkspace) {
        try {
          const importedPayload = await postWorkspaceImport({
            fetchImpl: this.fetchImpl,
            workspace: localWorkspace,
            workspaceId: this.activeWorkspaceId
          });
          this.#setState(importedPayload);
        } catch (error) {
          if (error?.status !== 409) {
            throw error;
          }
        }

        payload = await this.#requestWorkspace(this.#buildWorkspaceUrl('/api/workspace'), {
          method: 'GET'
        }, 'Unable to load workspace.');
      }
    }

    return payload.workspace;
  }

  async saveWorkspace(workspace) {
    const normalizedWorkspace = normalizeWorkspaceSnapshot(workspace);

    if (!validateWorkspaceShape(normalizedWorkspace)) {
      throw new Error('Cannot save an invalid workspace.');
    }

    const payload = await this.#requestWorkspace(
      '/api/workspace',
      {
        method: 'PUT',
        body: JSON.stringify({
          workspace: normalizedWorkspace,
          workspaceId: this.activeWorkspaceId ?? normalizedWorkspace.workspaceId,
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
          workspaceId: this.activeWorkspaceId,
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

    const workspace = normalizeWorkspaceSnapshot(data?.workspace);

    if (!validateWorkspaceShape(workspace)) {
      throw new Error('Workspace API returned an invalid workspace.');
    }

    const payload = isPlainObject(data)
      ? {
          ...data,
          workspace
        }
      : { workspace };

    this.#setState(payload);
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
      const workspace = normalizeWorkspaceSnapshot(payload?.workspace);

      if (!validateWorkspaceShape(workspace)) {
        return null;
      }

      const nextPayload = isPlainObject(payload)
        ? {
            ...payload,
            workspace
          }
        : { workspace };

      this.#setState(nextPayload);
      return nextPayload;
    } catch (error) {
      return null;
    }
  }

  #setState(payload) {
    this.#setMeta(payload?.meta ?? null);
    const activeWorkspace = normalizeActiveWorkspace(payload?.activeWorkspace, payload?.workspace);

    this.activeWorkspaceId = activeWorkspace?.workspaceId ?? this.activeWorkspaceId ?? null;
    this.isHomeWorkspace =
      typeof activeWorkspace?.isHomeWorkspace === 'boolean' ? activeWorkspace.isHomeWorkspace : this.isHomeWorkspace;
  }

  #setMeta(meta) {
    this.meta = meta ?? null;
    this.revision = Number.isInteger(meta?.revision) ? meta.revision : null;
  }

  #buildWorkspaceUrl(pathname) {
    if (!this.activeWorkspaceId) {
      return pathname;
    }

    return `${pathname}?workspaceId=${encodeURIComponent(this.activeWorkspaceId)}`;
  }
}

function normalizeViewerSub(viewerSub) {
  if (typeof viewerSub !== 'string' || !viewerSub.trim()) {
    throw new Error('A verified viewer sub is required for workspace persistence.');
  }

  return viewerSub.trim();
}

function normalizeOptionalWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null;
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

function normalizeWorkspaceSnapshot(workspace) {
  return migrateWorkspaceSnapshot(workspace);
}

function normalizeActiveWorkspace(activeWorkspace, workspace) {
  const workspaceId =
    normalizeOptionalWorkspaceId(activeWorkspace?.workspaceId) ??
    normalizeOptionalWorkspaceId(workspace?.workspaceId);

  if (!workspaceId) {
    return null;
  }

  return {
    workspaceId,
    isHomeWorkspace: typeof activeWorkspace?.isHomeWorkspace === 'boolean' ? activeWorkspace.isHomeWorkspace : false
  };
}
