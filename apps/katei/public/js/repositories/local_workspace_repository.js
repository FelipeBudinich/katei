import { WorkspaceRepository } from './workspace_repository.js';
import { stripLegacyColumnAliasesFromWorkspace } from '../domain/board_workflow.js';
import { stripLegacyCardContentAliasesFromWorkspace } from '../domain/card_localization.js';
import { createEmptyWorkspace } from '../domain/workspace_read_model.js';
import { migrateWorkspaceSnapshot } from '../domain/workspace_migrations.js';
import { validateWorkspaceShape } from '../domain/workspace_validation.js';

export const WORKSPACE_STORAGE_PREFIX = 'katei.workspace.v5:';

export function createWorkspaceStorageKey(viewerSub) {
  if (typeof viewerSub !== 'string' || !viewerSub.trim()) {
    throw new Error('A verified viewer sub is required for workspace storage.');
  }

  return `${WORKSPACE_STORAGE_PREFIX}${viewerSub.trim()}`;
}

export class LocalWorkspaceRepository extends WorkspaceRepository {
  constructor(storage = globalThis.localStorage, viewerSub) {
    super();
    this.storage = storage;
    this.storageKey = createWorkspaceStorageKey(viewerSub);
  }

  async loadWorkspace() {
    if (!this.storage) {
      return createEmptyWorkspace();
    }

    try {
      const rawValue = this.storage.getItem(this.storageKey);

      if (!rawValue) {
        return createEmptyWorkspace();
      }

      const parsedValue = migrateWorkspaceSnapshot(JSON.parse(rawValue));

      return validateWorkspaceShape(parsedValue) ? parsedValue : createEmptyWorkspace();
    } catch (error) {
      return createEmptyWorkspace();
    }
  }

  async saveWorkspace(workspace) {
    const normalizedWorkspace = stripLegacyCardContentAliasesFromWorkspace(
      stripLegacyColumnAliasesFromWorkspace(migrateWorkspaceSnapshot(workspace))
    );

    if (!validateWorkspaceShape(normalizedWorkspace)) {
      throw new Error('Cannot save an invalid workspace.');
    }

    if (this.storage) {
      this.storage.setItem(this.storageKey, JSON.stringify(normalizedWorkspace));
    }

    return workspace;
  }
}
