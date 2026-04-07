import { getMongoDb } from '../data/mongo_client.js';
import { getWorkspaceRecordCollection } from './mongo_workspace_record_repository.js';
import { fromWorkspaceRecordDocument } from './workspace_record.js';
import { createDefaultBoardLanguagePolicy, normalizeBoardLanguagePolicy } from '../../public/js/domain/board_language_policy.js';

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

        boardDirectory.push(createBoardSummary(record, board, boardId));
      }
    }

    return {
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

function normalizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
