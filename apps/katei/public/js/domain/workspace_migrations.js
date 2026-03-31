import { normalizeBoardCollaboration } from './board_collaboration.js';
import { createDefaultBoardLanguagePolicy, normalizeBoardLanguagePolicy } from './board_language_policy.js';
import { getDefaultBoardStageActionIds, isValidBoardStageActionId } from './board_stage_actions.js';
import { createDefaultBoardStages, createDefaultBoardTemplates } from './board_workflow.js';
import { createCardContentProvenance } from './card_localization.js';
import { normalizeCardLocaleRequests } from './card_localization_requests.js';
import { WORKSPACE_ID, WORKSPACE_VERSION } from './workspace_read_model.js';

export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: WORKSPACE_VERSION,
    up: migrateWorkspaceToV5
  })
]);

export function migrateWorkspaceSnapshot(workspace, options = {}) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  return normalizeWorkspaceToCurrentSchema(workspace, options);
}

export function migrateWorkspaceToV5(workspace, { now = null } = {}) {
  return normalizeWorkspaceToCurrentSchema(workspace, {
    now,
    version: 5
  });
}

export function normalizeWorkspaceToCurrentSchema(
  workspace,
  { now = null, version = WORKSPACE_VERSION } = {}
) {
  if (!isPlainObject(workspace)) {
    return workspace;
  }

  const migratedWorkspace = structuredClone(workspace);
  migratedWorkspace.version = version;
  migratedWorkspace.workspaceId = normalizeWorkspaceId(migratedWorkspace.workspaceId);

  if (!isPlainObject(migratedWorkspace.boards)) {
    return migratedWorkspace;
  }

  for (const [boardId, board] of Object.entries(migratedWorkspace.boards)) {
    migratedWorkspace.boards[boardId] = migrateBoardToSchemaV7(board, { now });
  }

  return migratedWorkspace;
}

export function migrateBoardToSchemaV7(board, { now = null } = {}) {
  if (!isPlainObject(board)) {
    return board;
  }

  const migratedBoard = structuredClone(board);
  const stageOrder = resolveStageOrder(migratedBoard);
  const legacyStageMap = resolveLegacyStageMap(migratedBoard);
  const defaultStagesById = new Map(createDefaultBoardStages().map((stage) => [stage.id, stage]));

  migratedBoard.stageOrder = stageOrder;
  migratedBoard.stages = Object.fromEntries(
    stageOrder.map((stageId) => [
      stageId,
      migrateStageDefinition({
        stageId,
        stageOrder,
        legacyStage: legacyStageMap[stageId],
        defaultStage: defaultStagesById.get(stageId) ?? null
      })
    ])
  );
  migratedBoard.templates = migrateBoardTemplates(migratedBoard.templates);
  migratedBoard.collaboration = normalizeBoardCollaboration(migratedBoard);
  migratedBoard.languagePolicy = migrateBoardLanguagePolicy(migratedBoard.languagePolicy);

  if (isPlainObject(migratedBoard.cards)) {
    for (const [cardId, card] of Object.entries(migratedBoard.cards)) {
      migratedBoard.cards[cardId] = migrateCardToLocalizedContent(card, migratedBoard, { now });
    }
  }

  delete migratedBoard.columnOrder;
  delete migratedBoard.columns;
  delete migratedBoard.memberships;
  delete migratedBoard.invites;

  return migratedBoard;
}

export function migrateCardToLocalizedContent(card, board, { now = null } = {}) {
  if (!isPlainObject(card)) {
    return card;
  }

  const migratedCard = structuredClone(card);
  const languagePolicy = normalizeBoardLanguagePolicy(board?.languagePolicy ?? null) ?? createDefaultBoardLanguagePolicy();
  const sourceLocale = languagePolicy.sourceLocale;
  const nextContentByLocale = {};

  if (isPlainObject(migratedCard.contentByLocale)) {
    for (const [rawLocale, rawVariant] of Object.entries(migratedCard.contentByLocale)) {
      const locale = canonicalizeLocale(rawLocale);

      if (!locale || !isPlainObject(rawVariant)) {
        continue;
      }

      nextContentByLocale[locale] = migrateLocalizedContentVariant(rawVariant, {
        fallbackTimestamp: resolveMigrationTimestamp(migratedCard, board, now)
      });
    }
  }

  if (!nextContentByLocale[sourceLocale] && hasLegacyCardContent(migratedCard)) {
    nextContentByLocale[sourceLocale] = {
      title: String(migratedCard.title ?? ''),
      detailsMarkdown: String(migratedCard.detailsMarkdown ?? ''),
      provenance: createCardContentProvenance({
        actor: {
          type: 'system',
          id: 'legacy-migration'
        },
        timestamp: resolveMigrationTimestamp(migratedCard, board, now),
        includesHumanInput: true
      })
    };
  }

  migratedCard.contentByLocale = nextContentByLocale;
  migratedCard.localeRequests = normalizeCardLocaleRequests(migratedCard);
  delete migratedCard.title;
  delete migratedCard.detailsMarkdown;
  delete migratedCard.localizationRequests;

  return migratedCard;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveStageOrder(board) {
  const rawStageOrder = Array.isArray(board.stageOrder)
    ? board.stageOrder
    : (Array.isArray(board.columnOrder) ? board.columnOrder : []);
  const stageOrder = [];
  const seenStageIds = new Set();

  for (const rawStageId of rawStageOrder) {
    if (typeof rawStageId !== 'string') {
      continue;
    }

    const stageId = rawStageId.trim();

    if (!stageId || seenStageIds.has(stageId)) {
      continue;
    }

    seenStageIds.add(stageId);
    stageOrder.push(stageId);
  }

  return stageOrder.length > 0 ? stageOrder : createDefaultBoardStages().map(({ id }) => id);
}

function resolveLegacyStageMap(board) {
  if (isPlainObject(board.stages)) {
    return board.stages;
  }

  if (isPlainObject(board.columns)) {
    return board.columns;
  }

  return {};
}

function migrateStageDefinition({ stageId, stageOrder, legacyStage, defaultStage }) {
  const normalizedLegacyStage = isPlainObject(legacyStage) ? legacyStage : {};
  const fallbackTransitions = defaultStage?.allowedTransitionStageIds
    ? [...defaultStage.allowedTransitionStageIds]
    : stageOrder.filter((candidateStageId) => candidateStageId !== stageId);

  return {
    id: stageId,
    title:
      typeof normalizedLegacyStage.title === 'string' && normalizedLegacyStage.title.trim()
        ? normalizedLegacyStage.title
        : (defaultStage?.title ?? stageId),
    cardIds: normalizeStringArray(normalizedLegacyStage.cardIds),
    allowedTransitionStageIds: normalizeStringArray(
      normalizedLegacyStage.allowedTransitionStageIds,
      fallbackTransitions
    ).filter((targetStageId) => stageOrder.includes(targetStageId)),
    templateIds: normalizeStringArray(normalizedLegacyStage.templateIds),
    actionIds: Object.prototype.hasOwnProperty.call(normalizedLegacyStage, 'actionIds')
      ? normalizeStringArray(normalizedLegacyStage.actionIds).filter(isValidBoardStageActionId)
      : getDefaultBoardStageActionIds(stageId)
  };
}

function migrateBoardTemplates(templates) {
  if (Array.isArray(templates)) {
    return {
      default: templates.map((template) => structuredClone(template))
    };
  }

  if (isPlainObject(templates) && Array.isArray(templates.default)) {
    return {
      ...structuredClone(templates),
      default: templates.default.map((template) => structuredClone(template))
    };
  }

  return createDefaultBoardTemplates();
}

function migrateBoardLanguagePolicy(policy) {
  const normalizedPolicy = normalizeBoardLanguagePolicy(policy);

  return normalizedPolicy
    ? {
        sourceLocale: normalizedPolicy.sourceLocale,
        defaultLocale: normalizedPolicy.defaultLocale,
        supportedLocales: [...normalizedPolicy.supportedLocales],
        requiredLocales: [...normalizedPolicy.requiredLocales]
      }
    : createDefaultBoardLanguagePolicy();
}

function migrateLocalizedContentVariant(variant, { fallbackTimestamp }) {
  const migratedVariant = isPlainObject(variant) ? structuredClone(variant) : {};

  return {
    ...migratedVariant,
    title: typeof migratedVariant.title === 'string' ? migratedVariant.title : '',
    detailsMarkdown: typeof migratedVariant.detailsMarkdown === 'string' ? migratedVariant.detailsMarkdown : '',
    provenance: normalizeProvenance(migratedVariant.provenance, fallbackTimestamp)
  };
}

function normalizeProvenance(provenance, fallbackTimestamp) {
  if (isPlainObject(provenance)) {
    try {
      return createCardContentProvenance(provenance);
    } catch (error) {
      // Fall through to the deterministic system provenance.
    }
  }

  return createCardContentProvenance({
    actor: {
      type: 'system',
      id: 'legacy-migration'
    },
    timestamp: fallbackTimestamp,
    includesHumanInput: true
  });
}

function hasLegacyCardContent(card) {
  const title = typeof card?.title === 'string' ? card.title.trim() : '';
  const detailsMarkdown = typeof card?.detailsMarkdown === 'string' ? card.detailsMarkdown.trim() : '';

  return title.length > 0 || detailsMarkdown.length > 0;
}

function resolveMigrationTimestamp(card, board, now) {
  return (
    normalizeTimestamp(card?.updatedAt) ??
    normalizeTimestamp(board?.updatedAt) ??
    normalizeTimestamp(now) ??
    '1970-01-01T00:00:00.000Z'
  );
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp.toISOString();
}

function normalizeStringArray(value, fallback = []) {
  const rawValues = Array.isArray(value) ? value : fallback;
  const values = [];
  const seenValues = new Set();

  for (const rawValue of rawValues) {
    if (typeof rawValue !== 'string') {
      continue;
    }

    const normalizedValue = rawValue.trim();

    if (!normalizedValue || seenValues.has(normalizedValue)) {
      continue;
    }

    seenValues.add(normalizedValue);
    values.push(normalizedValue);
  }

  return values;
}

function canonicalizeLocale(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    return Intl.getCanonicalLocales(value.trim().replaceAll('_', '-'))[0] ?? null;
  } catch (error) {
    return null;
  }
}

function normalizeWorkspaceId(workspaceId) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : WORKSPACE_ID;
}
