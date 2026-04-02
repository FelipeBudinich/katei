import { createCard } from '../../../../../apps/katei/public/js/domain/workspace.js';
import { createEmptyWorkspace } from '../../../../../apps/katei/public/js/domain/workspace_read_model.js';
import { projectRecordForViewer } from '../../../../../apps/katei/src/workspaces/mongo_workspace_record_repository.js';
import {
  createHomeWorkspaceId,
  createInitialWorkspaceRecord,
  createUpdatedWorkspaceRecord,
  createWorkspaceRecord
} from '../../../../../apps/katei/src/workspaces/workspace_record.js';
import { canViewerAccessWorkspace } from '../../../../../apps/katei/src/workspaces/workspace_access.js';
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

export function createWorkspaceSwitchReproFixture({
  viewerSub = 'fixture_debug_sub',
  viewerEmail = 'fixture-debug@example.com',
  boardTitle = 'Debug board',
  cardTitle = 'Smoke test card'
} = {}) {
  const homeRecord = createFixtureWorkspaceRecord({
    viewerSub,
    boardTitle,
    cardTitle
  });
  const externalNotesWorkspaceId = 'workspace_shared_notes';
  const externalMainWorkspaceId = 'workspace_shared_main';
  const externalHomeWorkspaceId = createHomeWorkspaceId('sub_owner_casa');
  const inviteWorkspaceId = 'workspace_invited_casa';
  const readableNotesRecord = createSharedWorkspaceRecordFixture(externalNotesWorkspaceId, {
    ownerSub: 'sub_owner_notes',
    ownerEmail: 'owner-notes@example.com',
    memberSub: viewerSub,
    memberEmail: viewerEmail,
    memberRole: 'viewer',
    memberBoardId: 'notes',
    memberBoardTitle: 'Notes',
    includeInvite: false
  });
  const readableMainRecord = createReadableMainWorkspaceRecordFixture(externalMainWorkspaceId, {
    ownerSub: 'sub_owner_main',
    ownerEmail: 'owner-main@example.com',
    memberSub: viewerSub,
    memberEmail: viewerEmail,
    memberRole: 'viewer',
    boardTitle: 'Shared Main'
  });
  const readableHomeRecord = createExternalHomeWorkspaceRecordFixture({
    ownerSub: 'sub_owner_casa',
    ownerEmail: 'owner-casa@example.com',
    ownerName: 'Casa owner',
    viewerSub,
    viewerEmail,
    boardTitle: 'Casa'
  });
  const inviteRecord = createInviteOnlyWorkspaceRecordFixture(inviteWorkspaceId, {
    viewerSub,
    viewerEmail
  });
  const records = [
    homeRecord,
    readableHomeRecord,
    readableMainRecord,
    readableNotesRecord,
    inviteRecord
  ];

  return {
    viewer: {
      sub: viewerSub,
      email: viewerEmail
    },
    homeWorkspaceId: homeRecord.workspaceId,
    externalNotesWorkspaceId,
    externalMainWorkspaceId,
    externalHomeWorkspaceId,
    inviteWorkspaceId,
    records
  };
}

export function createInMemoryWorkspaceRecordRepository({
  viewerSub = 'fixture_debug_sub',
  viewerEmail = 'fixture-debug@example.com',
  initialRecord = null
} = {}) {
  const fixture = initialRecord
    ? {
        viewer: {
          sub: viewerSub,
          email: viewerEmail
        },
        homeWorkspaceId: initialRecord.workspaceId,
        records: [createWorkspaceRecord(initialRecord)]
      }
    : createWorkspaceSwitchReproFixture({
        viewerSub,
        viewerEmail
      });
  const recordsByWorkspaceId = new Map(
    fixture.records.map((record) => {
      const normalizedRecord = createWorkspaceRecord(record);
      return [normalizedRecord.workspaceId, normalizedRecord];
    })
  );

  function assertViewerIdentity(requestedViewerSub) {
    if (requestedViewerSub !== fixture.viewer.sub) {
      throw new WorkspaceAccessDeniedError();
    }
  }

  function resolveRecord(workspaceId = null, { viewerSub: requestedViewerSub, viewerEmail: requestedViewerEmail = null } = {}) {
    assertViewerIdentity(requestedViewerSub);

    const targetWorkspaceId = normalizeOptionalWorkspaceId(workspaceId) ?? fixture.homeWorkspaceId;
    const record = targetWorkspaceId ? recordsByWorkspaceId.get(targetWorkspaceId) ?? null : null;

    if (!record) {
      throw new WorkspaceAccessDeniedError();
    }

    if (
      !canViewerAccessWorkspace({
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail,
        ownerSub: record.viewerSub,
        workspace: record.workspace
      })
    ) {
      throw new WorkspaceAccessDeniedError();
    }

    return createWorkspaceRecord(record);
  }

  function setRecord(record) {
    const normalizedRecord = createWorkspaceRecord(record);
    recordsByWorkspaceId.set(normalizedRecord.workspaceId, normalizedRecord);
    return normalizedRecord;
  }

  return {
    fixture,

    async loadOrCreateWorkspaceRecord({ viewerSub: requestedViewerSub, workspaceId = null, viewerEmail: requestedViewerEmail = null } = {}) {
      const record = resolveRecord(workspaceId, {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });

      return projectRecordForViewer(record, {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });
    },

    async listPendingWorkspaceInvitesForViewer({ viewerSub: requestedViewerSub, viewerEmail: requestedViewerEmail = null } = {}) {
      assertViewerIdentity(requestedViewerSub);
      return listPendingWorkspaceInvites([...recordsByWorkspaceId.values()], {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });
    },

    async listAccessibleWorkspacesForViewer({
      viewerSub: requestedViewerSub,
      viewerEmail: requestedViewerEmail = null,
      excludeWorkspaceId = null
    } = {}) {
      assertViewerIdentity(requestedViewerSub);
      return listAccessibleWorkspaces([...recordsByWorkspaceId.values()], {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail,
        excludeWorkspaceId
      });
    },

    async loadOrCreateAuthoritativeWorkspaceRecord({
      viewerSub: requestedViewerSub,
      workspaceId = null,
      viewerEmail: requestedViewerEmail = null
    } = {}) {
      return resolveRecord(workspaceId, {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });
    },

    async replaceWorkspaceSnapshot({
      viewerSub: requestedViewerSub,
      workspaceId = null,
      viewerEmail: requestedViewerEmail = null,
      workspace,
      actor,
      expectedRevision
    } = {}) {
      const currentRecord = resolveRecord(workspaceId, {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });

      if (currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      return structuredClone(
        setRecord(
          createUpdatedWorkspaceRecord(currentRecord, {
            workspace,
            actor,
            now: new Date().toISOString()
          })
        )
      );
    },

    async importWorkspaceSnapshot({
      viewerSub: requestedViewerSub,
      workspaceId = null,
      viewerEmail: requestedViewerEmail = null,
      workspace,
      actor
    } = {}) {
      const currentRecord = resolveRecord(workspaceId, {
        viewerSub: requestedViewerSub,
        viewerEmail: requestedViewerEmail
      });

      if (currentRecord.revision !== 0) {
        throw new WorkspaceImportConflictError();
      }

      return structuredClone(
        setRecord(
          createUpdatedWorkspaceRecord(currentRecord, {
            workspace,
            actor,
            now: new Date().toISOString(),
            activityType: 'workspace.imported'
          })
        )
      );
    },

    async replaceWorkspaceRecord({ record, expectedRevision } = {}) {
      const normalizedRecord = createWorkspaceRecord(record);
      const currentRecord = recordsByWorkspaceId.get(normalizedRecord.workspaceId);

      if (!currentRecord || currentRecord.revision !== expectedRevision) {
        throw new WorkspaceRevisionConflictError();
      }

      return structuredClone(setRecord(normalizedRecord));
    }
  };
}

function createSharedWorkspaceRecordFixture(
  workspaceId,
  {
    ownerSub = 'sub_owner',
    ownerEmail = 'owner@example.com',
    memberSub = 'sub_member',
    memberEmail = 'member@example.com',
    memberRole = 'viewer',
    memberBoardId = 'member',
    memberBoardTitle = 'Member board',
    includeInvite = true
  } = {}
) {
  let workspace = createCard(
    createEmptyWorkspace({
      workspaceId,
      creator: {
        type: 'human',
        id: ownerSub,
        email: ownerEmail
      }
    }),
    'main',
    {
      title: 'Owner board card',
      detailsMarkdown: 'Hidden from the collaborator.',
      priority: 'important'
    }
  );

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: ownerSub, email: ownerEmail },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  workspace = addSharedBoard(workspace, memberBoardId, memberBoardTitle, {
    memberships: [
      {
        actor: { type: 'human', id: memberSub, email: memberEmail },
        role: memberRole,
        joinedAt: '2026-04-02T10:05:00.000Z'
      }
    ],
    card: {
      title: `${memberBoardTitle} card`,
      detailsMarkdown: 'Visible to the collaborator.',
      priority: 'urgent'
    }
  });

  if (includeInvite) {
    workspace = addSharedBoard(workspace, 'invite', 'Invite board', {
      invites: [
        {
          id: 'invite_1',
          email: memberEmail,
          role: 'viewer',
          status: 'pending',
          invitedBy: { type: 'human', id: ownerSub, email: ownerEmail },
          invitedAt: '2026-04-02T10:15:00.000Z'
        }
      ],
      card: {
        title: 'Invite board card',
        detailsMarkdown: 'Should be redacted until the invite is accepted.',
        priority: 'normal'
      }
    });
  }

  workspace.boardOrder = includeInvite ? ['main', memberBoardId, 'invite'] : ['main', memberBoardId];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord(ownerSub, {
      workspaceId,
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: ownerSub },
      now: '2026-04-02T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function createReadableMainWorkspaceRecordFixture(
  workspaceId,
  {
    ownerSub = 'sub_owner',
    ownerEmail = 'owner@example.com',
    memberSub = 'sub_member',
    memberEmail = 'member@example.com',
    memberRole = 'viewer',
    boardTitle = 'Shared Main'
  } = {}
) {
  let workspace = createCard(
    createEmptyWorkspace({
      workspaceId,
      creator: {
        type: 'human',
        id: ownerSub,
        email: ownerEmail
      }
    }),
    'main',
    {
      title: 'Shared main card',
      detailsMarkdown: 'Visible in the external main workspace.',
      priority: 'important'
    }
  );

  workspace.boards.main.title = boardTitle;
  workspace.boards.main.collaboration.memberships = [
    {
      actor: { type: 'human', id: ownerSub, email: ownerEmail },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    },
    {
      actor: { type: 'human', id: memberSub, email: memberEmail },
      role: memberRole,
      joinedAt: '2026-04-02T10:05:00.000Z'
    }
  ];
  workspace.boardOrder = ['main'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord(ownerSub, {
      workspaceId,
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: ownerSub },
      now: '2026-04-02T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function createExternalHomeWorkspaceRecordFixture({
  ownerSub = 'sub_owner_casa',
  ownerEmail = 'owner-casa@example.com',
  ownerName = 'Casa owner',
  viewerSub = 'sub_member',
  viewerEmail = 'member@example.com',
  viewerRole = 'viewer',
  boardTitle = 'Casa'
} = {}) {
  const initialRecord = createInitialWorkspaceRecord(ownerSub, {
    workspaceId: createHomeWorkspaceId(ownerSub),
    now: '2026-04-02T10:00:00.000Z'
  });
  const workspace = structuredClone(initialRecord.workspace);

  workspace.boards.main.title = boardTitle;
  workspace.boards.main.collaboration.memberships = [
    {
      actor: {
        type: 'human',
        id: ownerSub,
        email: ownerEmail,
        displayName: ownerName
      },
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    },
    {
      actor: {
        type: 'human',
        id: viewerSub,
        email: viewerEmail
      },
      role: viewerRole,
      joinedAt: '2026-04-02T10:05:00.000Z'
    }
  ];

  return createUpdatedWorkspaceRecord(initialRecord, {
    workspace,
    actor: { type: 'human', id: ownerSub },
    now: '2026-04-02T10:30:00.000Z'
  });
}

function createInviteOnlyWorkspaceRecordFixture(
  workspaceId,
  {
    viewerSub = 'sub_member',
    viewerEmail = 'member@example.com'
  } = {}
) {
  const ownerActor = {
    type: 'human',
    id: 'sub_owner_casa',
    email: 'owner-casa@example.com',
    displayName: 'Casa owner'
  };
  let workspace = createEmptyWorkspace({
    workspaceId,
    creator: ownerActor
  });

  workspace.boards.main.title = 'Owner board';
  workspace.boards.main.collaboration.memberships = [
    {
      actor: ownerActor,
      role: 'admin',
      joinedAt: workspace.boards.main.createdAt
    }
  ];

  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspaceId}_casa`,
    creator: ownerActor
  }).boards.main;
  const invitedBoard = structuredClone(sourceBoard);
  invitedBoard.id = 'casa';
  invitedBoard.title = 'Casa';
  invitedBoard.collaboration.memberships = [];
  invitedBoard.collaboration.invites = [
    {
      id: 'invite_casa_1',
      actor: { type: 'human', id: viewerSub },
      email: viewerEmail,
      role: 'editor',
      status: 'pending',
      invitedBy: ownerActor,
      invitedAt: '2026-04-02T10:20:00.000Z'
    }
  ];
  workspace.boards.casa = invitedBoard;
  workspace.boardOrder = ['main', 'casa'];
  workspace.ui.activeBoardId = 'main';

  const record = createUpdatedWorkspaceRecord(
    createInitialWorkspaceRecord(ownerActor.id, {
      workspaceId,
      now: '2026-04-02T10:00:00.000Z'
    }),
    {
      workspace,
      actor: { type: 'human', id: ownerActor.id },
      now: '2026-04-02T10:30:00.000Z'
    }
  );
  record.isHomeWorkspace = false;
  return record;
}

function addSharedBoard(workspace, boardId, title, { memberships = [], invites = [], card = null } = {}) {
  const sourceBoard = createEmptyWorkspace({
    workspaceId: `${workspace.workspaceId}_${boardId}`,
    creator: {
      type: 'human',
      id: 'sub_owner',
      email: 'owner@example.com'
    }
  }).boards.main;
  const board = structuredClone(sourceBoard);

  board.id = boardId;
  board.title = title;
  board.collaboration.memberships = memberships.map((membership) => structuredClone(membership));
  board.collaboration.invites = invites.map((invite) => structuredClone(invite));
  workspace.boards[boardId] = board;

  if (card) {
    return createCard(workspace, boardId, card);
  }

  return workspace;
}

function listPendingWorkspaceInvites(records, { viewerSub, viewerEmail = null } = {}) {
  const normalizedViewerEmail = normalizeOptionalEmail(viewerEmail);
  const inviteSummaries = [];
  const seenInviteKeys = new Set();

  for (const record of records) {
    const workspace = createWorkspaceRecord(record).workspace;

    for (const [boardId, board] of Object.entries(workspace.boards ?? {})) {
      const invites = Array.isArray(board?.collaboration?.invites) ? board.collaboration.invites : [];

      for (const invite of invites) {
        if (invite?.status !== 'pending') {
          continue;
        }

        const matchesViewer =
          (typeof invite?.actor?.id === 'string' && invite.actor.id.trim() === viewerSub)
          || (normalizeOptionalEmail(invite?.email) && normalizeOptionalEmail(invite.email) === normalizedViewerEmail);

        if (!matchesViewer) {
          continue;
        }

        const summary = {
          workspaceId: record.workspaceId,
          boardId,
          boardTitle: board.title,
          inviteId: invite.id,
          role: invite.role,
          invitedAt: invite.invitedAt,
          invitedBy: {
            id: invite.invitedBy?.id ?? null,
            email: invite.invitedBy?.email ?? null,
            displayName: invite.invitedBy?.displayName ?? invite.invitedBy?.name ?? null
          }
        };
        const inviteKey = `${summary.workspaceId}:${summary.boardId}:${summary.inviteId}`;

        if (seenInviteKeys.has(inviteKey)) {
          continue;
        }

        seenInviteKeys.add(inviteKey);
        inviteSummaries.push(summary);
      }
    }
  }

  return inviteSummaries;
}

function listAccessibleWorkspaces(records, { viewerSub, viewerEmail = null, excludeWorkspaceId = null } = {}) {
  const summaries = [];
  const seenWorkspaceIds = new Set();

  for (const record of records) {
    const projectedRecord = createWorkspaceRecord(record);
    const projectedWorkspace = projectRecordForViewer(projectedRecord, {
      viewerSub,
      viewerEmail
    }).workspace;
    const boards = [];

    for (const boardId of projectedWorkspace.boardOrder ?? []) {
      const board = projectedWorkspace.boards?.[boardId];
      const membership = board?.collaboration?.memberships?.find((entry) => entry?.actor?.id === viewerSub);

      if (!board?.title || !membership?.role) {
        continue;
      }

      boards.push({
        boardId,
        boardTitle: board.title,
        role: membership.role
      });
    }

    if (
      !projectedRecord.workspaceId
      || projectedRecord.workspaceId === excludeWorkspaceId
      || boards.length === 0
      || seenWorkspaceIds.has(projectedRecord.workspaceId)
    ) {
      continue;
    }

    seenWorkspaceIds.add(projectedRecord.workspaceId);
    summaries.push({
      workspaceId: projectedRecord.workspaceId,
      isHomeWorkspace: projectedRecord.workspaceId === createHomeWorkspaceId(viewerSub),
      boards
    });
  }

  return summaries.sort((left, right) => {
    if (left.isHomeWorkspace && !right.isHomeWorkspace) {
      return -1;
    }

    if (!left.isHomeWorkspace && right.isHomeWorkspace) {
      return 1;
    }

    return left.workspaceId.localeCompare(right.workspaceId);
  });
}

function normalizeOptionalWorkspaceId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOptionalEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}
