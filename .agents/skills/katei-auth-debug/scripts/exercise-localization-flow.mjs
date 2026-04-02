#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createArtifactStamp,
  sanitizeArtifactLabel
} from './lib/artifacts.mjs';
import { obtainKateiSession } from './lib/auth.mjs';
import { loadKateiAuthDebugConfig } from './lib/config.mjs';
import {
  findBoardInWorkspace,
  selectLocalizationCandidate,
  summarizeBoardLocalizationState
} from './lib/localization_flow.mjs';

await main();

async function locateTargetWorkspace(initialPayload, {
  baseUrl,
  cookieHeader,
  workspaceId = '',
  boardTitle = ''
} = {}) {
  const initialBody = initialPayload?.body ?? null;
  const normalizedWorkspaceId = normalizeOptionalString(workspaceId);
  const normalizedBoardTitle = normalizeOptionalString(boardTitle);
  const searchedWorkspaceIds = [];

  if (normalizedWorkspaceId) {
    const payload = await fetchWorkspacePayload(baseUrl, cookieHeader, normalizedWorkspaceId);
    searchedWorkspaceIds.push(normalizedWorkspaceId);

    return {
      workspaceId: normalizedWorkspaceId,
      payload,
      board: normalizedBoardTitle ? findBoardInWorkspace(payload?.body?.workspace, normalizedBoardTitle)?.board ?? null : null,
      searchedWorkspaceIds
    };
  }

  const initialWorkspaceId = normalizeOptionalString(initialBody?.activeWorkspace?.workspaceId)
    || normalizeOptionalString(initialBody?.workspace?.workspaceId);
  const initialBoardMatch = normalizedBoardTitle
    ? findBoardInWorkspace(initialBody?.workspace, normalizedBoardTitle)
    : null;

  if (initialWorkspaceId) {
    searchedWorkspaceIds.push(initialWorkspaceId);
  }

  if (!normalizedBoardTitle || initialBoardMatch) {
    return {
      workspaceId: initialWorkspaceId || null,
      payload: initialPayload,
      board: initialBoardMatch?.board ?? null,
      searchedWorkspaceIds
    };
  }

  const accessibleWorkspaces = Array.isArray(initialBody?.accessibleWorkspaces)
    ? initialBody.accessibleWorkspaces
    : [];

  for (const workspaceSummary of accessibleWorkspaces) {
    const nextWorkspaceId = normalizeOptionalString(workspaceSummary?.workspaceId);

    if (!nextWorkspaceId || searchedWorkspaceIds.includes(nextWorkspaceId)) {
      continue;
    }

    const payload = await fetchWorkspacePayload(baseUrl, cookieHeader, nextWorkspaceId);
    searchedWorkspaceIds.push(nextWorkspaceId);
    const boardMatch = findBoardInWorkspace(payload?.body?.workspace, normalizedBoardTitle);

    if (boardMatch) {
      return {
        workspaceId: nextWorkspaceId,
        payload,
        board: boardMatch.board,
        searchedWorkspaceIds
      };
    }
  }

  return {
    workspaceId: initialWorkspaceId || null,
    payload: initialPayload,
    board: null,
    searchedWorkspaceIds
  };
}

async function fetchWorkspacePayload(baseUrl, cookieHeader, workspaceId) {
  const url = new URL('/api/workspace', baseUrl);

  if (workspaceId) {
    url.searchParams.set('workspaceId', workspaceId);
  }

  return requestJson(url, { cookieHeader });
}

async function main() {
  const args = parseCliArgs();
  const config = await loadKateiAuthDebugConfig({ configPath: args.configPath });
  const session = await obtainKateiSession({ config });
  const artifactStamp = createArtifactStamp();
  const artifactSlug = sanitizeArtifactLabel(`${new URL(config.baseUrl).hostname}-localization-flow`);
  const artifactRoot = config.page.artifactDir;
  const cookieHeader = `${session.cookieName}=${session.cookieValue}`;

  await fs.mkdir(artifactRoot, { recursive: true });

  const initialPayload = await requestJson(new URL('/api/workspace', config.baseUrl), {
    cookieHeader
  });
  const workspaceSearch = await locateTargetWorkspace(initialPayload, {
    baseUrl: config.baseUrl,
    cookieHeader,
    workspaceId: args.workspaceId,
    boardTitle: args.boardTitle
  });
  const boardSummary = workspaceSearch.board ? summarizeBoardLocalizationState(workspaceSearch.board) : null;
  const candidateSelection = workspaceSearch.board
    ? selectLocalizationCandidate(workspaceSearch.board, {
        cardId: args.cardId,
        cardTitle: args.cardTitle,
        targetLocale: args.targetLocale
      })
    : { candidate: null, reason: 'board-not-found' };
  const candidate = candidateSelection.candidate;
  const report = {
    ok: false,
    configPath: config.configPath,
    capturedAt: new Date().toISOString(),
    baseUrl: config.baseUrl,
    session: {
      mode: session.mode,
      redirectTo: session.redirectTo,
      viewer: session.viewer
    },
    expectedViewer: {
      email: args.viewerEmail || null,
      name: args.viewerName || null,
      emailMatches: matchesExpectedValue(session.viewer?.email, args.viewerEmail),
      nameMatches: matchesExpectedValue(session.viewer?.name, args.viewerName)
    },
    initialWorkspace: summarizeWorkspacePayload(initialPayload),
    search: {
      requestedWorkspaceId: args.workspaceId || null,
      requestedBoardTitle: args.boardTitle || null,
      searchedWorkspaceIds: workspaceSearch.searchedWorkspaceIds,
      boardFound: Boolean(workspaceSearch.board),
      boardWorkspaceId: workspaceSearch.workspaceId ?? null,
      boardSummary
    },
    candidateSelection: {
      reason: candidateSelection.reason,
      candidate
    }
  };

  if (!workspaceSearch.board || !candidate) {
    await writeReport(report, { artifactRoot, artifactSlug, artifactStamp });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  const mutationRequest = {
    clientMutationId: `localization-smoke-${randomUUID()}`,
    workspaceId: workspaceSearch.workspaceId,
    boardId: workspaceSearch.board.id,
    cardId: candidate.cardId,
    targetLocale: candidate.targetLocale,
    expectedRevision: workspaceSearch.payload?.body?.meta?.revision ?? 0
  };
  const mutationResponse = await requestJson(new URL('/api/workspace/localizations/generate', config.baseUrl), {
    method: 'POST',
    cookieHeader,
    body: mutationRequest
  });
  const responseBoard = mutationResponse.body?.workspace?.boards?.[workspaceSearch.board.id] ?? null;
  const responseCard = responseBoard?.cards?.[candidate.cardId] ?? null;
  const generatedVariant = responseCard?.contentByLocale?.[candidate.targetLocale] ?? null;

  report.ok = mutationResponse.ok && hasMeaningfulGeneratedContent(generatedVariant);
  report.mutation = {
    request: mutationRequest,
    response: {
      ok: mutationResponse.ok,
      status: mutationResponse.status,
      body: mutationResponse.body
    },
    generatedVariant
  };

  await writeReport(report, { artifactRoot, artifactSlug, artifactStamp });
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

async function requestJson(url, {
  method = 'GET',
  cookieHeader,
  body = null
} = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Cookie: cookieHeader,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const responseBody = await response.json().catch(() => null);

  return {
    ok: response.ok,
    status: response.status,
    body: responseBody
  };
}

async function writeReport(report, { artifactRoot, artifactSlug, artifactStamp } = {}) {
  const timestampedReportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
  const latestReportPath = path.join(artifactRoot, 'latest-localization-flow.json');
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

  await fs.writeFile(timestampedReportPath, serializedReport);
  await fs.writeFile(latestReportPath, serializedReport);
}

function summarizeWorkspacePayload(payload) {
  const workspace = payload?.body?.workspace ?? payload?.workspace ?? null;
  const accessibleWorkspaces = payload?.body?.accessibleWorkspaces ?? payload?.accessibleWorkspaces ?? [];

  return {
    ok: payload?.ok ?? false,
    status: payload?.status ?? 200,
    workspaceId: normalizeOptionalString(payload?.body?.activeWorkspace?.workspaceId)
      || normalizeOptionalString(payload?.activeWorkspace?.workspaceId)
      || normalizeOptionalString(workspace?.workspaceId)
      || null,
    activeBoardId: normalizeOptionalString(workspace?.ui?.activeBoardId) || null,
    boardOrder: Array.isArray(workspace?.boardOrder) ? [...workspace.boardOrder] : [],
    accessibleWorkspaceIds: Array.isArray(accessibleWorkspaces)
      ? accessibleWorkspaces
          .map((summary) => normalizeOptionalString(summary?.workspaceId))
          .filter(Boolean)
      : [],
    meta: payload?.body?.meta ?? payload?.meta ?? null
  };
}

function hasMeaningfulGeneratedContent(variant) {
  return Boolean(
    normalizeOptionalString(variant?.title)
    || normalizeOptionalString(variant?.detailsMarkdown)
  );
}

function matchesExpectedValue(actualValue, expectedValue) {
  const normalizedExpectedValue = normalizeOptionalString(expectedValue);

  if (!normalizedExpectedValue) {
    return null;
  }

  return normalizeOptionalString(actualValue) === normalizedExpectedValue;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const parsed = {
    configPath: undefined,
    workspaceId: '',
    boardTitle: '',
    cardId: '',
    cardTitle: '',
    targetLocale: '',
    viewerEmail: '',
    viewerName: ''
  };

  while (args.length > 0) {
    const arg = args.shift();
    const nextValue = () => {
      const value = args.shift();

      if (!value) {
        throw new Error(`Missing value for ${arg}.`);
      }

      return value;
    };

    switch (arg) {
      case '--config':
        parsed.configPath = nextValue();
        break;
      case '--workspace-id':
        parsed.workspaceId = nextValue();
        break;
      case '--board-title':
        parsed.boardTitle = nextValue();
        break;
      case '--card-id':
        parsed.cardId = nextValue();
        break;
      case '--card-title':
        parsed.cardTitle = nextValue();
        break;
      case '--target-locale':
        parsed.targetLocale = nextValue();
        break;
      case '--viewer-email':
        parsed.viewerEmail = nextValue();
        break;
      case '--viewer-name':
        parsed.viewerName = nextValue();
        break;
      default:
        throw new Error(`Unsupported argument: ${arg}`);
    }
  }

  return parsed;
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
