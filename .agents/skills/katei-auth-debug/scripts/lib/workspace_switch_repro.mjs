export const DEFAULT_WORKSPACE_SWITCH_REPRO_SCENARIOS = Object.freeze([
  Object.freeze({
    id: 'external-notes',
    description: 'Switch to external board "notes"',
    action: 'switch',
    target: Object.freeze({
      boardId: 'notes'
    })
  }),
  Object.freeze({
    id: 'external-shared-main',
    description: 'Switch to external board "Shared Main"',
    action: 'switch',
    target: Object.freeze({
      boardTitle: 'Shared Main',
      workspaceRelation: 'external'
    })
  }),
  Object.freeze({
    id: 'external-home-casa',
    description: 'Switch to external home board "Casa"',
    action: 'switch',
    target: Object.freeze({
      boardTitle: 'Casa',
      workspaceRelation: 'external'
    })
  })
]);

export function selectScenarioButton(buttons, scenario, { currentWorkspaceId = null } = {}) {
  const candidates = Array.isArray(buttons) ? buttons : [];
  const target = scenario?.target ?? {};

  return candidates.find((button) => {
    if (target.boardId && button?.boardId !== target.boardId) {
      return false;
    }

    if (target.boardTitle && button?.boardTitle !== target.boardTitle && button?.title !== target.boardTitle) {
      return false;
    }

    if (target.workspaceRelation === 'external') {
      return Boolean(button.workspaceId) && button.workspaceId !== currentWorkspaceId;
    }

    if (target.workspaceId) {
      return button.workspaceId === target.workspaceId;
    }

    return true;
  }) ?? null;
}

export function summarizeWorkspaceApiPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return {
    activeWorkspace: payload.activeWorkspace && typeof payload.activeWorkspace === 'object'
      ? {
          workspaceId: normalizeOptionalString(payload.activeWorkspace.workspaceId),
          isHomeWorkspace: payload.activeWorkspace.isHomeWorkspace === true
        }
      : null,
    workspace: payload.workspace && typeof payload.workspace === 'object'
      ? {
          workspaceId: normalizeOptionalString(payload.workspace.workspaceId),
          activeBoardId: normalizeOptionalString(payload.workspace.ui?.activeBoardId),
          boardOrder: Array.isArray(payload.workspace.boardOrder) ? [...payload.workspace.boardOrder] : [],
          boardIds: Object.keys(payload.workspace.boards ?? {})
        }
      : null
  };
}

export function classifyWorkspaceSwitchOutcome({
  beforeState,
  afterState,
  clickedButtonDataset,
  emittedEventDetail,
  networkEntries = [],
  historyEntries = [],
  expectedWorkspaceId = null,
  expectedBoardId = null
} = {}) {
  const beforeWorkspaceId = normalizeOptionalString(beforeState?.activeWorkspaceId);
  const afterWorkspaceId = normalizeOptionalString(afterState?.activeWorkspaceId);
  const afterActiveBoardId = normalizeOptionalString(afterState?.activeBoardId);
  const clickedWorkspaceId = normalizeOptionalString(clickedButtonDataset?.workspaceId);
  const clickedIsHomeWorkspace = clickedButtonDataset?.isHomeWorkspace === true;
  const clickedBoardId = normalizeOptionalString(clickedButtonDataset?.boardId) || expectedBoardId;
  const clickedBoardTitle = normalizeOptionalString(clickedButtonDataset?.boardTitle);
  const normalizedExpectedWorkspaceId = normalizeOptionalString(expectedWorkspaceId) || clickedWorkspaceId;
  const normalizedExpectedBoardId = normalizeOptionalString(expectedBoardId) || clickedBoardId;
  const successfulWorkspaceResponse = findSuccessfulWorkspaceResponse(networkEntries, normalizedExpectedWorkspaceId);
  const expectedWorkspaceInHistory = normalizedExpectedWorkspaceId
    ? historyEntries.some((entry) => normalizeOptionalString(entry?.workspaceId) === normalizedExpectedWorkspaceId)
    : false;

  if (
    normalizedExpectedWorkspaceId
    && (!clickedWorkspaceId || clickedWorkspaceId === beforeWorkspaceId || clickedWorkspaceId !== normalizedExpectedWorkspaceId)
  ) {
    return {
      category: 'wrong-or-missing-workspace-id',
      summary: 'The clicked switch row did not carry the expected external workspace id.',
      evidence: {
        clickedWorkspaceId,
        beforeWorkspaceId,
        normalizedExpectedWorkspaceId,
        emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId)
      }
    };
  }

  if (
    clickedIsHomeWorkspace
    && clickedWorkspaceId
    && beforeWorkspaceId
    && clickedWorkspaceId !== beforeWorkspaceId
    && afterWorkspaceId === beforeWorkspaceId
  ) {
    return {
      category: 'home-workspace-routing-or-history-issue',
      summary: 'The clicked row was marked as a home workspace even though it belongs to a different workspace, so the client routed back to the current home workspace.',
      evidence: {
        clickedWorkspaceId,
        beforeWorkspaceId,
        emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId),
        clickedIsHomeWorkspace,
        historyEntries
      }
    };
  }

  if (hasAccessFailure(networkEntries)) {
    return {
      category: 'access-denied-or-workspace-not-found',
      summary: 'The switch request reached the server but the target workspace was rejected or missing.',
      evidence: {
        statuses: networkEntries.map((entry) => entry.status).filter((status) => Number.isInteger(status)),
        clickedWorkspaceId,
        emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId)
      }
    };
  }

  if (
    successfulWorkspaceResponse
    && normalizedExpectedBoardId
    && !successfulWorkspaceResponse.responseSummary?.workspace?.boardIds?.includes(normalizedExpectedBoardId)
  ) {
    return {
      category: 'workspace-switched-but-board-filtered-out',
      summary: 'The target workspace loaded, but the requested board was absent from the actor-facing workspace projection.',
      evidence: {
        workspaceId: successfulWorkspaceResponse.responseSummary?.activeWorkspace?.workspaceId ?? null,
        boardIds: successfulWorkspaceResponse.responseSummary?.workspace?.boardIds ?? [],
        expectedBoardId: normalizedExpectedBoardId
      }
    };
  }

  if (
    normalizedExpectedWorkspaceId
    && afterWorkspaceId === normalizedExpectedWorkspaceId
    && (
      (normalizedExpectedBoardId && afterActiveBoardId !== normalizedExpectedBoardId)
      || (clickedBoardTitle && normalizeOptionalString(afterState?.boardTitle) !== clickedBoardTitle)
      || !expectedWorkspaceInHistory
      || !urlMatchesExpectedWorkspace(afterState?.url, normalizedExpectedWorkspaceId, afterState?.isHomeWorkspace)
    )
  ) {
    return {
      category: 'home-workspace-routing-or-history-issue',
      summary: 'The workspace switch completed, but the rendered state or URL/history did not line up with the target board.',
      evidence: {
        afterWorkspaceId,
        afterActiveBoardId,
        expectedBoardId: normalizedExpectedBoardId,
        afterBoardTitle: normalizeOptionalString(afterState?.boardTitle),
        clickedBoardTitle,
        historyEntries
      }
    };
  }

  if (
    normalizedExpectedWorkspaceId
    && afterWorkspaceId === normalizedExpectedWorkspaceId
    && (!normalizedExpectedBoardId || afterActiveBoardId === normalizedExpectedBoardId)
    && (!clickedBoardTitle || normalizeOptionalString(afterState?.boardTitle) === clickedBoardTitle)
  ) {
    return {
      category: 'success',
      summary: 'The workspace and board switch completed as expected.',
      evidence: {
        afterWorkspaceId,
        afterActiveBoardId
      }
    };
  }

  return {
    category: 'inconclusive',
    summary: 'The captured evidence was not sufficient to classify the switch outcome.',
    evidence: {
      beforeWorkspaceId,
      afterWorkspaceId,
      afterActiveBoardId,
      clickedWorkspaceId,
      emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId),
      networkCount: Array.isArray(networkEntries) ? networkEntries.length : 0
    }
  };
}

export function classifyWorkspaceInviteAcceptanceOutcome({
  beforeState,
  afterState,
  clickedButtonDataset,
  emittedEventDetail,
  networkEntries = [],
  historyEntries = [],
  expectedWorkspaceId = null,
  expectedBoardId = null
} = {}) {
  const beforeWorkspaceId = normalizeOptionalString(beforeState?.activeWorkspaceId);
  const afterWorkspaceId = normalizeOptionalString(afterState?.activeWorkspaceId);
  const afterActiveBoardId = normalizeOptionalString(afterState?.activeBoardId);
  const clickedWorkspaceId = normalizeOptionalString(clickedButtonDataset?.workspaceId);
  const clickedBoardId = normalizeOptionalString(clickedButtonDataset?.boardId) || expectedBoardId;
  const clickedBoardTitle = normalizeOptionalString(clickedButtonDataset?.boardTitle);
  const normalizedExpectedWorkspaceId = normalizeOptionalString(expectedWorkspaceId) || clickedWorkspaceId;
  const normalizedExpectedBoardId = normalizeOptionalString(expectedBoardId) || clickedBoardId;
  const successfulWorkspaceResponse = findSuccessfulWorkspaceResponse(networkEntries, normalizedExpectedWorkspaceId);
  const expectedWorkspaceInHistory = normalizedExpectedWorkspaceId
    ? historyEntries.some((entry) => normalizeOptionalString(entry?.workspaceId) === normalizedExpectedWorkspaceId)
    : false;

  if (
    normalizedExpectedWorkspaceId
    && (!clickedWorkspaceId || clickedWorkspaceId !== normalizedExpectedWorkspaceId)
  ) {
    return {
      category: 'wrong-or-missing-workspace-id',
      summary: 'The clicked invite row did not carry the expected workspace id.',
      evidence: {
        clickedWorkspaceId,
        beforeWorkspaceId,
        normalizedExpectedWorkspaceId,
        emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId)
      }
    };
  }

  if (hasAccessFailure(networkEntries)) {
    return {
      category: 'access-denied-or-workspace-not-found',
      summary: 'The invite decision reached the server but the target workspace was rejected or missing.',
      evidence: {
        statuses: networkEntries.map((entry) => entry.status).filter((status) => Number.isInteger(status)),
        clickedWorkspaceId,
        emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId)
      }
    };
  }

  if (
    successfulWorkspaceResponse
    && normalizedExpectedBoardId
    && !successfulWorkspaceResponse.responseSummary?.workspace?.boardIds?.includes(normalizedExpectedBoardId)
  ) {
    return {
      category: 'workspace-switched-but-board-filtered-out',
      summary: 'The invite acceptance succeeded, but the invited board was absent from the actor-facing workspace projection.',
      evidence: {
        workspaceId: successfulWorkspaceResponse.responseSummary?.activeWorkspace?.workspaceId ?? null,
        boardIds: successfulWorkspaceResponse.responseSummary?.workspace?.boardIds ?? [],
        expectedBoardId: normalizedExpectedBoardId
      }
    };
  }

  if (
    normalizedExpectedWorkspaceId
    && afterWorkspaceId === normalizedExpectedWorkspaceId
    && (!normalizedExpectedBoardId || afterActiveBoardId === normalizedExpectedBoardId)
    && (!clickedBoardTitle || normalizeOptionalString(afterState?.boardTitle) === clickedBoardTitle)
    && (!normalizedExpectedWorkspaceId || expectedWorkspaceInHistory || beforeWorkspaceId === afterWorkspaceId)
    && urlMatchesExpectedWorkspace(afterState?.url, normalizedExpectedWorkspaceId, afterState?.isHomeWorkspace)
  ) {
    return {
      category: 'success',
      summary: 'The invite acceptance landed on the invited workspace and board as expected.',
      evidence: {
        afterWorkspaceId,
        afterActiveBoardId
      }
    };
  }

  if (
    normalizedExpectedWorkspaceId
    && (
      afterWorkspaceId !== normalizedExpectedWorkspaceId
      || (normalizedExpectedBoardId && afterActiveBoardId !== normalizedExpectedBoardId)
      || (clickedBoardTitle && normalizeOptionalString(afterState?.boardTitle) !== clickedBoardTitle)
      || !urlMatchesExpectedWorkspace(afterState?.url, normalizedExpectedWorkspaceId, afterState?.isHomeWorkspace)
    )
  ) {
    return {
      category: 'home-workspace-routing-or-history-issue',
      summary: 'The invite acceptance completed, but the rendered workspace, board, or URL did not land on the invited target.',
      evidence: {
        beforeWorkspaceId,
        afterWorkspaceId,
        afterActiveBoardId,
        expectedBoardId: normalizedExpectedBoardId,
        afterBoardTitle: normalizeOptionalString(afterState?.boardTitle),
        clickedBoardTitle,
        historyEntries
      }
    };
  }

  return {
    category: 'inconclusive',
    summary: 'The captured evidence was not sufficient to classify the invite acceptance outcome.',
    evidence: {
      beforeWorkspaceId,
      afterWorkspaceId,
      afterActiveBoardId,
      clickedWorkspaceId,
      emittedEventWorkspaceId: normalizeOptionalString(emittedEventDetail?.workspaceId),
      networkCount: Array.isArray(networkEntries) ? networkEntries.length : 0
    }
  };
}

function findSuccessfulWorkspaceResponse(networkEntries, expectedWorkspaceId) {
  const entries = Array.isArray(networkEntries) ? networkEntries : [];

  return entries.find((entry) => {
    const activeWorkspaceId = normalizeOptionalString(entry?.responseSummary?.activeWorkspace?.workspaceId);

    if (!expectedWorkspaceId) {
      return Number.isInteger(entry?.status) && entry.status >= 200 && entry.status < 300 && Boolean(activeWorkspaceId);
    }

    return Number.isInteger(entry?.status)
      && entry.status >= 200
      && entry.status < 300
      && activeWorkspaceId === expectedWorkspaceId;
  }) ?? null;
}

function hasAccessFailure(networkEntries) {
  const entries = Array.isArray(networkEntries) ? networkEntries : [];
  return entries.some((entry) => entry?.status === 403 || entry?.status === 404);
}

function urlMatchesExpectedWorkspace(url, expectedWorkspaceId, isHomeWorkspace = false) {
  const normalizedExpectedWorkspaceId = normalizeOptionalString(expectedWorkspaceId);

  if (!normalizedExpectedWorkspaceId) {
    return true;
  }

  try {
    const parsedUrl = new URL(url, 'http://localhost');
    const workspaceId = normalizeOptionalString(parsedUrl.searchParams.get('workspaceId'));

    if (isHomeWorkspace) {
      return !workspaceId;
    }

    return workspaceId === normalizedExpectedWorkspaceId;
  } catch (error) {
    return false;
  }
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
