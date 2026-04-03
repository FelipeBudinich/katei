#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createArtifactStamp,
  sanitizeArtifactLabel
} from './lib/artifacts.mjs';
import { obtainKateiSession } from './lib/auth.mjs';
import { loadKateiAuthDebugConfig } from './lib/config.mjs';
import { findReviewOriginVerificationTarget } from './lib/review_origin_verification.mjs';

await main();

async function main() {
  const args = parseCliArgs();
  const config = await loadKateiAuthDebugConfig({ configPath: args.configPath });
  const session = await obtainKateiSession({ config });
  const artifactStamp = createArtifactStamp();
  const artifactSlug = sanitizeArtifactLabel(`${new URL(config.baseUrl).hostname}-review-origin-verification`);
  const artifactRoot = config.page.artifactDir;
  const cookieHeader = `${session.cookieName}=${session.cookieValue}`;
  const actor = createViewerActor(session.viewer);

  await fs.mkdir(artifactRoot, { recursive: true });

  const initialPayload = await requestJson(new URL('/api/workspace', config.baseUrl), {
    cookieHeader
  });
  const workspacePayloads = await loadWorkspacePayloads(initialPayload, {
    baseUrl: config.baseUrl,
    cookieHeader
  });
  const searchedWorkspaceIds = workspacePayloads
    .map((payload) => readPayloadWorkspaceId(payload))
    .filter(Boolean);
  const targetSelection = findReviewOriginVerificationTarget(workspacePayloads, {
    actor,
    workspaceId: args.workspaceId,
    boardId: args.boardId,
    boardTitle: args.boardTitle,
    targetLocale: args.targetLocale
  });
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
    search: {
      requestedWorkspaceId: args.workspaceId || null,
      requestedBoardId: args.boardId || null,
      requestedBoardTitle: args.boardTitle || null,
      requestedTargetLocale: args.targetLocale || null,
      searchedWorkspaceIds,
      reason: targetSelection.reason,
      target: targetSelection.candidate
    },
    steps: {},
    cleanup: {
      attempted: false,
      skipped: args.keepCard,
      deletedCard: false,
      deleteRevision: null,
      error: null
    },
    error: null
  };

  if (!targetSelection.candidate) {
    await writeReport(report, { artifactRoot, artifactSlug, artifactStamp });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
    return;
  }

  const candidate = targetSelection.candidate;
  const verificationDraft = createVerificationDraft(candidate.targetLocale, artifactStamp);
  let cardId = '';
  let currentRevision = candidate.workspaceRevision;
  let failure = null;
  let currentStep = 'initialize';

  try {
    if (!Number.isInteger(currentRevision)) {
      currentStep = 'refresh-revision';
      const refreshedWorkspace = await fetchWorkspacePayload(config.baseUrl, cookieHeader, candidate.workspaceId);
      currentRevision = refreshedWorkspace.meta?.revision ?? null;
    }

    assert.ok(Number.isInteger(currentRevision), 'Workspace revision is required before verification starts.');

    currentStep = 'card.create';
    const createResponse = await postWorkspaceCommand(config.baseUrl, cookieHeader, candidate.workspaceId, currentRevision, {
      clientMutationId: makeClientMutationId('review_origin_card_create'),
      type: 'card.create',
      payload: {
        boardId: candidate.boardId,
        title: verificationDraft.sourceTitle,
        detailsMarkdown: verificationDraft.sourceDetails
      }
    });

    currentRevision = createResponse.meta.revision;
    cardId = createResponse.result?.cardId ?? '';
    assert.ok(cardId, 'card.create did not return a cardId.');

    const sourceVariant = readVariant(createResponse.workspace, candidate.boardId, cardId, candidate.sourceLocale);
    assert.equal(sourceVariant?.review?.origin, 'human', 'Temporary source-locale card content should be human-origin.');
    report.steps.createCard = {
      ok: true,
      revision: currentRevision,
      cardId,
      variant: serializeVariant(sourceVariant)
    };

    currentStep = 'card.locale.generate';
    const generateResponse = await postLocalizationGeneration(
      config.baseUrl,
      cookieHeader,
      candidate.workspaceId,
      currentRevision,
      {
        clientMutationId: makeClientMutationId('review_origin_generate'),
        boardId: candidate.boardId,
        cardId,
        targetLocale: candidate.targetLocale
      }
    );

    currentRevision = generateResponse.meta.revision;
    const generatedVariant = readVariant(generateResponse.workspace, candidate.boardId, cardId, candidate.targetLocale);
    assert.equal(generatedVariant?.review?.origin, 'ai', 'Generated locale should store review.origin = ai.');
    assert.equal(
      generatedVariant?.provenance?.includesHumanInput,
      false,
      'Generated locale should record automated latest-write provenance.'
    );
    report.steps.generate = {
      ok: true,
      revision: currentRevision,
      variant: serializeVariant(generatedVariant)
    };

    currentStep = 'card.locale.upsert-after-generate';
    const manualEditResponse = await postWorkspaceCommand(config.baseUrl, cookieHeader, candidate.workspaceId, currentRevision, {
      clientMutationId: makeClientMutationId('review_origin_manual_edit'),
      type: 'card.locale.upsert',
      payload: {
        boardId: candidate.boardId,
        cardId,
        locale: candidate.targetLocale,
        title: verificationDraft.editedTitle,
        detailsMarkdown: verificationDraft.editedDetails
      }
    });

    currentRevision = manualEditResponse.meta.revision;
    const editedVariant = readVariant(manualEditResponse.workspace, candidate.boardId, cardId, candidate.targetLocale);
    assert.equal(editedVariant?.review?.origin, 'ai', 'Human edits should not overwrite stored AI origin.');
    assert.equal(
      editedVariant?.provenance?.includesHumanInput,
      true,
      'Human edits should update latest-write provenance to human.'
    );
    assert.equal(
      editedVariant?.provenance?.actor?.type,
      'human',
      'Human edits should record a human actor in provenance.'
    );
    report.steps.manualEditAfterGenerate = {
      ok: true,
      revision: currentRevision,
      variant: serializeVariant(editedVariant)
    };

    currentStep = 'card.locale.discard';
    const discardResponse = await postWorkspaceCommand(config.baseUrl, cookieHeader, candidate.workspaceId, currentRevision, {
      clientMutationId: makeClientMutationId('review_origin_discard'),
      type: 'card.locale.discard',
      payload: {
        boardId: candidate.boardId,
        cardId,
        locale: candidate.targetLocale
      }
    });

    currentRevision = discardResponse.meta.revision;
    const discardedVariant = readVariant(discardResponse.workspace, candidate.boardId, cardId, candidate.targetLocale);
    assert.equal(discardedVariant, null, 'Discard should remove the localized variant before manual recreation.');
    report.steps.discard = {
      ok: true,
      revision: currentRevision
    };

    currentStep = 'card.locale.upsert-after-discard';
    const manualCreateResponse = await postWorkspaceCommand(
      config.baseUrl,
      cookieHeader,
      candidate.workspaceId,
      currentRevision,
      {
        clientMutationId: makeClientMutationId('review_origin_manual_create'),
        type: 'card.locale.upsert',
        payload: {
          boardId: candidate.boardId,
          cardId,
          locale: candidate.targetLocale,
          title: verificationDraft.manualCreateTitle,
          detailsMarkdown: verificationDraft.manualCreateDetails
        }
      }
    );

    currentRevision = manualCreateResponse.meta.revision;
    const manualCreateVariant = readVariant(
      manualCreateResponse.workspace,
      candidate.boardId,
      cardId,
      candidate.targetLocale
    );
    assert.equal(
      manualCreateVariant?.review?.origin,
      'human',
      'Brand-new manual locale creation should store review.origin = human.'
    );
    assert.equal(
      manualCreateVariant?.provenance?.includesHumanInput,
      true,
      'Brand-new manual locale creation should record human provenance.'
    );
    report.steps.manualCreateAfterDiscard = {
      ok: true,
      revision: currentRevision,
      variant: serializeVariant(manualCreateVariant)
    };

    report.ok = true;
  } catch (error) {
    failure = error;
    report.error = serializeError(error, currentStep);
  } finally {
    if (cardId) {
      report.cleanup.attempted = true;

      if (args.keepCard) {
        report.cleanup.deletedCard = false;
      } else {
        try {
          currentStep = 'cleanup';
          const refreshedWorkspace = await fetchWorkspacePayload(config.baseUrl, cookieHeader, candidate.workspaceId);
          const latestRevision = refreshedWorkspace.meta?.revision ?? null;
          const currentCard = refreshedWorkspace.workspace?.boards?.[candidate.boardId]?.cards?.[cardId] ?? null;

          if (currentCard) {
            const deleteResponse = await postWorkspaceCommand(
              config.baseUrl,
              cookieHeader,
              candidate.workspaceId,
              latestRevision,
              {
                clientMutationId: makeClientMutationId('review_origin_card_delete'),
                type: 'card.delete',
                payload: {
                  boardId: candidate.boardId,
                  cardId
                }
              }
            );

            report.cleanup.deletedCard = deleteResponse.workspace?.boards?.[candidate.boardId]?.cards?.[cardId] == null;
            report.cleanup.deleteRevision = deleteResponse.meta?.revision ?? null;
          } else {
            report.cleanup.deletedCard = true;
          }
        } catch (cleanupError) {
          report.cleanup.error = serializeError(cleanupError, 'cleanup');
        }
      }
    }
  }

  await writeReport(report, { artifactRoot, artifactSlug, artifactStamp });
  console.log(JSON.stringify(report, null, 2));

  if (failure || report.cleanup.error || (!args.keepCard && cardId && report.cleanup.deletedCard !== true)) {
    process.exitCode = 1;
  }
}

async function loadWorkspacePayloads(initialPayload, { baseUrl, cookieHeader } = {}) {
  const payloads = [initialPayload];
  const seenWorkspaceIds = new Set();
  const initialWorkspaceId = readPayloadWorkspaceId(initialPayload);

  if (initialWorkspaceId) {
    seenWorkspaceIds.add(initialWorkspaceId);
  }

  for (const summary of initialPayload?.accessibleWorkspaces ?? []) {
    const workspaceId = normalizeOptionalString(summary?.workspaceId);

    if (!workspaceId || seenWorkspaceIds.has(workspaceId)) {
      continue;
    }

    seenWorkspaceIds.add(workspaceId);
    payloads.push(await fetchWorkspacePayload(baseUrl, cookieHeader, workspaceId));
  }

  return payloads;
}

async function fetchWorkspacePayload(baseUrl, cookieHeader, workspaceId = '') {
  const response = await requestJson(new URL('/api/workspace', baseUrl), {
    cookieHeader,
    workspaceId
  });

  if (!response.ok) {
    throw createHttpError('GET /api/workspace failed.', response);
  }

  return response.body;
}

async function postWorkspaceCommand(baseUrl, cookieHeader, workspaceId, expectedRevision, command) {
  const response = await requestJson(new URL('/api/workspace/commands', baseUrl), {
    method: 'POST',
    cookieHeader,
    body: {
      workspaceId,
      expectedRevision,
      command
    }
  });

  if (!response.ok) {
    throw createHttpError(`POST /api/workspace/commands failed for ${command?.type ?? 'unknown-command'}.`, response);
  }

  return response.body;
}

async function postLocalizationGeneration(baseUrl, cookieHeader, workspaceId, expectedRevision, mutationRequest) {
  const response = await requestJson(new URL('/api/workspace/localizations/generate', baseUrl), {
    method: 'POST',
    cookieHeader,
    body: {
      workspaceId,
      expectedRevision,
      ...mutationRequest
    }
  });

  if (!response.ok) {
    throw createHttpError('POST /api/workspace/localizations/generate failed.', response);
  }

  return response.body;
}

async function requestJson(url, {
  method = 'GET',
  cookieHeader,
  workspaceId = '',
  body = null
} = {}) {
  const requestUrl = new URL(url);

  if (workspaceId) {
    requestUrl.searchParams.set('workspaceId', workspaceId);
  }

  const response = await fetch(requestUrl, {
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
    url: requestUrl.toString(),
    body: responseBody
  };
}

async function writeReport(report, { artifactRoot, artifactSlug, artifactStamp } = {}) {
  const timestampedReportPath = path.join(artifactRoot, `${artifactSlug}-${artifactStamp}.json`);
  const latestReportPath = path.join(artifactRoot, 'latest-review-origin-verification.json');
  const serializedReport = `${JSON.stringify(report, null, 2)}\n`;

  await fs.writeFile(timestampedReportPath, serializedReport);
  await fs.writeFile(latestReportPath, serializedReport);
}

function createViewerActor(viewer) {
  const viewerSub = normalizeOptionalString(viewer?.sub);

  if (!viewerSub) {
    return null;
  }

  return {
    type: 'human',
    id: viewerSub,
    ...(normalizeOptionalString(viewer?.email) ? { email: viewer.email.trim() } : {}),
    ...(normalizeOptionalString(viewer?.name) ? { name: viewer.name.trim() } : {})
  };
}

function createVerificationDraft(targetLocale, artifactStamp) {
  return {
    sourceTitle: `Codex review-origin verify ${artifactStamp}`,
    sourceDetails: `Temporary verification card for ${targetLocale} origin checks.`,
    editedTitle: `Manual follow-up ${artifactStamp}`,
    editedDetails: `Human edit after AI generation at ${new Date().toISOString()}.`,
    manualCreateTitle: `Manual fresh locale ${artifactStamp}`,
    manualCreateDetails: `Human-created localization after discarding the AI locale.`
  };
}

function makeClientMutationId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function readVariant(workspace, boardId, cardId, locale) {
  const variant = workspace?.boards?.[boardId]?.cards?.[cardId]?.contentByLocale?.[locale];
  return variant && typeof variant === 'object' ? variant : null;
}

function serializeVariant(variant) {
  if (!variant || typeof variant !== 'object') {
    return null;
  }

  return {
    title: variant.title ?? null,
    detailsMarkdown: variant.detailsMarkdown ?? null,
    provenance: variant.provenance ?? null,
    review: variant.review ?? null
  };
}

function createHttpError(message, response) {
  const error = new Error(
    response?.body?.error
      ? `${message} ${response.body.error}`
      : `${message} Status ${response?.status ?? 'unknown'}.`
  );

  error.status = response?.status ?? null;
  error.responseBody = response?.body ?? null;
  error.requestUrl = response?.url ?? null;
  return error;
}

function serializeError(error, step) {
  return {
    step,
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    ...(error?.status ? { status: error.status } : {}),
    ...(error?.requestUrl ? { requestUrl: error.requestUrl } : {}),
    ...(error?.responseBody ? { responseBody: error.responseBody } : {})
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const parsed = {
    configPath: undefined,
    workspaceId: '',
    boardId: '',
    boardTitle: '',
    targetLocale: '',
    keepCard: false
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
      case '--board-id':
        parsed.boardId = nextValue();
        break;
      case '--board-title':
        parsed.boardTitle = nextValue();
        break;
      case '--target-locale':
        parsed.targetLocale = nextValue();
        break;
      case '--keep-card':
        parsed.keepCard = true;
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

function readPayloadWorkspaceId(payload) {
  return normalizeOptionalString(payload?.activeWorkspace?.workspaceId)
    || normalizeOptionalString(payload?.body?.activeWorkspace?.workspaceId)
    || normalizeOptionalString(payload?.workspace?.workspaceId)
    || normalizeOptionalString(payload?.body?.workspace?.workspaceId);
}
