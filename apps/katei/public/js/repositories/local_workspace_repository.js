import { WorkspaceRepository } from './workspace_repository.js';
import { STORAGE_KEY, createEmptyWorkspace, validateWorkspaceShape } from '../domain/workspace.js';

export class LocalWorkspaceRepository extends WorkspaceRepository {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
  }

  async loadWorkspace() {
    if (!this.storage) {
      return createEmptyWorkspace();
    }

    try {
      const rawValue = this.storage.getItem(STORAGE_KEY);

      if (!rawValue) {
        return createEmptyWorkspace();
      }

      const parsedValue = JSON.parse(rawValue);

      return validateWorkspaceShape(parsedValue) ? parsedValue : createEmptyWorkspace();
    } catch (error) {
      return createEmptyWorkspace();
    }
  }

  async saveWorkspace(workspace) {
    if (!validateWorkspaceShape(workspace)) {
      throw new Error('Cannot save an invalid workspace.');
    }

    if (this.storage) {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    }

    return workspace;
  }
}
