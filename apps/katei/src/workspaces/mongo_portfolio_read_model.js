import { getMongoDb } from '../data/mongo_client.js';
import { getWorkspaceRecordCollection } from './mongo_workspace_record_repository.js';
import { fromWorkspaceRecordDocument } from './workspace_record.js';
import { createDefaultBoardLanguagePolicy, normalizeBoardLanguagePolicy } from '../../public/js/domain/board_language_policy.js';
import {
  getCardContentReviewState,
  getMissingRequiredLocales,
  getStoredCardContentVariant,
  listCardLocales
} from '../../public/js/domain/card_localization.js';
import { listCardLocaleStatuses } from '../../public/js/domain/card_localization_requests.js';

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

  async loadPortfolioSummary() {
    const collection = this.#getCollection();
    const documents = await collection.find({}).toArray();
    const records = documents
      .map((document) => fromWorkspaceRecordDocument(document))
      .filter(Boolean)
      .sort(compareWorkspaceRecords);
    const totals = createEmptyPortfolioTotals();
    const workspaces = [];
    const boardDirectory = [];

    for (const record of records) {
      const boardIds = listWorkspaceBoardIds(record.workspace);

      workspaces.push(createWorkspaceSummary(record, boardIds));

      for (const boardId of boardIds) {
        const board = record.workspace?.boards?.[boardId];

        if (!board || typeof board !== 'object') {
          continue;
        }

        const boardSummary = createBoardSummary(record, board, boardId);

        boardDirectory.push(boardSummary);
        accumulatePortfolioTotals(totals, boardSummary);
      }
    }

    totals.workspaces = workspaces.length;
    totals.boards = boardDirectory.length;

    return {
      totals,
      workspaces,
      boardDirectory
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
    workspaceTitle: null,
    boardCount: boardIds.length,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  };
}

function createBoardSummary(record, board, boardId) {
  const localePolicy = normalizeBoardLanguagePolicy(board.languagePolicy) ?? createDefaultBoardLanguagePolicy();
  const localizationSummary = createBoardLocalizationSummary(board);

  return {
    workspaceId: record.workspaceId,
    workspaceTitle: null,
    boardId,
    boardTitle: normalizeOptionalString(board.title) || boardId,
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
    localizationSummary: localizationSummary.summary,
    aging: localizationSummary.aging,
    timestamps: {
      workspaceCreatedAt: record.createdAt,
      workspaceUpdatedAt: record.updatedAt,
      boardCreatedAt: normalizeOptionalString(board.createdAt) || null,
      boardUpdatedAt: normalizeOptionalString(board.updatedAt) || null
    }
  };
}

function compareWorkspaceRecords(left, right) {
  return normalizeOptionalString(left?.workspaceId).localeCompare(normalizeOptionalString(right?.workspaceId));
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

function createBoardLocalizationSummary(board) {
  const summary = createEmptyBoardLocalizationSummary();
  const aging = createEmptyBoardAging();

  for (const card of Object.values(board?.cards ?? {})) {
    if (!card || typeof card !== 'object') {
      continue;
    }

    if (getMissingRequiredLocales(board, card).length > 0) {
      summary.cardsMissingRequiredLocales += 1;
      aging.oldestMissingRequiredLocaleUpdatedAt = pickEarlierIsoTimestamp(
        aging.oldestMissingRequiredLocaleUpdatedAt,
        card.updatedAt
      );
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
        summary.awaitingHumanVerificationCount += 1;
        aging.oldestAwaitingHumanVerificationAt = pickEarlierIsoTimestamp(
          aging.oldestAwaitingHumanVerificationAt,
          variant.review?.verificationRequestedAt
        );
      } else if (reviewState.status === 'ai') {
        summary.agentProposalCount += 1;
        aging.oldestAgentProposalAt = pickEarlierIsoTimestamp(
          aging.oldestAgentProposalAt,
          variant.provenance?.timestamp
        );
      }
    }
  }

  return {
    summary,
    aging
  };
}

function createEmptyPortfolioTotals() {
  return {
    workspaces: 0,
    boards: 0,
    cards: 0,
    cardsMissingRequiredLocales: 0,
    openLocaleRequestCount: 0,
    awaitingHumanVerificationCount: 0,
    agentProposalCount: 0
  };
}

function createEmptyBoardLocalizationSummary() {
  return {
    cardsMissingRequiredLocales: 0,
    openLocaleRequestCount: 0,
    awaitingHumanVerificationCount: 0,
    agentProposalCount: 0
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
