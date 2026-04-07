import { readLastSurfaceMemory } from './last_surface_cookie.js';
import { isSuperAdminViewer } from './super_admin.js';
import { WorkspaceAccessDeniedError } from '../workspaces/workspace_record_repository.js';

export async function resolveAuthenticatedLandingDestination({
  request,
  viewer,
  config,
  workspaceRecordRepository
} = {}) {
  const isSuperAdmin =
    viewer?.isSuperAdmin === true
    || isSuperAdminViewer(viewer, config?.superAdmins);

  if (!isSuperAdmin) {
    return '/boards';
  }

  const lastSurface = readLastSurfaceMemory(request);

  if (lastSurface?.surface === 'board') {
    const rememberedBoardDestination = await resolveRememberedBoardDestination({
      viewer,
      workspaceRecordRepository,
      workspaceId: lastSurface.workspaceId
    });

    if (rememberedBoardDestination) {
      return rememberedBoardDestination;
    }
  }

  return '/portfolio';
}

async function resolveRememberedBoardDestination({
  viewer,
  workspaceRecordRepository,
  workspaceId
} = {}) {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);

  if (!viewer?.sub || !workspaceRecordRepository || !normalizedWorkspaceId) {
    return null;
  }

  try {
    const record = await workspaceRecordRepository.loadOrCreateWorkspaceRecord({
      viewerSub: viewer.sub,
      viewerEmail: viewer.email ?? null,
      workspaceId: normalizedWorkspaceId
    });
    const resolvedWorkspaceId = normalizeOptionalString(record?.workspaceId ?? record?.workspace?.workspaceId);

    if (!resolvedWorkspaceId) {
      return null;
    }

    return record?.isHomeWorkspace === true
      ? '/boards'
      : `/boards?workspaceId=${encodeURIComponent(resolvedWorkspaceId)}`;
  } catch (error) {
    if (error instanceof WorkspaceAccessDeniedError || error?.code === 'WORKSPACE_ACCESS_DENIED') {
      return null;
    }

    throw error;
  }
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}
