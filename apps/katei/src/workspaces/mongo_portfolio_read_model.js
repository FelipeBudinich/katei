import { getMongoDb } from '../data/mongo_client.js';
import { getWorkspaceRecordCollection } from './mongo_workspace_record_repository.js';
import { fromWorkspaceRecordDocument } from './workspace_record.js';
import { createDefaultBoardLanguagePolicy, normalizeBoardLanguagePolicy } from '../../public/js/domain/board_language_policy.js';
import { canonicalizeBoardRole, normalizeBoardActor } from '../../public/js/domain/board_collaboration.js';
import { getBoardMembershipForActor } from '../../public/js/domain/board_permissions.js';
import {
  getCardContentReviewState,
  getMissingRequiredLocales,
  getStoredCardContentVariant,
  listCardLocales
} from '../../public/js/domain/card_localization.js';
import { listCardLocaleStatuses } from '../../public/js/domain/card_localization_requests.js';
import { normalizeCardWorkflowReview } from '../../public/js/domain/card_workflow_review.js';
import { stageSupportsAction } from '../../public/js/domain/board_stage_actions.js';
import { findColumnIdByCardId } from '../../public/js/domain/workspace_selectors.js';

export function createMongoPortfolioReadModel(options = {}) {
  return new MongoPortfolioReadModel(options);
}

export class MongoPortfolioReadModel {
  constructor({ collection, db, config, getDb = getMongoDb } = {}) {
    this.collection = collection ?? null;
    this.db = db ?? null;
    this.config = config;
    this.getDb = getDb;
  }

  async loadPortfolioSummary({ viewerSub = null } = {}) {
    const collection = this.#getCollection();
    const documents = await collection.find({}).toArray();
    const records = documents
      .map((document) => fromWorkspaceRecordDocument(document))
      .filter(Boolean)
      .sort(compareWorkspaceRecords);
    const viewerActor = createPortfolioViewerActor(viewerSub);
    const totals = createEmptyPortfolioTotals();
    const workspaces = [];
    const boardDirectory = [];
    const awaitingHumanVerificationItems = [];
    const agentProposalItems = [];
    const pendingCardReviewItems = [];
    const missingRequiredLocalizationItems = [];

    for (const record of records) {
      const boardIds = listWorkspaceBoardIds(record.workspace);

      workspaces.push(createWorkspaceSummary(record, boardIds));

      for (const boardId of boardIds) {
        const board = record.workspace?.boards?.[boardId];

        if (!board || typeof board !== 'object') {
          continue;
        }

        const localePolicy = normalizeBoardLanguagePolicy(board.languagePolicy) ?? createDefaultBoardLanguagePolicy();
        const boardPortfolioDetails = createBoardPortfolioDetails(record, board, boardId, localePolicy);
        const boardSummary = createBoardSummary(record, board, boardId, localePolicy, boardPortfolioDetails, viewerActor);

        boardDirectory.push(boardSummary);
        awaitingHumanVerificationItems.push(...boardPortfolioDetails.awaitingHumanVerificationItems);
        agentProposalItems.push(...boardPortfolioDetails.agentProposalItems);
        pendingCardReviewItems.push(...boardPortfolioDetails.pendingCardReviewItems);
        missingRequiredLocalizationItems.push(...boardPortfolioDetails.missingRequiredLocalizationItems);
        accumulatePortfolioTotals(totals, boardSummary);
      }
    }

    totals.workspaces = workspaces.length;
    totals.boards = boardDirectory.length;

    return {
      totals,
      workspaces,
      boardDirectory,
      awaitingHumanVerificationItems: awaitingHumanVerificationItems.sort(compareAwaitingHumanVerificationItems),
      agentProposalItems: agentProposalItems.sort(compareAgentProposalItems),
      pendingCardReviewItems: pendingCardReviewItems.sort(comparePendingCardReviewItems),
      missingRequiredLocalizationItems: missingRequiredLocalizationItems.sort(compareMissingRequiredLocalizationItems)
    };
  }

  #getCollection() {
    if (!this.collection) {
      this.collection = getWorkspaceRecordCollection({
        db: this.db,
        config: this.config,
        getDb: this.getDb
      });
    }

    return this.collection;
  }
}

function createWorkspaceSummary(record, boardIds) {
  return {
    workspaceId: record.workspaceId,
    workspaceTitle: resolveWorkspaceTitle(record.workspace),
    boardCount: boardIds.length,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  };
}

function createBoardSummary(record, board, boardId, localePolicy, boardPortfolioDetails, viewerActor) {
  return {
    workspaceId: record.workspaceId,
    workspaceTitle: resolveWorkspaceTitle(record.workspace),
    boardId,
    boardTitle: normalizeOptionalString(board.title) || boardId,
    viewerRole: resolveViewerBoardRole(board, viewerActor),
    localePolicy: {
      sourceLocale: localePolicy.sourceLocale,
      defaultLocale: localePolicy.defaultLocale,
      supportedLocales: [...localePolicy.supportedLocales],
      requiredLocales: [...localePolicy.requiredLocales]
    },
    cardCounts: {
      total: countBoardCards(board),
      byStage: null
    },
    localizationSummary: boardPortfolioDetails.summary,
    aging: boardPortfolioDetails.aging,
    timestamps: {
      workspaceCreatedAt: record.createdAt,
      workspaceUpdatedAt: record.updatedAt,
      boardCreatedAt: normalizeOptionalString(board.createdAt) || null,
      boardUpdatedAt: normalizeOptionalString(board.updatedAt) || null
    }
  };
}

function createPortfolioViewerActor(viewerSub) {
  return normalizeBoardActor({
    type: 'human',
    id: normalizeOptionalString(viewerSub)
  });
}

function resolveViewerBoardRole(board, viewerActor) {
  if (!viewerActor) {
    return null;
  }

  return canonicalizeBoardRole(getBoardMembershipForActor(board, viewerActor)?.role);
}

function createBoardPortfolioDetails(record, board, boardId, localePolicy) {
  const summary = createEmptyBoardLocalizationSummary();
  const aging = createEmptyBoardAging();
  const awaitingHumanVerificationItems = [];
  const agentProposalItems = [];
  const pendingCardReviewItems = [];
  const missingRequiredLocalizationItems = [];
  const boardTitle = normalizeOptionalString(board?.title) || boardId;
  const validStageIds = new Set(Array.isArray(board?.stageOrder) ? board.stageOrder : []);

  for (const [cardId, card] of Object.entries(board?.cards ?? {}).sort(compareCardEntries)) {
    if (!card || typeof card !== 'object') {
      continue;
    }

    const currentStageId = findColumnIdByCardId(board, cardId);
    const workflowReview = normalizeCardWorkflowReview(card.workflowReview, { validStageIds });

    if (
      workflowReview?.required === true &&
      workflowReview.status === 'pending' &&
      workflowReview.currentStageId === currentStageId &&
      stageSupportsAction(board, currentStageId, 'card.review')
    ) {
      summary.pendingCardReviewCount += 1;
      pendingCardReviewItems.push({
        ...createCardPortfolioItemBase({
          record,
          boardId,
          boardTitle,
          cardId,
          card,
          localePolicy
        }),
        stageId: currentStageId,
        stageTitle: normalizeOptionalString(board?.stages?.[currentStageId]?.title) || currentStageId
      });
    }

    const missingRequiredLocales = getMissingRequiredLocales(board, card);

    if (missingRequiredLocales.length > 0) {
      summary.cardsMissingRequiredLocales += 1;
      aging.oldestMissingRequiredLocaleUpdatedAt = pickEarlierIsoTimestamp(
        aging.oldestMissingRequiredLocaleUpdatedAt,
        card.updatedAt
      );
      missingRequiredLocalizationItems.push({
        ...createCardPortfolioItemBase({
          record,
          boardId,
          boardTitle,
          cardId,
          card,
          localePolicy
        }),
        missingLocales: [...missingRequiredLocales]
      });
    }

    for (const localeStatus of listCardLocaleStatuses(board, card)) {
      if (!localeStatus?.isRequested || !localeStatus?.request?.requestedAt) {
        continue;
      }

      summary.openLocaleRequestCount += 1;
      aging.oldestOpenLocaleRequestAt = pickEarlierIsoTimestamp(
        aging.oldestOpenLocaleRequestAt,
        localeStatus.request.requestedAt
      );
    }

    for (const locale of listCardLocales(card)) {
      const variant = getStoredCardContentVariant(card, locale);

      if (!variant) {
        continue;
      }

      const reviewState = getCardContentReviewState(variant.review ?? null);

      if (reviewState.status === 'needs-human-verification') {
        const verificationRequestedAt = normalizeOptionalIsoTimestamp(variant.review?.verificationRequestedAt);

        summary.awaitingHumanVerificationCount += 1;
        aging.oldestAwaitingHumanVerificationAt = pickEarlierIsoTimestamp(
          aging.oldestAwaitingHumanVerificationAt,
          verificationRequestedAt
        );
        awaitingHumanVerificationItems.push({
          ...createLocalizedPortfolioItemBase({
            record,
            boardId,
            boardTitle,
            cardId,
            card,
            locale,
            variant,
            localePolicy
          }),
          verificationRequestedAt
        });
      } else if (reviewState.status === 'ai') {
        const proposedAt = normalizeOptionalIsoTimestamp(variant.provenance?.timestamp);

        summary.agentProposalCount += 1;
        aging.oldestAgentProposalAt = pickEarlierIsoTimestamp(
          aging.oldestAgentProposalAt,
          proposedAt
        );
        agentProposalItems.push({
          ...createLocalizedPortfolioItemBase({
            record,
            boardId,
            boardTitle,
            cardId,
            card,
            locale,
            variant,
            localePolicy
          }),
          proposedAt
        });
      }
    }
  }

  return {
    summary,
    aging,
    awaitingHumanVerificationItems,
    agentProposalItems,
    pendingCardReviewItems,
    missingRequiredLocalizationItems
  };
}

function createLocalizedPortfolioItemBase({
  record,
  boardId,
  boardTitle,
  cardId,
  card,
  locale,
  variant,
  localePolicy
}) {
  const cardTitle = resolvePortfolioCardTitle(card, localePolicy);
  const localizedTitle = normalizeOptionalString(variant?.title) || cardTitle;

  return {
    workspaceId: record.workspaceId,
    workspaceTitle: resolveWorkspaceTitle(record.workspace),
    boardId,
    boardTitle,
    cardId,
    cardTitle,
    localizedTitle,
    locale,
    cardUpdatedAt: normalizeOptionalIsoTimestamp(card?.updatedAt)
  };
}

function createCardPortfolioItemBase({ record, boardId, boardTitle, cardId, card, localePolicy }) {
  return {
    workspaceId: record.workspaceId,
    workspaceTitle: resolveWorkspaceTitle(record.workspace),
    boardId,
    boardTitle,
    cardId,
    cardTitle: resolvePortfolioCardTitle(card, localePolicy),
    cardUpdatedAt: normalizeOptionalIsoTimestamp(card?.updatedAt)
  };
}

function resolvePortfolioCardTitle(card, localePolicy) {
  const sourceVariant = localePolicy?.sourceLocale
    ? getStoredCardContentVariant(card, localePolicy.sourceLocale)
    : null;
  const sourceTitle = normalizeOptionalString(sourceVariant?.title);

  if (sourceTitle) {
    return sourceTitle;
  }

  for (const locale of listCardLocales(card)) {
    const variantTitle = normalizeOptionalString(getStoredCardContentVariant(card, locale)?.title);

    if (variantTitle) {
      return variantTitle;
    }
  }

  return normalizeOptionalString(card?.id);
}

function compareWorkspaceRecords(left, right) {
  return normalizeOptionalString(left?.workspaceId).localeCompare(normalizeOptionalString(right?.workspaceId));
}

function compareCardEntries(left, right) {
  return normalizeOptionalString(left?.[0]).localeCompare(normalizeOptionalString(right?.[0]));
}

function compareAwaitingHumanVerificationItems(left, right) {
  return comparePortfolioItemsByTimestamp(left?.verificationRequestedAt, right?.verificationRequestedAt, left, right);
}

function compareAgentProposalItems(left, right) {
  return comparePortfolioItemsByTimestamp(left?.proposedAt, right?.proposedAt, left, right);
}

function comparePendingCardReviewItems(left, right) {
  return comparePortfolioItemsByTimestamp(left?.cardUpdatedAt, right?.cardUpdatedAt, left, right);
}

function compareMissingRequiredLocalizationItems(left, right) {
  return comparePortfolioItemsByTimestamp(left?.cardUpdatedAt, right?.cardUpdatedAt, left, right);
}

function comparePortfolioItemsByTimestamp(leftTimestamp, rightTimestamp, left, right) {
  const normalizedLeftTimestamp = normalizeOptionalIsoTimestamp(leftTimestamp);
  const normalizedRightTimestamp = normalizeOptionalIsoTimestamp(rightTimestamp);

  if (normalizedLeftTimestamp && normalizedRightTimestamp && normalizedLeftTimestamp !== normalizedRightTimestamp) {
    return normalizedLeftTimestamp.localeCompare(normalizedRightTimestamp);
  }

  if (normalizedLeftTimestamp && !normalizedRightTimestamp) {
    return -1;
  }

  if (!normalizedLeftTimestamp && normalizedRightTimestamp) {
    return 1;
  }

  return comparePortfolioItemsByIdentity(left, right);
}

function comparePortfolioItemsByIdentity(left, right) {
  return (
    normalizeOptionalString(left?.workspaceId).localeCompare(normalizeOptionalString(right?.workspaceId))
    || normalizeOptionalString(left?.boardId).localeCompare(normalizeOptionalString(right?.boardId))
    || normalizeOptionalString(left?.cardId).localeCompare(normalizeOptionalString(right?.cardId))
    || normalizeOptionalString(left?.locale).localeCompare(normalizeOptionalString(right?.locale))
  );
}

function listWorkspaceBoardIds(workspace) {
  const boardIds = [];
  const seenBoardIds = new Set();

  for (const boardId of Array.isArray(workspace?.boardOrder) ? workspace.boardOrder : []) {
    if (typeof boardId !== 'string' || seenBoardIds.has(boardId) || !workspace?.boards?.[boardId]) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  for (const boardId of Object.keys(workspace?.boards ?? {})) {
    if (seenBoardIds.has(boardId) || !workspace.boards?.[boardId]) {
      continue;
    }

    seenBoardIds.add(boardId);
    boardIds.push(boardId);
  }

  return boardIds;
}

function countBoardCards(board) {
  if (!board?.cards || typeof board.cards !== 'object') {
    return 0;
  }

  return Object.keys(board.cards).length;
}

function createEmptyPortfolioTotals() {
  return {
    workspaces: 0,
    boards: 0,
    cards: 0,
    cardsMissingRequiredLocales: 0,
    openLocaleRequestCount: 0,
    awaitingHumanVerificationCount: 0,
    agentProposalCount: 0,
    pendingCardReviewCount: 0
  };
}

function createEmptyBoardLocalizationSummary() {
  return {
    cardsMissingRequiredLocales: 0,
    openLocaleRequestCount: 0,
    awaitingHumanVerificationCount: 0,
    agentProposalCount: 0,
    pendingCardReviewCount: 0
  };
}

function createEmptyBoardAging() {
  return {
    oldestMissingRequiredLocaleUpdatedAt: null,
    oldestOpenLocaleRequestAt: null,
    oldestAwaitingHumanVerificationAt: null,
    oldestAgentProposalAt: null
  };
}

function accumulatePortfolioTotals(totals, boardSummary) {
  totals.cards += Number.isInteger(boardSummary?.cardCounts?.total) ? boardSummary.cardCounts.total : 0;
  totals.cardsMissingRequiredLocales += Number.isInteger(boardSummary?.localizationSummary?.cardsMissingRequiredLocales)
    ? boardSummary.localizationSummary.cardsMissingRequiredLocales
    : 0;
  totals.openLocaleRequestCount += Number.isInteger(boardSummary?.localizationSummary?.openLocaleRequestCount)
    ? boardSummary.localizationSummary.openLocaleRequestCount
    : 0;
  totals.awaitingHumanVerificationCount += Number.isInteger(boardSummary?.localizationSummary?.awaitingHumanVerificationCount)
    ? boardSummary.localizationSummary.awaitingHumanVerificationCount
    : 0;
  totals.agentProposalCount += Number.isInteger(boardSummary?.localizationSummary?.agentProposalCount)
    ? boardSummary.localizationSummary.agentProposalCount
    : 0;
  totals.pendingCardReviewCount += Number.isInteger(boardSummary?.localizationSummary?.pendingCardReviewCount)
    ? boardSummary.localizationSummary.pendingCardReviewCount
    : 0;
}

function pickEarlierIsoTimestamp(currentValue, nextValue) {
  const normalizedCurrentValue = normalizeOptionalIsoTimestamp(currentValue);
  const normalizedNextValue = normalizeOptionalIsoTimestamp(nextValue);

  if (!normalizedCurrentValue) {
    return normalizedNextValue;
  }

  if (!normalizedNextValue) {
    return normalizedCurrentValue;
  }

  return normalizedNextValue < normalizedCurrentValue ? normalizedNextValue : normalizedCurrentValue;
}

function normalizeOptionalIsoTimestamp(value) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = new Date(normalizedValue);
  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue.toISOString();
}

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveWorkspaceTitle(workspace) {
  return normalizeOptionalString(workspace?.title) || null;
}
