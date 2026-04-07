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

export class WorkspaceAccessDeniedError extends Error {
  constructor(message = 'Workspace not found.') {
    super(message);
    this.name = 'WorkspaceAccessDeniedError';
    this.code = 'WORKSPACE_ACCESS_DENIED';
  }
}

export class WorkspaceTitleManagementPermissionError extends Error {
  constructor(message = 'Workspace title management is only available to super admins.') {
    super(message);
    this.name = 'WorkspaceTitleManagementPermissionError';
    this.code = 'WORKSPACE_TITLE_MANAGEMENT_FORBIDDEN';
  }
}

export class WorkspaceBoardRoleAssignmentPermissionError extends Error {
  constructor(message = 'Board self-role assignment is only available to super admins.') {
    super(message);
    this.name = 'WorkspaceBoardRoleAssignmentPermissionError';
    this.code = 'WORKSPACE_BOARD_ROLE_ASSIGNMENT_FORBIDDEN';
  }
}

export class WorkspaceRecordRepository {
  async loadOrCreateWorkspaceRecord({ viewerSub, workspaceId, viewerEmail } = {}) {
    throw new Error('Not implemented');
  }

  async listPendingWorkspaceInvitesForViewer({ viewerSub, viewerEmail = null } = {}) {
    throw new Error('Not implemented');
  }

  async listAccessibleWorkspacesForViewer({ viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
    throw new Error('Not implemented');
  }

  async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub, workspaceId, viewerEmail } = {}) {
    throw new Error('Not implemented');
  }

  async loadWorkspaceRecordForSuperAdminTitleManagement({ viewerIsSuperAdmin, workspaceId } = {}) {
    throw new Error('Not implemented');
  }

  async loadWorkspaceRecordForSuperAdminBoardRoleAssignment({ viewerIsSuperAdmin, workspaceId } = {}) {
    throw new Error('Not implemented');
  }

  async saveWorkspaceTitleForSuperAdmin({ viewerIsSuperAdmin, workspaceId, title, actor, expectedRevision } = {}) {
    throw new Error('Not implemented');
  }

  async replaceWorkspaceSnapshot({ viewerSub, workspaceId, viewerEmail, workspace, actor, expectedRevision }) {
    throw new Error('Not implemented');
  }

  async importWorkspaceSnapshot({ viewerSub, workspaceId, viewerEmail, workspace, actor }) {
    throw new Error('Not implemented');
  }

  async replaceWorkspaceRecord({ record, expectedRevision }) {
    throw new Error('Not implemented');
  }
}
