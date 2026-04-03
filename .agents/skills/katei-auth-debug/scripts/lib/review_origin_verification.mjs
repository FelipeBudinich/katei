import { normalizeBoardAiLocalization } from '../../../../../apps/katei/public/js/domain/board_ai_localization.js';
import { canonicalizeContentLocale, normalizeBoardLanguagePolicy } from '../../../../../apps/katei/public/js/domain/board_language_policy.js';
import { canActorEditBoard } from '../../../../../apps/katei/public/js/domain/board_permissions.js';
import { summarizeBoardLocalizationState } from './localization_flow.mjs';

export function findReviewOriginVerificationTarget(
  workspacePayloads,
  {
    actor = null,
    workspaceId = '',
    boardId = '',
    boardTitle = '',
    targetLocale = ''
  } = {}
) {
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);
  const normalizedBoardId = normalizeOptionalString(boardId);
  const normalizedBoardTitle = normalizeOptionalString(boardTitle);
  const requestedTargetLocale = canonicalizeContentLocale(targetLocale);
  let sawRequestedWorkspace = normalizedWorkspaceId === '';
  let sawRequestedBoard = normalizedBoardId === '' && normalizedBoardTitle === '';
  let sawEditableBoard = false;
  let sawAiEnabledBoard = false;
  let sawSourceLocale = false;
  let sawTargetLocale = false;

  for (const payload of Array.isArray(workspacePayloads) ? workspacePayloads : []) {
    const workspace = payload?.workspace ?? payload?.body?.workspace ?? null;
    const payloadWorkspaceId = normalizeWorkspaceId(payload, workspace);

    if (normalizedWorkspaceId && payloadWorkspaceId !== normalizedWorkspaceId) {
      continue;
    }

    sawRequestedWorkspace = true;

    for (const candidateBoard of listBoardsInDisplayOrder(workspace)) {
      const board = candidateBoard?.board ?? null;
      const resolvedBoardId = normalizeOptionalString(candidateBoard?.boardId) || normalizeOptionalString(board?.id);

      if (normalizedBoardId && resolvedBoardId !== normalizedBoardId) {
        continue;
      }

      if (normalizedBoardTitle && normalizeOptionalString(board?.title) !== normalizedBoardTitle) {
        continue;
      }

      sawRequestedBoard = true;

      const isEditable = actor ? canActorEditBoard(board, actor) : true;

      if (!isEditable) {
        continue;
      }

      sawEditableBoard = true;

      const aiLocalization = normalizeBoardAiLocalization(board?.aiLocalization ?? null);

      if (aiLocalization?.hasApiKey !== true) {
        continue;
      }

      sawAiEnabledBoard = true;

      const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null);
      const sourceLocale = languagePolicy?.sourceLocale ?? null;

      if (!sourceLocale) {
        continue;
      }

      sawSourceLocale = true;

      const resolvedTargetLocale = requestedTargetLocale
        ? resolveRequestedTargetLocale(languagePolicy, requestedTargetLocale)
        : resolveDefaultTargetLocale(languagePolicy);

      if (!resolvedTargetLocale) {
        continue;
      }

      sawTargetLocale = true;

      return {
        candidate: {
          workspaceId: payloadWorkspaceId || null,
          workspaceRevision: readWorkspaceRevision(payload),
          boardId: resolvedBoardId || null,
          boardTitle: normalizeOptionalString(board?.title) || null,
          sourceLocale,
          targetLocale: resolvedTargetLocale,
          boardSummary: summarizeBoardLocalizationState(board)
        },
        reason: null
      };
    }
  }

  if (!sawRequestedWorkspace) {
    return {
      candidate: null,
      reason: 'workspace-not-found'
    };
  }

  if (!sawRequestedBoard) {
    return {
      candidate: null,
      reason: 'board-not-found'
    };
  }

  if (!sawEditableBoard) {
    return {
      candidate: null,
      reason: 'board-not-editable'
    };
  }

  if (!sawAiEnabledBoard) {
    return {
      candidate: null,
      reason: 'board-missing-ai'
    };
  }

  if (!sawSourceLocale) {
    return {
      candidate: null,
      reason: 'board-missing-source-locale'
    };
  }

  if (!sawTargetLocale) {
    return {
      candidate: null,
      reason: 'board-missing-target-locale'
    };
  }

  return {
    candidate: null,
    reason: 'no-verification-board'
  };
}

function listBoardsInDisplayOrder(workspace) {
  const boardOrder = Array.isArray(workspace?.boardOrder) ? workspace.boardOrder : [];
  const orderedBoards = [];
  const seenBoardIds = new Set();

  for (const boardId of boardOrder) {
    const board = workspace?.boards?.[boardId];

    if (!board || typeof board !== 'object') {
      continue;
    }

    seenBoardIds.add(boardId);
    orderedBoards.push({
      boardId,
      board
    });
  }

  for (const [boardId, board] of Object.entries(workspace?.boards ?? {})) {
    if (seenBoardIds.has(boardId) || !board || typeof board !== 'object') {
      continue;
    }

    orderedBoards.push({
      boardId,
      board
    });
  }

  return orderedBoards;
}

function resolveDefaultTargetLocale(languagePolicy) {
  return Array.isArray(languagePolicy?.supportedLocales)
    ? languagePolicy.supportedLocales.find((locale) => locale !== languagePolicy.sourceLocale) ?? null
    : null;
}

function resolveRequestedTargetLocale(languagePolicy, requestedTargetLocale) {
  if (!requestedTargetLocale || requestedTargetLocale === languagePolicy?.sourceLocale) {
    return null;
  }

  return Array.isArray(languagePolicy?.supportedLocales) && languagePolicy.supportedLocales.includes(requestedTargetLocale)
    ? requestedTargetLocale
    : null;
}

function normalizeWorkspaceId(payload, workspace) {
  return normalizeOptionalString(payload?.activeWorkspace?.workspaceId)
    || normalizeOptionalString(payload?.body?.activeWorkspace?.workspaceId)
    || normalizeOptionalString(payload?.workspaceId)
    || normalizeOptionalString(workspace?.workspaceId);
}

function readWorkspaceRevision(payload) {
  return Number.isInteger(payload?.meta?.revision)
    ? payload.meta.revision
    : (Number.isInteger(payload?.body?.meta?.revision) ? payload.body.meta.revision : null);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
