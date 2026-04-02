import { createCard } from '../../../../../apps/katei/public/js/domain/workspace.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  createWorkspaceRecord
} from '../../../../../apps/katei/src/workspaces/workspace_record.js';
import {
  WorkspaceAccessDeniedError,
  WorkspaceImportConflictError,
  WorkspaceRevisionConflictError
} from '../../../../../apps/katei/src/workspaces/workspace_record_repository.js';

export function createFixtureWorkspaceRecord({
  viewerSub = 'fixture_debug_sub',
  boardTitle = 'Debug board',
  cardTitle = 'Smoke test card'
} = {}) {
  const initialRecord = createInitialWorkspaceRecord(viewerSub, {
    workspaceId: createHomeWorkspaceId(viewerSub),
    now: '2026-04-02T10:00:00.000Z'
  });
  let workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = boardTitle;
  workspace = createCard(workspace, 'main', {
    title: cardTitle,
    detailsMarkdown: 'Authenticated debug fixture'
  });

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: {
      type: 'human',
      id: viewerSub
    },
    now: '2026-04-02T11:00:00.000Z'
  });
}

export function createInMemoryWorkspaceRecordRepository({
  viewerSub = 'fixture_debug_sub',
  initialRecord = createFixtureWorkspaceRecord({ viewerSub })
} = {}) {
  let currentRecord = createWorkspaceRecord(initialRecord);

  function assertAuthorized(requestedViewerSub, workspaceId = null) {
    if (requestedViewerSub !== currentRecord.viewerSub) {
      throw new WorkspaceAccessDeniedError();
    }

    if (workspaceId && workspaceId !== currentRecord.workspaceId) {
      throw new WorkspaceAccessDeniedError();
    }
  }

  return {
    async loadOrCreateWorkspaceRecord({ viewerSub: requestedViewerSub, workspaceId = null } = {}) {
      assertAuthorized(requestedViewerSub, workspaceId);
      return structuredClone(currentRecord);
    },

    async listPendingWorkspaceInvitesForViewer({ viewerSub: requestedViewerSub } = {}) {
      assertAuthorized(requestedViewerSub);
      return [];
    },

    async listAccessibleWorkspacesForViewer({ viewerSub: requestedViewerSub } = {}) {
      assertAuthorized(requestedViewerSub);
      return [];
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({ viewerSub: requestedViewerSub, workspaceId = null } = {}) {
      assertAuthorized(requestedViewerSub, workspaceId);
      return structuredClone(currentRecord);
    },

    async replaceWorkspaceSnapshot({ viewerSub: requestedViewerSub, workspaceId = null, workspace, actor, expectedRevision } = {}) {
      assertAuthorized(requestedViewerSub, workspaceId);

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      currentRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: new Date().toISOString()
      });

      return structuredClone(currentRecord);
    },

    async importWorkspaceSnapshot({ viewerSub: requestedViewerSub, workspaceId = null, workspace, actor } = {}) {
      assertAuthorized(requestedViewerSub, workspaceId);

      if (currentRecord.revision !== 0) {
        throw new WorkspaceImportConflictError();
      }

      currentRecord = createUpdatedWorkspaceRecord(currentRecord, {
        workspace,
        actor,
        now: new Date().toISOString(),
        activityType: 'workspace.imported'
      });

      return structuredClone(currentRecord);
    },

    async replaceWorkspaceRecord({ record, expectedRevision } = {}) {
      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      currentRecord = createWorkspaceRecord(record);
      return structuredClone(currentRecord);
    }
  };
}
