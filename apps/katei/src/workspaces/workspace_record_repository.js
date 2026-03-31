export class WorkspaceImportConflictError extends Error {
  constructor(message = 'Workspace import is only allowed while the server workspace is still pristine.') {
    super(message);
    this.name = 'WorkspaceImportConflictError';
    this.code = 'WORKSPACE_IMPORT_CONFLICT';
  }
}

export class WorkspaceRevisionConflictError extends Error {
  constructor(message = 'This workspace changed elsewhere. Refresh to continue.') {
    super(message);
    this.name = 'WorkspaceRevisionConflictError';
    this.code = 'WORKSPACE_REVISION_CONFLICT';
  }
}

export class WorkspaceRecordRepository {
  async loadOrCreateWorkspaceRecord(viewerSub) {
    throw new Error('Not implemented');
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspace, actor, expectedRevision }) {
    throw new Error('Not implemented');
  }

  async importWorkspaceSnapshot({ viewerSub, workspace, actor }) {
    throw new Error('Not implemented');
  }

  async replaceWorkspaceRecord({ record, expectedRevision }) {
    throw new Error('Not implemented');
  }
}
